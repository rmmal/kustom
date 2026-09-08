/**
 * WebSocket subscriber for the League client's event stream.
 *
 * Protocol (WAMP v1 style, see docs/03-lcu-reference.md "Connecting"):
 *  - send `[5, "OnJsonApiEvent"]` to subscribe to everything, or `[5, "OnJsonApiEvent_<uri with _>"]` for one URI;
 *  - send `[6, topic]` to unsubscribe;
 *  - receive `[8, topic, { data, eventType: "Create" | "Update" | "Delete", uri }]`.
 *
 * `LcuSocket` connects once per `connect()` call and emits `close` when the client goes away. The reconnect
 * loop with backoff lives in the companion (M2.1); this class only makes it possible: subscriptions are
 * remembered and re-sent on the next successful `connect()`.
 *
 * Liveness (M2.6): a WebSocket ping every `heartbeatMs` (30 s); the client answers with a pong (verified on
 * 16.17, 7 ms round trip, payload echoed). A pong that does not arrive within `heartbeatTimeoutMs` (10 s)
 * means the connection is open but dead — the PC slept, the client was killed without a close frame — and
 * the socket is terminated so `close` fires (code 1006, reason `heartbeat`) and the companion reconnects.
 *
 * Malformed frames are logged and emitted as `dropped`; they never throw.
 */

import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { z } from 'zod';
import { basicAuthHeader, LCU_HOST } from './auth.js';
import type { LockfileCredentials } from './lockfile.js';
import { type Logger, silentLogger } from './log.js';
import { scrubDroppedFrame } from './scrub.js';
import { DEFAULT_TLS_MODE, type TlsMode, tlsConnectionOptions } from './tls.js';

/** Subscribes to every JSON API event. */
export const ALL_EVENTS_TOPIC = 'OnJsonApiEvent';

/** `/lol-lobby/v2/lobby` -> `OnJsonApiEvent_lol-lobby_v2_lobby`. */
export function topicForUri(uri: string): string {
  return `${ALL_EVENTS_TOPIC}_${uri.replace(/^\//, '').replace(/\//g, '_')}`;
}

export function subscribeMessage(topic: string = ALL_EVENTS_TOPIC): string {
  return JSON.stringify([5, topic]);
}

export function unsubscribeMessage(topic: string = ALL_EVENTS_TOPIC): string {
  return JSON.stringify([6, topic]);
}

export const LcuEventTypeSchema = z.enum(['Create', 'Update', 'Delete']);
export type LcuEventType = z.infer<typeof LcuEventTypeSchema>;

/** The wire shape of an event frame. `data` stays `unknown`; per-URI schemas are M0.3. */
export const LcuEventFrameSchema = z.tuple([
  z.literal(8),
  z.string(),
  z.object({
    data: z.unknown(),
    eventType: LcuEventTypeSchema,
    uri: z.string(),
  }),
]);

export interface LcuEvent {
  readonly topic: string;
  readonly uri: string;
  readonly eventType: LcuEventType;
  readonly data: unknown;
}

export type FrameParseResult =
  | { readonly kind: 'event'; readonly event: LcuEvent }
  /** The client sends an empty frame after a subscribe; it carries nothing. */
  | { readonly kind: 'empty' }
  | { readonly kind: 'malformed'; readonly reason: string; readonly raw: string };

export function parseFrame(raw: string | Buffer | ArrayBuffer | Buffer[]): FrameParseResult {
  const text = rawToString(raw);
  if (text.trim().length === 0) {
    return { kind: 'empty' };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return {
      kind: 'malformed',
      reason: `invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      raw: text,
    };
  }
  const parsed = LcuEventFrameSchema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`,
    );
    return { kind: 'malformed', reason: issues.join('; '), raw: text };
  }
  const [, topic, payload] = parsed.data;
  return {
    kind: 'event',
    event: { topic, uri: payload.uri, eventType: payload.eventType, data: payload.data },
  };
}

function rawToString(raw: string | Buffer | ArrayBuffer | Buffer[]): string {
  if (typeof raw === 'string') {
    return raw;
  }
  if (Array.isArray(raw)) {
    return Buffer.concat(raw).toString('utf8');
  }
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(raw).toString('utf8');
  }
  return raw.toString('utf8');
}

