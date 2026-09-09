/**
 * The lobby watcher (M2.2): a faithful mirror of `/lol-lobby/v2/lobby`, pushed to `POST /api/companion/lobby`
 * the instant it changes. It decides nothing; the ten seconds, the balance and the states are the server's.
 *
 * Input is the one URI, already parsed by the connection machine (`onLobbyEvent`), plus one GET of the lobby
 * at connect time for the "someone started the companion after everyone had joined" case. The payload is
 * built by `mapLobby` from `@customs/lcu`; this file holds no copy of the mapping.
 *
 * Posting rules (the M2.2 brief):
 *  - at most one POST in flight; the newest payload waits and everything it superseded is dropped;
 *  - a failed post is retried with backoff only while it is still the newest payload;
 *  - `recheckInMs` in the answer schedules a re-post of the byte-identical payload unless a newer one lands
 *    first; `ranksNeeded` is kept for the rank sync (M2.4); `rosterFrozen` is logged;
 *  - a 403 stops posting that party until the next `Create`;
 *  - a `Delete` posts nothing (it fires after `GameStart`, and an empty roster there would wipe the ten
 *    people the game post is about to need);
 *  - names never hold a post up: unknown puuids are posted with null names, looked up once per process in
 *    the background (at most five a second), and the roster is re-posted once when the lookups finish.
 *
 * Log fields are ids and counts. Never a lobby body: it carries chat credentials.
 */

import {
  type CompanionLobbyPayloadInput,
  type CompanionLobbyResponse,
  companionLobbyResponseSchema,
} from '@customs/db/schemas';
import {
  fillPath,
  isLobbyBot,
  type Lobby,
  LobbySchema,
  mapLobby,
  nameFromSummoner,
  type RiotIdName,
  readEndpoint,
  SummonerSchema,
} from '@customs/lcu';
import { type ApiClient, type ApiResult, failureFields } from './api.js';
import { Backoff, type BackoffOptions, sleep } from './backoff.js';
import type { CompanionHooks, ConnectedContext, LobbyHookEvent } from './connection.js';
import { type CompanionLogger, createMemoryLogger, errorFields } from './log.js';

export const LOBBY_API_PATH = '/api/companion/lobby';
export const LOBBY_PATH = readEndpoint('lobby').path;
const SUMMONER_BY_PUUID_PATH = readEndpoint('summoner-by-puuid').path;

/** Five lookups a second, so a lobby of ten unknown players cannot stall the client. */
export const DEFAULT_LOOKUP_INTERVAL_MS = 200;

/** Runs `fn` after `ms`; returns a cancel function. Injected in tests. */
export type Scheduler = (fn: () => void, ms: number) => () => void;

export const realScheduler: Scheduler = (fn, ms) => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};

export interface LobbyWatcherOptions {
  readonly api: ApiClient;
  readonly logger?: CompanionLogger;
  /** Minimum spacing between two summoner lookups. Default 200 ms. */
  readonly lookupIntervalMs?: number;
  /** Delay between retries of a failed post while it is still the newest. Default 1 s to 60 s. */
  readonly backoff?: BackoffOptions;
  readonly schedule?: Scheduler;
  /** Called with every successful answer; the rank sync (M2.4) takes `ranksNeeded` from it. Never awaited. */
  readonly onResponse?: (response: CompanionLobbyResponse) => void;
  /**
   * The password this process set when it created the party (the command runner, M4.1/M4.2), or null. A
   * non-null value rides on every lobby post for that party; null leaves `lobbyPassword` null, which the
   * server never treats as "clear it". The lobby `Create` event usually lands before the runner has read the
   * new party id back, so the first post after a create may carry null and the password rides on the next
   * roster change.
   */
  readonly passwordFor?: (partyId: string) => string | null;
}

interface Item {
  readonly payload: CompanionLobbyPayloadInput;
  /** Which "current payload" this is. A deferred re-post only fires while it is still the newest. */
  readonly sequence: number;
}

type Source = 'Create' | 'Update' | 'connect' | 'names';

