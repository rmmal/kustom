/**
 * HTTPS client bound to the local League client.
 *
 * This is the only place in the repo that imports `node:https` to reach 127.0.0.1 (CLAUDE.md "Hard rules").
 * Every response is parsed with the caller's zod schema; a mismatch is logged with the endpoint and returned
 * as a typed failure. Nothing here throws for a bad response, a bad body, or a dead client.
 */

import { Agent, request as httpsRequest } from 'node:https';
import type { z } from 'zod';
import { basicAuthHeader, LCU_HOST } from './auth.js';
import type { LockfileCredentials } from './lockfile.js';
import { type Logger, silentLogger } from './log.js';
import { DEFAULT_TLS_MODE, type TlsMode, tlsConnectionOptions } from './tls.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface LcuClientOptions {
  readonly port: number;
  readonly password: string;
  /** Defaults to `DEFAULT_TLS_MODE` (pinned to Riot's root). */
  readonly tls?: TlsMode;
  /** Per-request timeout. Default 10 s. */
  readonly timeoutMs?: number;
  readonly logger?: Logger;
  /** Only tests change this. The real client is always loopback. */
  readonly host?: string;
}

/** The body of a response as the client saw it, before any schema is applied. */
export type RawBody =
  | { readonly parsed: true; readonly value: unknown }
  | { readonly parsed: false; readonly error: string };

/** What came back on the wire, or why nothing did. */
export type RawResponse =
  | {
      readonly kind: 'response';
      readonly status: number;
      readonly contentType: string | undefined;
      readonly text: string;
      readonly body: RawBody;
    }
  | { readonly kind: 'network'; readonly code: string | undefined; readonly message: string };

export type LcuFailure =
  /** The client answered outside 2xx. `json` is the parsed body when it was JSON, else the raw text. */
  | { readonly ok: false; readonly reason: 'http'; readonly status: number; readonly json: unknown }
  /** 2xx but the body was not JSON. */
  | { readonly ok: false; readonly reason: 'malformed'; readonly status: number; readonly text: string }
  /** 2xx JSON that did not match the schema. */
  | {
      readonly ok: false;
      readonly reason: 'schema';
      readonly status: number;
      readonly json: unknown;
      readonly issues: readonly string[];
    }
  /** No HTTP response at all: refused, timed out, TLS failure. */
  | {
      readonly ok: false;
      readonly reason: 'network';
      readonly status: 0;
      readonly code: string | undefined;
      readonly message: string;
    };

export type LcuResponse<T> = { readonly ok: true; readonly status: number; readonly json: T } | LcuFailure;

function errorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return undefined;
}

/** Parses a body the way the client does: empty means `null`, anything else must be JSON. */
export function parseBody(text: string): RawBody {
  if (text.trim().length === 0) {
    return { parsed: true, value: null };
  }
  try {
    return { parsed: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return { parsed: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export class LcuClient {
  readonly port: number;
  readonly host: string;
  readonly tls: TlsMode;
  private readonly authorization: string;
  private readonly timeoutMs: number;
  private readonly logger: Logger;
  private readonly agent: Agent;

  constructor(options: LcuClientOptions) {
    this.port = options.port;
    this.host = options.host ?? LCU_HOST;
    this.tls = options.tls ?? DEFAULT_TLS_MODE;
    this.authorization = basicAuthHeader(options.password);
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.logger = options.logger ?? silentLogger;
    this.agent = new Agent({ keepAlive: true, maxSockets: 4, ...tlsConnectionOptions(this.tls) });
  }

  static fromCredentials(
    credentials: LockfileCredentials,
    options: Omit<LcuClientOptions, 'port' | 'password'> = {},
  ): LcuClient {
    return new LcuClient({ ...options, port: credentials.port, password: credentials.password });
  }

  get baseUrl(): string {
    return `https://${this.host}:${this.port}`;
  }

  /** Releases keep-alive sockets so a process can exit. The client is unusable afterwards. */
  close(): void {
    this.agent.destroy();
  }

  get<T>(path: string, schema: z.ZodType<T>): Promise<LcuResponse<T>> {
    return this.request('GET', path, undefined, schema);
  }

  post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<LcuResponse<T>> {
    return this.request('POST', path, body, schema);
  }

  put<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<LcuResponse<T>> {
    return this.request('PUT', path, body, schema);
  }

  delete<T>(path: string, schema: z.ZodType<T>): Promise<LcuResponse<T>> {
    return this.request('DELETE', path, undefined, schema);
  }

  async request<T>(
    method: HttpMethod,
    path: string,
    body: unknown,
    schema: z.ZodType<T>,
  ): Promise<LcuResponse<T>> {
    const endpoint = `${method} ${path}`;
    const raw = await this.raw(method, path, body);
    if (raw.kind === 'network') {
      this.logger.warn('lcu request failed', { endpoint, code: raw.code, message: raw.message });
      return { ok: false, reason: 'network', status: 0, code: raw.code, message: raw.message };
    }
    const { status, text } = raw;
    if (status < 200 || status >= 300) {
      this.logger.warn('lcu non-2xx', { endpoint, status });
      return { ok: false, reason: 'http', status, json: raw.body.parsed ? raw.body.value : text };
    }
    if (!raw.body.parsed) {
      this.logger.warn('lcu body is not JSON', {
        endpoint,
        status,
        error: raw.body.error,
        preview: text.slice(0, 120),
      });
      return { ok: false, reason: 'malformed', status, text };
    }
    const parsed = schema.safeParse(raw.body.value);
    if (!parsed.success) {
      const issues = parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`,
      );
      this.logger.warn('lcu response did not match schema', { endpoint, status, issues });
      return { ok: false, reason: 'schema', status, json: raw.body.value, issues };
    }
    return { ok: true, status, json: parsed.data };
  }

  /**
   * One HTTP round trip with no schema. The smoke script uses this to save bodies verbatim;
   * everything else should go through `get`/`post`.
   */
  raw(method: HttpMethod, path: string, body?: unknown): Promise<RawResponse> {
    if (!path.startsWith('/')) {
      return Promise.resolve({
        kind: 'network',
        code: 'ERR_LCU_BAD_PATH',
        message: `path must start with "/": ${path}`,
      });
    }
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers: Record<string, string> = {
      authorization: this.authorization,
      accept: 'application/json',
    };
    if (payload !== undefined) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = String(Buffer.byteLength(payload));
    }

    return new Promise<RawResponse>((resolve) => {
      let settled = false;
      const finish = (response: RawResponse): void => {
        if (!settled) {
          settled = true;
          resolve(response);
        }
      };

      const req = httpsRequest(
        {
          host: this.host,
          port: this.port,
          path,
          method,
          headers,
          agent: this.agent,
          timeout: this.timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('error', (error) =>
            finish({ kind: 'network', code: errorCode(error), message: error.message }),
          );
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            const contentType = res.headers['content-type'];
            finish({
              kind: 'response',
              status: res.statusCode ?? 0,
              contentType,
              text,
              body: parseBody(text),
            });
          });
        },
      );
      req.on('timeout', () => {
        req.destroy(Object.assign(new Error(`timed out after ${this.timeoutMs} ms`), { code: 'ETIMEDOUT' }));
      });
      req.on('error', (error) => finish({ kind: 'network', code: errorCode(error), message: error.message }));
      if (payload !== undefined) {
        req.write(payload);
      }
      req.end();
    });
  }
}
