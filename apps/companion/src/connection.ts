/**
 * The connection state machine (`docs/01-architecture.md` "Companion"):
 *
 *   disconnected --(client_reached)--> connected --(socket_open)--> watching
 *   connected/watching --(client_lost | socket_closed)--> disconnected
 *   any --(stop)--> stopped
 *
 * `disconnected` polls for the lockfile every `pollIntervalMs` (5 s). `connected` means the HTTPS side answered
 * `GET /lol-patch/v1/game-version`; the local summoner and the gameflow phase are read and `onConnected` fires.
 * `watching` means the WebSocket is open and the subscription was sent; events are routed to the hooks by URI,
 * each parsed with its zod schema (a mismatch is logged with the URI and dropped). Back to `disconnected` when
 * the socket closes, the lockfile disappears or changes (a restarted client has a new port and password), or
 * HTTPS fails during `connected`. Reconnects use exponential backoff with jitter (1 s to 60 s), reset once
 * `watching` is reached. `run()` never resolves on an error; only `stop()` ends it.
 *
 * Hooks are the seams for M2.2 (lobby watcher), M2.3 (game capture) and M2.4 (rank sync). They run one at a
 * time, in event order, and anything they throw is logged and swallowed.
 */

import { EventEmitter } from 'node:events';
import {
  ALL_EVENTS_TOPIC,
  type DiscoverLockfileOptions,
  discoverLockfile,
  type EogStatsBlock,
  EogStatsBlockSchema,
  GameflowPhaseSchema,
  GameVersionSchema,
  type LcuClient,
  LcuClient as LcuClientClass,
  type LcuEvent,
  type LcuEventType,
  LcuSocket,
  type LcuSocketCloseInfo,
  type Lobby,
  LobbySchema,
  type LockfileCredentials,
  patchFromVersion,
  type RankedStats,
  RankedStatsSchema,
  type Summoner,
  SummonerSchema,
  type TlsMode,
} from '@customs/lcu';
import { Backoff, type BackoffOptions, sleep } from './backoff.js';
import { type CompanionLogger, createMemoryLogger, errorFields } from './log.js';

export type ConnectionState = 'disconnected' | 'connected' | 'watching' | 'stopped';

export type ConnectionEvent = 'client_reached' | 'socket_open' | 'socket_closed' | 'client_lost' | 'stop';

/** The whole state machine, as a table. Anything not listed is an illegal transition and is logged, not taken. */
export const TRANSITIONS: Readonly<
  Record<ConnectionState, Partial<Readonly<Record<ConnectionEvent, ConnectionState>>>>
> = {
  disconnected: { client_reached: 'connected', stop: 'stopped' },
  connected: { socket_open: 'watching', client_lost: 'disconnected', stop: 'stopped' },
  watching: { socket_closed: 'disconnected', client_lost: 'disconnected', stop: 'stopped' },
  stopped: {},
};

export const VERSION_PATH = '/lol-patch/v1/game-version';
export const CURRENT_SUMMONER_PATH = '/lol-summoner/v1/current-summoner';
export const GAMEFLOW_PHASE_PATH = '/lol-gameflow/v1/gameflow-phase';

/** The event URIs the hooks are fed. Everything else on the firehose is ignored (logged at debug only). */
export const LOBBY_URI = '/lol-lobby/v2/lobby';
export const GAMEFLOW_PHASE_URI = '/lol-gameflow/v1/gameflow-phase';
export const EOG_BLOCK_URI = '/lol-end-of-game/v1/eog-stats-block';
/**
 * `/lol-ranked/v1/cached-ranked-stats/{puuid}`: the client pushes another player's ranked stats unasked, for
 * lobby members and for the whole friends list (reference, question 10). Routed to `onRankedStats` with the
 * puuid from the URI; the rank sync (M2.4) uses it only for a puuid the server asked about.
 */
export const RANKED_STATS_URI_PREFIX = '/lol-ranked/v1/cached-ranked-stats/';