export class LobbyWatcher {
  private readonly api: ApiClient;
  private readonly logger: CompanionLogger;
  private readonly lookupIntervalMs: number;
  private readonly retryBackoff: Backoff;
  private readonly schedule: Scheduler;
  private readonly onResponse: ((response: CompanionLobbyResponse) => void) | undefined;
  private readonly passwordFor: ((partyId: string) => string | null) | undefined;
  private readonly stopController = new AbortController();

  private context: ConnectedContext | null = null;
  private currentLobby: Lobby | null = null;
  private latest: Item | null = null;
  private pending: Item | null = null;
  private inFlight = false;
  private sequence = 0;
  private deferred: (() => void) | null = null;
  private blockedParty: string | null = null;
  private eventCount = 0;
  private lastResponseValue: CompanionLobbyResponse | null = null;
  private readonly frozenLogged = new Set<string>();
  private readonly skippedParties = new Set<string>();

  private readonly names = new Map<string, RiotIdName>();
  private readonly lookedUp = new Set<string>();
  private readonly lookupQueue: string[] = [];
  private draining = false;

  constructor(options: LobbyWatcherOptions) {
    this.api = options.api;
    this.logger = (options.logger ?? createMemoryLogger()).child({ component: 'lobby' });
    this.lookupIntervalMs = options.lookupIntervalMs ?? DEFAULT_LOOKUP_INTERVAL_MS;
    this.retryBackoff = new Backoff(options.backoff);
    this.schedule = options.schedule ?? realScheduler;
    this.onResponse = options.onResponse;
    this.passwordFor = options.passwordFor;
  }

  /** The last answer the API gave, or null before the first successful post. */
  get lastResponse(): CompanionLobbyResponse | null {
    return this.lastResponseValue;
  }

  /** PUUIDs the server would like a rank for, from the last successful post (M2.4 consumes this). */
  get ranksNeeded(): readonly string[] {
    return this.lastResponseValue?.ranksNeeded ?? [];
  }

  /** Names known to this process, by puuid. Read-only; the rank sync may reuse it. */
  get knownNames(): ReadonlyMap<string, RiotIdName> {
    return this.names;
  }

  /** The hooks to hand to the connection machine. */
  hooks(): CompanionHooks {
    return {
      onConnected: (context) => this.onConnected(context),
      onLobbyEvent: (event) => this.onLobbyEvent(event),
      onDisconnected: () => this.onDisconnected(),
    };
  }

  /** Cancels every timer and background loop. Posts already in flight finish on their own. */
  stop(): void {
    this.cancelDeferred();
    this.stopController.abort();
    this.pending = null;
    this.context = null;
    this.currentLobby = null;
  }