export interface LcuSocketOptions {
  readonly port: number;
  readonly password: string;
  readonly tls?: TlsMode;
  readonly logger?: Logger;
  /** Only tests change this. */
  readonly host?: string;
  /**
   * WebSocket subprotocols to offer. Some community clients offer `wamp`; the Python ones offer nothing and
   * work. Default: none (a server cannot reject an absent offer). Confirm on a live client in M0.2.
   */
  readonly protocols?: readonly string[];
  /** Ping interval. Default 30 s. `0` disables the heartbeat (tests of the plain protocol). */
  readonly heartbeatMs?: number;
  /** How long a pong may take before the socket is declared dead. Default 10 s. */
  readonly heartbeatTimeoutMs?: number;
}

export const DEFAULT_HEARTBEAT_MS = 30_000;
export const DEFAULT_HEARTBEAT_TIMEOUT_MS = 10_000;
/** The close reason reported when the heartbeat, not the peer, ended the connection. */
export const HEARTBEAT_CLOSE_REASON = 'heartbeat';

export interface LcuSocketCloseInfo {
  readonly code: number;
  readonly reason: string;
}

export interface LcuSocketDroppedFrame {
  readonly reason: string;
  readonly raw: string;
}

export interface LcuSocketEvents {
  open: [];
  event: [LcuEvent];
  close: [LcuSocketCloseInfo];
  dropped: [LcuSocketDroppedFrame];
  error: [Error];
}

export class LcuSocket extends EventEmitter<LcuSocketEvents> {
  readonly url: string;
  private readonly authorization: string;
  private readonly tls: TlsMode;
  private readonly logger: Logger;
  private readonly protocols: readonly string[];
  private readonly heartbeatMs: number;
  private readonly heartbeatTimeoutMs: number;
  private readonly topics = new Set<string>();
  private ws: WebSocket | undefined;
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private pongTimer: NodeJS.Timeout | undefined;
  /** Set when the heartbeat terminated the socket, so the `close` event can say so. */
  private heartbeatFailed = false;

  constructor(options: LcuSocketOptions) {
    super();
    this.url = `wss://${options.host ?? LCU_HOST}:${options.port}`;
    this.authorization = basicAuthHeader(options.password);
    this.tls = options.tls ?? DEFAULT_TLS_MODE;
    this.logger = options.logger ?? silentLogger;
    this.protocols = options.protocols ?? [];
    this.heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
  }