/** What a hook gets to work with while the client is up. Valid until the next `disconnected`. */
export interface ConnectedContext {
  /** Authenticated HTTPS client for the reads M2.3/M2.4 need. Never used to write in M2.1. */
  readonly client: LcuClient;
  /** Full client version string, and `major.minor` when it parsed. */
  readonly version: string;
  readonly patch: string | null;
  /** The local player, or null when `current-summoner` did not answer (logged). */
  readonly summoner: Summoner | null;
  /** The gameflow phase read at connect time, or null. M2.3 acts on `EndOfGame`/`WaitingForStats` here. */
  readonly phase: string | null;
}

export interface LobbyHookEvent {
  readonly eventType: LcuEventType;
  /** Null on `Delete` (the lobby is gone). */
  readonly lobby: Lobby | null;
}

export interface EogHookEvent {
  readonly eventType: LcuEventType;
  /** Null on `Delete`. */
  readonly block: EogStatsBlock | null;
}

export interface RankedStatsHookEvent {
  /** From the event URI; the body carries no puuid. */
  readonly puuid: string;
  readonly stats: RankedStats;
}

export interface CompanionHooks {
  onConnected?(context: ConnectedContext): Promise<void> | void;
  onLobbyEvent?(event: LobbyHookEvent, context: ConnectedContext): Promise<void> | void;
  onGameflowPhase?(phase: string, context: ConnectedContext): Promise<void> | void;
  onEogBlock?(event: EogHookEvent, context: ConnectedContext): Promise<void> | void;
  onRankedStats?(event: RankedStatsHookEvent, context: ConnectedContext): Promise<void> | void;
  onDisconnected?(reason: ConnectionEvent): Promise<void> | void;
}

export interface Transition {
  readonly from: ConnectionState;
  readonly to: ConnectionState;
  readonly event: ConnectionEvent;
}

export interface ConnectionMachineEvents {
  transition: [Transition];
}

export interface ConnectionMachineOptions {
  readonly logger?: CompanionLogger;
  readonly hooks?: CompanionHooks;
  /** Passed to `discoverLockfile`: the config's `lockfilePath` as `overridePath`; tests set `candidates`. */
  readonly lockfile?: DiscoverLockfileOptions;
  /** Defaults to pinning Riot's root. Tests pin to the fake client's certificate. */
  readonly tls?: TlsMode;
  /** Lockfile poll while disconnected, and the liveness check while watching. Default 5 s. */
  readonly pollIntervalMs?: number;
  readonly backoff?: BackoffOptions;
  /** Per-request timeout on the client. Default 10 s. */
  readonly requestTimeoutMs?: number;
}

export const DEFAULT_POLL_INTERVAL_MS = 5_000;

type WatchOutcome = 'socket_closed' | 'client_lost' | 'stop';

/** The same logger with `info` written at `debug`: file yes, console no. */
function quietInfo(logger: CompanionLogger): CompanionLogger {
  return {
    ...logger,
    info: (message, fields) => logger.debug(message, fields),
    child: (fields) => quietInfo(logger.child(fields)),
    get currentFile() {
      return logger.currentFile;
    },
  };
}

export class ConnectionMachine extends EventEmitter<ConnectionMachineEvents> {
  private readonly logger: CompanionLogger;
  private readonly lcuLogger: CompanionLogger;
  private readonly hooks: CompanionHooks;
  private readonly lockfileOptions: DiscoverLockfileOptions;
  private readonly tls: TlsMode | undefined;
  private readonly pollIntervalMs: number;
  private readonly requestTimeoutMs: number;
  private readonly backoff: Backoff;
  private readonly stopController = new AbortController();
  private currentState: ConnectionState = 'disconnected';
  private context: ConnectedContext | null = null;
  private socket: LcuSocket | null = null;
  private hookQueue: Promise<void> = Promise.resolve();
  private lastLockfileSummary: string | null = null;
  private running: Promise<void> | null = null;

  constructor(options: ConnectionMachineOptions = {}) {
    super();
    this.logger = options.logger ?? createMemoryLogger();
    // The client library reports its own open/close at info; the machine says the same in its own words
    // (`watching`, `socket closed`), so the library's lines go to the file only.
    this.lcuLogger = quietInfo(this.logger.child({ component: 'lcu' }));
    this.hooks = options.hooks ?? {};
    this.lockfileOptions = options.lockfile ?? {};
    this.tls = options.tls;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.backoff = new Backoff(options.backoff);
  }