  /** Resolves once nothing is in flight, queued or being looked up. Tests use it. */
  settled(timeoutMs = 5_000): Promise<void> {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = (): void => {
        if (!this.inFlight && this.pending === null && !this.draining) {
          resolve();
        } else if (Date.now() - started > timeoutMs) {
          reject(new Error('lobby watcher did not settle'));
        } else {
          setTimeout(tick, 5);
        }
      };
      tick();
    });
  }

  private onConnected(context: ConnectedContext): void {
    this.context = context;
    if (context.summoner) {
      this.names.set(context.summoner.puuid, nameFromSummoner(context.summoner));
      this.lookedUp.add(context.summoner.puuid);
    }
    const eventsAtStart = this.eventCount;
    // Not awaited: the machine waits for this hook before opening the socket, and a slow client must not
    // delay the subscription. If a lobby event lands before the GET answers, the event wins.
    void this.readLobbyAtConnect(context, eventsAtStart);
  }

  private async readLobbyAtConnect(context: ConnectedContext, eventsAtStart: number): Promise<void> {
    try {
      const result = await context.client.get(LOBBY_PATH, LobbySchema);
      if (this.context !== context || this.eventCount !== eventsAtStart) {
        this.logger.debug('lobby read at connect superseded by an event');
        return;
      }
      if (result.ok) {
        this.logger.info('already in a lobby at connect', {
          partyId: result.json.partyId,
          members: result.json.members.length,
        });
        this.handleLobby(result.json, 'connect');
        return;
      }
      if (result.reason === 'http' && result.status === 404) {
        this.logger.debug('no lobby open at connect');
        return;
      }
      this.logger.warn('could not read the lobby at connect; waiting for events', {
        reason: result.reason,
        status: result.status,
      });
    } catch (error) {
      this.logger.error('lobby read at connect threw', errorFields(error));
    }
  }

  private onLobbyEvent(event: LobbyHookEvent): void {
    this.eventCount += 1;
    if (event.lobby === null) {
      // Delete: the lobby is gone because the game started. Nothing is posted; a deferred re-post of the
      // old roster is superseded, but a coalesced newest payload still goes out.
      this.sequence += 1;
      this.cancelDeferred();
      this.currentLobby = null;
      this.logger.info('lobby closed; nothing posted', { eventType: event.eventType });
      return;
    }
    if (event.eventType === 'Create') {
      this.blockedParty = null;
    }
    this.handleLobby(event.lobby, event.eventType === 'Create' ? 'Create' : 'Update');
  }

  private onDisconnected(): void {
    this.context = null;
    this.currentLobby = null;
    this.cancelDeferred();
  }

  private handleLobby(lobby: Lobby, source: Source): void {
    if (!lobby.gameConfig.isCustom) {
      if (!this.skippedParties.has(lobby.partyId)) {
        this.skippedParties.add(lobby.partyId);
        this.logger.info('lobby is not a custom game; not posting it', {
          partyId: lobby.partyId,
          queueId: lobby.gameConfig.queueId,
        });
      }
      this.currentLobby = null;
      return;
    }
    this.currentLobby = lobby;
    const mapped = mapLobby(lobby, this.names);
    const password = this.passwordFor?.(lobby.partyId) ?? null;
    const payload = password === null ? mapped : { ...mapped, lobbyPassword: password };
    if (this.enqueue(payload, source)) {
      // Names are only worth fetching for a roster that is actually being posted.
      this.scheduleLookups(lobby);
    }
  }

  /** Makes `payload` the newest; returns false when the party is blocked after a 403. */
  private enqueue(payload: CompanionLobbyPayloadInput, source: Source): boolean {
    if (this.blockedParty === payload.partyId) {
      this.logger.debug('lobby post skipped: party refused earlier', { partyId: payload.partyId, source });
      return false;
    }
    this.sequence += 1;
    this.cancelDeferred();
    // A new payload starts its own retry schedule; the old one's delays belonged to the old roster.
    this.retryBackoff.reset();
    const item: Item = { payload, sequence: this.sequence };
    this.latest = item;
    this.logger.debug('lobby payload ready', {
      partyId: payload.partyId,
      members: payload.members.length,
      source,
      coalesced: this.inFlight,
    });
    if (this.inFlight) {
      this.pending = item;
      return true;
    }
    void this.post(item);
    return true;
  }

  private async post(item: Item): Promise<void> {
    this.inFlight = true;
    try {
      // One attempt per call: `ApiClient`'s own retries would re-send a payload that a newer event has
      // already superseded and hold the coalescing slot for a minute. The newest-only retry lives in
      // `handleResult` -> `defer`.
      const result = await this.api.request(
        'POST',
        LOBBY_API_PATH,
        item.payload,
        companionLobbyResponseSchema,
        1,
      );
      this.handleResult(item, result);
    } catch (error) {
      // `ApiClient.post` never throws; this guards the handling above so the loop below always runs.
      this.logger.error('lobby post threw', errorFields(error));
    } finally {
      this.inFlight = false;
    }
    const next = this.pending;
    this.pending = null;
    if (next !== null && !this.stopController.signal.aborted) {
      void this.post(next);
    }
  }

  private handleResult(item: Item, result: ApiResult<CompanionLobbyResponse>): void {
    const { partyId } = item.payload;
    const superseded = item.sequence !== this.sequence;
    if (result.ok) {
      this.retryBackoff.reset();
      this.lastResponseValue = result.data;
      const { data } = result;
      this.logger.info('lobby posted', {
        partyId,
        members: item.payload.members.length,
        status: data.status,
        memberCount: data.memberCount,
        created: data.created,
        rosterFrozen: data.rosterFrozen,
        recheckInMs: data.recheckInMs,
        ranksNeeded: data.ranksNeeded.length,
      });
      if (data.rosterFrozen && !this.frozenLogged.has(partyId)) {
        this.frozenLogged.add(partyId);
        this.logger.info('lobby roster is frozen on the server; posts no longer change it', {
          partyId,
          status: data.status,
          memberCount: data.memberCount,
        });
      }
      if (!superseded && typeof data.recheckInMs === 'number') {
        this.defer(item, data.recheckInMs, 'recheck');
      }
      try {
        this.onResponse?.(data);
      } catch (error) {
        this.logger.error('lobby response listener threw', errorFields(error));
      }
      return;
    }
    if (result.reason === 'http' && result.status === 403) {
      this.blockedParty = partyId;
      this.logger.warn(
        'api refused the lobby post: this companion is not in that lobby; not posting the party again until the next Create',
        {
          partyId,
          status: result.status,
          error: result.error,
        },
      );
      return;
    }
    const retryable = result.reason === 'network' || (result.reason === 'http' && result.status >= 500);
    if (retryable && !superseded) {
      const delayMs = this.retryBackoff.next();
      this.logger.warn('lobby post failed; retrying while it is still the newest', {
        partyId,
        delayMs,
        ...failureFields(result),
      });
      this.defer(item, delayMs, 'retry');
      return;
    }
    this.logger.warn('lobby post dropped', { partyId, superseded, ...failureFields(result) });
  }

  private defer(item: Item, ms: number, reason: 'recheck' | 'retry'): void {
    this.cancelDeferred();
    if (this.stopController.signal.aborted) {
      return;
    }
    this.deferred = this.schedule(() => {
      this.deferred = null;
      if (item.sequence !== this.sequence) {
        this.logger.debug(`lobby ${reason} skipped: a newer payload landed`, {
          partyId: item.payload.partyId,
        });
        return;
      }
      this.logger.debug(`lobby ${reason}: re-posting the same payload`, {
        partyId: item.payload.partyId,
        ms,
      });
      if (this.inFlight) {
        this.pending = item;
        return;
      }
      void this.post(item);
    }, ms);
  }

  private cancelDeferred(): void {
    if (this.deferred !== null) {
      this.deferred();
      this.deferred = null;
    }
  }

  private scheduleLookups(lobby: Lobby): void {
    for (const member of lobby.members) {
      if (isLobbyBot(member) || this.lookedUp.has(member.puuid)) {
        continue;
      }
      this.lookedUp.add(member.puuid);
      this.lookupQueue.push(member.puuid);
    }
    if (this.lookupQueue.length > 0) {
      void this.drainLookups();
    }
  }

  private async drainLookups(): Promise<void> {
    if (this.draining) {
      return;
    }
    this.draining = true;
    let changed = false;
    try {
      while (this.lookupQueue.length > 0 && !this.stopController.signal.aborted) {
        const context = this.context;
        if (context === null) {
          // Disconnected before these were asked: let the next connection ask.
          for (const puuid of this.lookupQueue.splice(0)) {
            this.lookedUp.delete(puuid);
          }
          break;
        }
        const puuid = this.lookupQueue.shift() as string;
        const startedAt = Date.now();
        const result = await context.client.get(fillPath(SUMMONER_BY_PUUID_PATH, { puuid }), SummonerSchema);
        if (result.ok) {
          this.names.set(puuid, nameFromSummoner(result.json));
          changed = true;
          this.logger.debug('summoner name resolved', { puuid });
        } else {
          this.logger.warn('summoner lookup failed; the roster is posted without that name', {
            puuid,
            reason: result.reason,
            status: result.status,
          });
        }
        if (this.lookupQueue.length > 0) {
          const elapsed = Date.now() - startedAt;
          await sleep(this.lookupIntervalMs - elapsed, this.stopController.signal);
        }
      }
    } catch (error) {
      this.logger.error('summoner lookups threw', errorFields(error));
    } finally {
      this.draining = false;
    }
    if (changed) {
      this.repostWithNames();
    }
  }

  /** One coalesced re-post with the names filled in, only when it changes what was last sent. */
  private repostWithNames(): void {
    if (this.currentLobby === null) {
      return;
    }
    const payload = mapLobby(this.currentLobby, this.names);
    if (this.latest !== null && JSON.stringify(payload) === JSON.stringify(this.latest.payload)) {
      return;
    }
    this.enqueue(payload, 'names');
  }
}