  static fromCredentials(
    credentials: LockfileCredentials,
    options: Omit<LcuSocketOptions, 'port' | 'password'> = {},
  ): LcuSocket {
    return new LcuSocket({ ...options, port: credentials.port, password: credentials.password });
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** The subprotocol the server agreed to, or `''`. Informational; printed by `record-ws`. */
  get negotiatedProtocol(): string {
    return this.ws?.protocol ?? '';
  }

  /** Topics that are (re)sent on every successful open. */
  get subscriptions(): readonly string[] {
    return [...this.topics];
  }

  /** Remembers the topic and sends the subscribe frame now if the socket is open. */
  subscribe(topic: string = ALL_EVENTS_TOPIC): void {
    this.topics.add(topic);
    if (this.isOpen) {
      this.send(subscribeMessage(topic));
    }
  }

  unsubscribe(topic: string = ALL_EVENTS_TOPIC): void {
    this.topics.delete(topic);
    if (this.isOpen) {
      this.send(unsubscribeMessage(topic));
    }
  }

  /**
   * Opens the socket. Resolves once the server accepted the upgrade and every remembered subscription
   * was sent; rejects if the connection fails before that. After resolution, failures surface as `close`
   * (and `error`) events, never as exceptions.
   */
  connect(): Promise<void> {
    const current = this.ws;
    if (current && (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING)) {
      return Promise.resolve();
    }
    // CLOSING or CLOSED: open a fresh socket. The old one's `close` handler only clears `this.ws` when it is
    // still the active socket, so a late close from the previous socket cannot orphan the new one.
    this.ws = undefined;
    return new Promise<void>((resolve, reject) => {
      let opened = false;
      const ws = new WebSocket(this.url, [...this.protocols], {
        headers: { authorization: this.authorization },
        ...tlsConnectionOptions(this.tls),
      });
      this.ws = ws;

      ws.on('open', () => {
        opened = true;
        this.logger.info('lcu socket open', { url: this.url, protocol: ws.protocol });
        for (const topic of this.topics) {
          this.send(subscribeMessage(topic));
        }
        this.startHeartbeat(ws);
        this.emit('open');
        resolve();
      });

      ws.on('pong', () => {
        this.clearPongTimer();
      });

      ws.on('message', (raw) => {
        const result = parseFrame(raw);
        switch (result.kind) {
          case 'event':
            this.emit('event', result.event);
            return;
          case 'empty':
            this.logger.debug('lcu socket empty frame');
            return;
          case 'malformed': {
            // Never the raw text: a frame the schema refused can still be a login or chat payload.
            const scrubbed = scrubDroppedFrame(result.raw);
            this.logger.warn('lcu socket dropped frame', {
              reason: result.reason,
              ...('preview' in scrubbed
                ? { preview: scrubbed.preview }
                : 'uri' in scrubbed
                  ? { uri: scrubbed.uri, redacted: true }
                  : { frame: scrubbed.frame }),
            });
            this.emit('dropped', { reason: result.reason, raw: result.raw });
            return;
          }
        }
      });

      ws.on('error', (error) => {
        this.logger.warn('lcu socket error', { message: error.message });
        if (this.listenerCount('error') > 0) {
          this.emit('error', error);
        }
        if (!opened) {
          reject(error);
        }
      });

      ws.on('close', (code, reasonBuffer) => {
        const fromPeer = reasonBuffer.toString('utf8');
        const reason = fromPeer.length === 0 && this.heartbeatFailed ? HEARTBEAT_CLOSE_REASON : fromPeer;
        this.logger.info('lcu socket closed', { code, reason });
        if (this.ws === ws) {
          this.ws = undefined;
          this.stopHeartbeat();
        }
        this.emit('close', { code, reason });
        if (!opened) {
          reject(new Error(`socket closed before open (code ${code}${reason ? `: ${reason}` : ''})`));
        }
      });
    });
  }

  /** Closes the socket. Subscriptions are kept for the next `connect()`. */
  close(code = 1000, reason = 'client closing'): void {
    const ws = this.ws;
    this.stopHeartbeat();
    if (!ws) {
      return;
    }
    if (ws.readyState === WebSocket.CONNECTING) {
      ws.terminate();
      return;
    }
    ws.close(code, reason);
  }

  /**
   * Pings on a fixed interval while the socket is the active one. A ping only arms the pong deadline when
   * none is pending, so a slow peer is given one full timeout, not a shrinking one.
   */
  private startHeartbeat(ws: WebSocket): void {
    this.stopHeartbeat();
    this.heartbeatFailed = false;
    if (this.heartbeatMs <= 0) {
      return;
    }
    this.heartbeatTimer = setInterval(() => {
      if (this.ws !== ws || ws.readyState !== WebSocket.OPEN) {
        this.stopHeartbeat();
        return;
      }
      if (this.pongTimer === undefined) {
        this.pongTimer = setTimeout(() => {
          this.pongTimer = undefined;
          this.heartbeatFailed = true;
          this.logger.warn('lcu socket silent: no pong within the timeout; terminating it', {
            timeoutMs: this.heartbeatTimeoutMs,
          });
          ws.terminate();
        }, this.heartbeatTimeoutMs);
        this.pongTimer.unref?.();
      }
      ws.ping();
    }, this.heartbeatMs);
    this.heartbeatTimer.unref?.();
  }

  private clearPongTimer(): void {
    if (this.pongTimer !== undefined) {
      clearTimeout(this.pongTimer);
      this.pongTimer = undefined;
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    this.clearPongTimer();
  }

  private send(frame: string): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    ws.send(frame, (error) => {
      if (error) {
        this.logger.warn('lcu socket send failed', { message: error.message });
      }
    });
  }
}