  get state(): ConnectionState {
    return this.currentState;
  }

  /**
   * A method, not a property read, on purpose: `stop()` can land during any `await`, and TypeScript would
   * otherwise narrow `this.currentState` past the first check and flag the later ones as impossible.
   */
  private isStopped(): boolean {
    return this.currentState === 'stopped';
  }

  /** The current client context, or null unless `connected`/`watching`. */
  get connected(): ConnectedContext | null {
    return this.context;
  }

  get stopSignal(): AbortSignal {
    return this.stopController.signal;
  }

  /** Resolves when `state` becomes `target` (immediately if it already is). Tests use it. */
  waitForState(target: ConnectionState, timeoutMs = 10_000): Promise<void> {
    if (this.currentState === target) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off('transition', onTransition);
        reject(new Error(`timed out waiting for state ${target} (still ${this.currentState})`));
      }, timeoutMs);
      const onTransition = (transition: Transition): void => {
        if (transition.to === target) {
          clearTimeout(timer);
          this.off('transition', onTransition);
          resolve();
        }
      };
      this.on('transition', onTransition);
    });
  }

  /** Runs until `stop()`. Never rejects. Calling it twice returns the same promise. */
  run(): Promise<void> {
    this.running ??= this.loop();
    return this.running;
  }

  /** Ends the loop: aborts any wait, closes the socket, transitions to `stopped`. Safe to call twice. */
  stop(): void {
    if (this.currentState === 'stopped') {
      return;
    }
    this.transition('stop');
    this.stopController.abort();
    this.socket?.close();
  }

  private async loop(): Promise<void> {
    while (this.currentState !== 'stopped') {
      try {
        await this.cycle();
      } catch (error) {
        // A bug in a cycle must not end the companion. Log it and go around again.
        this.logger.error('connection cycle threw', errorFields(error));
        await sleep(this.backoff.next(), this.stopSignal);
      }
    }
    await this.hookQueue;
  }

  private transition(event: ConnectionEvent): boolean {
    const from = this.currentState;
    const to = TRANSITIONS[from][event];
    if (to === undefined) {
      this.logger.error('illegal connection transition ignored', { from, event });
      return false;
    }
    this.currentState = to;
    this.logger.debug(`connection ${from} -> ${to}`, { from, to, event });
    this.emit('transition', { from, to, event });
    return true;
  }

  private async cycle(): Promise<void> {
    const signal = this.stopSignal;
    const found = await discoverLockfile(this.lockfileOptions);
    if (found.status !== 'found') {
      const summary = found.tried.map((attempt) => `${attempt.path} (${attempt.reason})`).join(', ');
      if (summary !== this.lastLockfileSummary) {
        this.lastLockfileSummary = summary;
        this.logger.info('waiting for the League client', { tried: found.tried });
      }
      await sleep(this.pollIntervalMs, signal);
      return;
    }
    this.lastLockfileSummary = null;
    const credentials = found.credentials;
    this.logger.addSecret(credentials.password);

    const client = LcuClientClass.fromCredentials(credentials, {
      logger: this.lcuLogger,
      timeoutMs: this.requestTimeoutMs,
      ...(this.tls ? { tls: this.tls } : {}),
    });

    const version = await client.get(VERSION_PATH, GameVersionSchema);
    if (!version.ok) {
      this.logger.warn('lockfile present but the client is not answering yet', {
        path: found.path,
        port: credentials.port,
        reason: version.reason,
        status: version.status,
      });
      client.close();
      await sleep(this.backoff.next(), signal);
      return;
    }
    if (signal.aborted) {
      client.close();
      return;
    }
    if (!this.transition('client_reached')) {
      client.close();
      return;
    }

    const context = await this.buildContext(client, version.json);
    if (this.isStopped()) {
      client.close();
      return;
    }
    if (context === null) {
      // HTTPS failed between two reads: the client is going away. Back to disconnected.
      this.transition('client_lost');
      client.close();
      await sleep(this.backoff.next(), signal);
      return;
    }
    this.context = context;
    this.logger.info('connected to the League client', {
      version: context.version,
      patch: context.patch,
      port: credentials.port,
      puuid: context.summoner?.puuid ?? null,
      riotId: context.summoner ? `${context.summoner.gameName}#${context.summoner.tagLine}` : null,
      phase: context.phase,
    });
    await this.runHook('onConnected', () => this.hooks.onConnected?.(context));

    const socket = LcuSocket.fromCredentials(credentials, {
      logger: this.lcuLogger,
      ...(this.tls ? { tls: this.tls } : {}),
    });
    this.socket = socket;
    socket.subscribe(ALL_EVENTS_TOPIC);
    const closed = new Promise<LcuSocketCloseInfo>((resolve) => socket.once('close', resolve));
    socket.on('event', (event) => this.dispatch(event, context));
    socket.on('error', () => {
      // Already logged by the socket; the `close` that follows drives the state machine.
    });

    try {
      await socket.connect();
    } catch (error) {
      this.logger.warn('socket did not open', errorFields(error));
      this.teardown(client, socket);
      if (!this.isStopped()) {
        this.transition('client_lost');
        await this.runHook('onDisconnected', () => this.hooks.onDisconnected?.('client_lost'));
        await sleep(this.backoff.next(), signal);
      }
      return;
    }
    if (this.isStopped()) {
      this.teardown(client, socket);
      return;
    }
    this.transition('socket_open');
    this.backoff.reset();
    this.logger.info('watching', { subscriptions: socket.subscriptions });

    const outcome = await this.watch(closed, credentials);
    this.teardown(client, socket);
    if (outcome === 'stop') {
      return;
    }
    this.transition(outcome);
    await this.runHook('onDisconnected', () => this.hooks.onDisconnected?.(outcome));
    await sleep(this.backoff.next(), signal);
  }

  private async buildContext(client: LcuClient, version: string): Promise<ConnectedContext | null> {
    const summonerResult = await client.get(CURRENT_SUMMONER_PATH, SummonerSchema);
    if (!summonerResult.ok && summonerResult.reason === 'network') {
      return null;
    }
    if (!summonerResult.ok) {
      this.logger.warn('current-summoner unavailable; continuing without the local player', {
        reason: summonerResult.reason,
        status: summonerResult.status,
      });
    }
    const phaseResult = await client.get(GAMEFLOW_PHASE_PATH, GameflowPhaseSchema);
    if (!phaseResult.ok && phaseResult.reason === 'network') {
      return null;
    }
    return {
      client,
      version,
      patch: patchFromVersion(version),
      summoner: summonerResult.ok ? summonerResult.json : null,
      phase: phaseResult.ok ? phaseResult.json : null,
    };
  }

  /**
   * Waits in `watching` until the socket closes, the lockfile goes away or changes, or `stop()`.
   * The lockfile check is the same poll interval as discovery; it catches a client that exited without
   * closing the socket cleanly (sleep, kill) and a restart that has already written a new lockfile.
   */
  private async watch(
    closed: Promise<LcuSocketCloseInfo>,
    credentials: LockfileCredentials,
  ): Promise<WatchOutcome> {
    const cycleController = new AbortController();
    const cycleSignal = cycleController.signal;
    const onStop = (): void => cycleController.abort();
    this.stopSignal.addEventListener('abort', onStop, { once: true });

    const socketClosed = closed.then((info): WatchOutcome => {
      this.logger.info('socket closed', { code: info.code, reason: info.reason });
      return 'socket_closed';
    });
    const lockfileLost = (async (): Promise<WatchOutcome> => {
      for (;;) {
        await sleep(this.pollIntervalMs, cycleSignal);
        if (cycleSignal.aborted) {
          return 'stop';
        }
        const found = await discoverLockfile(this.lockfileOptions);
        if (found.status !== 'found') {
          this.logger.info('lockfile gone; the client has exited');
          return 'client_lost';
        }
        if (
          found.credentials.port !== credentials.port ||
          found.credentials.password !== credentials.password
        ) {
          this.logger.info('lockfile changed; the client restarted', { port: found.credentials.port });
          return 'client_lost';
        }
      }
    })();
    const stopped = new Promise<WatchOutcome>((resolve) => {
      if (this.stopSignal.aborted) {
        resolve('stop');
      } else {
        this.stopSignal.addEventListener('abort', () => resolve('stop'), { once: true });
      }
    });

    try {
      const outcome = await Promise.race([socketClosed, lockfileLost, stopped]);
      return this.currentState === 'stopped' ? 'stop' : outcome;
    } finally {
      cycleController.abort();
      this.stopSignal.removeEventListener('abort', onStop);
    }
  }

  private teardown(client: LcuClient, socket: LcuSocket): void {
    if (this.socket === socket) {
      this.socket = null;
    }
    this.context = null;
    socket.removeAllListeners('event');
    socket.close();
    client.close();
  }

  private dispatch(event: LcuEvent, context: ConnectedContext): void {
    if (event.uri.startsWith(RANKED_STATS_URI_PREFIX)) {
      const puuid = event.uri.slice(RANKED_STATS_URI_PREFIX.length);
      if (event.eventType === 'Delete' || event.data === null || puuid.length === 0) {
        this.logger.debug('lcu event ignored', { uri: event.uri, eventType: event.eventType });
        return;
      }
      const parsed = RankedStatsSchema.safeParse(event.data);
      if (!parsed.success) {
        this.dropEvent(event, parsed.error.issues);
        return;
      }
      const stats = parsed.data;
      this.runHook('onRankedStats', () => this.hooks.onRankedStats?.({ puuid, stats }, context));
      return;
    }
    switch (event.uri) {
      case LOBBY_URI: {
        if (event.eventType === 'Delete' || event.data === null) {
          this.runHook('onLobbyEvent', () =>
            this.hooks.onLobbyEvent?.({ eventType: event.eventType, lobby: null }, context),
          );
          return;
        }
        const parsed = LobbySchema.safeParse(event.data);
        if (!parsed.success) {
          this.dropEvent(event, parsed.error.issues);
          return;
        }
        const lobby = parsed.data;
        this.runHook('onLobbyEvent', () =>
          this.hooks.onLobbyEvent?.({ eventType: event.eventType, lobby }, context),
        );
        return;
      }
      case GAMEFLOW_PHASE_URI: {
        const parsed = GameflowPhaseSchema.safeParse(event.data);
        if (!parsed.success) {
          this.dropEvent(event, parsed.error.issues);
          return;
        }
        const phase = parsed.data;
        this.runHook('onGameflowPhase', () => this.hooks.onGameflowPhase?.(phase, context));
        return;
      }
      case EOG_BLOCK_URI: {
        if (event.eventType === 'Delete' || event.data === null) {
          this.runHook('onEogBlock', () =>
            this.hooks.onEogBlock?.({ eventType: event.eventType, block: null }, context),
          );
          return;
        }
        const parsed = EogStatsBlockSchema.safeParse(event.data);
        if (!parsed.success) {
          this.dropEvent(event, parsed.error.issues);
          return;
        }
        const block = parsed.data;
        this.runHook('onEogBlock', () =>
          this.hooks.onEogBlock?.({ eventType: event.eventType, block }, context),
        );
        return;
      }
      default:
        // The firehose carries everything the client does. URI and type only; payloads never hit the log.
        this.logger.debug('lcu event ignored', { uri: event.uri, eventType: event.eventType });
    }
  }

  private dropEvent(event: LcuEvent, issues: readonly { path: PropertyKey[]; message: string }[]): void {
    this.logger.warn('lcu event did not match its schema; dropped', {
      uri: event.uri,
      eventType: event.eventType,
      issues: issues.slice(0, 5).map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`),
    });
  }

  /** Runs hooks one after another, in order, and never lets one of them take the loop down. */
  private runHook(name: keyof CompanionHooks, invoke: () => Promise<void> | void): Promise<void> {
    const next = this.hookQueue.then(async () => {
      try {
        await invoke();
      } catch (error) {
        this.logger.error(`hook ${name} threw`, errorFields(error));
      }
    });
    this.hookQueue = next;
    return next;
  }
}
