/**
 * Rank and name sync (M2.4). Two reads, one post, for exactly the PUUIDs the server asks about.
 *
 * - **Own rank** on the first successful client connection and then every 6 hours (injected clock):
 *   `GET /lol-ranked/v1/current-ranked-stats`, mapped with `mapRank`, posted with the own Riot ID.
 * - **Everyone else:** the lobby response's `ranksNeeded` (M2.5's 7-day window is the schedule; this process
 *   holds no staleness rule) is the **only** list this file fetches for. For each puuid:
 *   `GET /lol-ranked/v1/ranked-stats/{puuid}`, then `GET /lol-summoner/v2/summoners/puuid/{puuid}` unless the
 *   lobby watcher already knows the name, then one `POST /api/companion/rank` carrying tier, division, lp and
 *   the name. Tier and division go verbatim; the server normalises unranked.
 * - The firehose's `/lol-ranked/v1/cached-ranked-stats/{puuid}` push is a shortcut only: an event for a puuid
 *   currently in `ranksNeeded` replaces its GET; an event for anyone else is dropped unread. The database is a
 *   record of a group of friends' customs, not a scrape of a friends list.
 * - Pacing: serial, at most one client call per 200 ms across the whole pass, so ten unknown players cannot
 *   stall the client. A failed lookup is logged and left for the next lobby response; the in-memory "asked in
 *   the last hour" set is a de-duplicator, not a policy. Nothing here holds up a lobby post.
 *
 * The client's win/loss counters are never read: only `tier`, `division` and `leaguePoints` are truth for
 * another player (reference, question 10 and the ranked row). Our own `games` rows are the record.
 */

import { type CompanionRankPayloadInput, companionRankResponseSchema } from '@customs/db/schemas';
import {
  fillPath,
  mapRank,
  nameFromSummoner,
  type RankedStats,
  RankedStatsSchema,
  type RiotIdName,
  readEndpoint,
  SummonerSchema,
} from '@customs/lcu';
import { type ApiClient, failureFields } from './api.js';
import { sleep } from './backoff.js';
import type { CompanionHooks, ConnectedContext, RankedStatsHookEvent } from './connection.js';
import { realScheduler, type Scheduler } from './lobbyWatcher.js';
import { type CompanionLogger, createMemoryLogger, errorFields } from './log.js';

export const RANK_API_PATH = '/api/companion/rank';
export const CURRENT_RANKED_STATS_PATH = readEndpoint('current-ranked-stats').path;
export const RANKED_STATS_BY_PUUID_PATH = readEndpoint('ranked-stats-by-puuid').path;
const SUMMONER_BY_PUUID_PATH = readEndpoint('summoner-by-puuid').path;

export const OWN_RANK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** A puuid asked about within this window is not asked again, whatever the server says. */
export const ASKED_TTL_MS = 60 * 60 * 1000;
/** Five client calls a second, across ranks and names together. */
export const DEFAULT_CALL_INTERVAL_MS = 200;

export interface RankSyncOptions {
  readonly api: ApiClient;
  readonly logger?: CompanionLogger;
  /** Injected clock for the 6-hour timer and the 1-hour guard. Default `Date.now`. */
  readonly now?: () => number;
  readonly schedule?: Scheduler;
  /** Minimum spacing between two client calls. Default 200 ms. */
  readonly callIntervalMs?: number;
  readonly ownIntervalMs?: number;
  readonly askedTtlMs?: number;
  /** Names another part of the process already resolved (the lobby watcher's cache); read, never written. */
  readonly names?: ReadonlyMap<string, RiotIdName>;
  /** Attempts for a rank post. Default 2: one quick retry, never a storm. */
  readonly postAttempts?: number;
}

export class RankSync {
  private readonly api: ApiClient;
  private readonly logger: CompanionLogger;
  private readonly now: () => number;
  private readonly schedule: Scheduler;
  private readonly callIntervalMs: number;
  private readonly ownIntervalMs: number;
  private readonly askedTtlMs: number;
  private readonly sharedNames: ReadonlyMap<string, RiotIdName> | undefined;
  private readonly postAttempts: number;
  private readonly stopController = new AbortController();

  private context: ConnectedContext | null = null;
  private ownPuuid: string | null = null;
  private ownName: RiotIdName | null = null;
  private ownStarted = false;
  private ownDue = false;
  private ownTimer: (() => void) | null = null;
  private ownInFlight = false;

  private readonly asked = new Map<string, number>();
  private wanted = new Set<string>();
  private readonly cached = new Map<string, RankedStats>();
  private readonly ownNames = new Map<string, RiotIdName>();
  private readonly queue: string[] = [];
  private draining = false;
  private lastCallAt = 0;

  constructor(options: RankSyncOptions) {
    this.api = options.api;
    this.logger = (options.logger ?? createMemoryLogger()).child({ component: 'rank' });
    this.now = options.now ?? Date.now;
    this.schedule = options.schedule ?? realScheduler;
    this.callIntervalMs = options.callIntervalMs ?? DEFAULT_CALL_INTERVAL_MS;
    this.ownIntervalMs = options.ownIntervalMs ?? OWN_RANK_INTERVAL_MS;
    this.askedTtlMs = options.askedTtlMs ?? ASKED_TTL_MS;
    this.sharedNames = options.names;
    this.postAttempts = options.postAttempts ?? 2;
  }

  hooks(): CompanionHooks {
    return {
      onConnected: (context) => this.onConnected(context),
      onRankedStats: (event) => this.onRankedStats(event),
      onDisconnected: () => this.onDisconnected(),
    };
  }

  stop(): void {
    this.stopController.abort();
    this.ownTimer?.();
    this.ownTimer = null;
    this.context = null;
  }

  /** Resolves once nothing is queued or in flight. Tests use it. */
  settled(timeoutMs = 5_000): Promise<void> {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = (): void => {
        if (!this.draining && !this.ownInFlight && this.queue.length === 0) {
          resolve();
        } else if (Date.now() - started > timeoutMs) {
          reject(new Error('rank sync did not settle'));
        } else {
          setTimeout(tick, 5);
        }
      };
      tick();
    });
  }

  /**
   * The server's list from the last lobby response: the only puuids (besides our own) this process fetches a
   * rank or a name for. Called by the lobby watcher on every successful post.
   */
  needed(puuids: readonly string[]): void {
    const others = puuids.filter((puuid) => puuid !== this.ownPuuid);
    this.wanted = new Set(others);
    const now = this.now();
    let added = 0;
    for (const puuid of others) {
      const askedAt = this.asked.get(puuid);
      if (askedAt !== undefined && now - askedAt < this.askedTtlMs) {
        continue;
      }
      if (this.queue.includes(puuid)) {
        continue;
      }
      this.asked.set(puuid, now);
      this.queue.push(puuid);
      added += 1;
    }
    if (added > 0) {
      this.logger.debug('ranks requested by the server', { requested: others.length, queued: added });
      void this.drain();
    }
  }

  // --- hooks -------------------------------------------------------------------------------------------

  private onConnected(context: ConnectedContext): void {
    this.context = context;
    if (context.summoner) {
      this.ownPuuid = context.summoner.puuid;
      this.ownName = nameFromSummoner(context.summoner);
    }
    if (!this.ownStarted) {
      this.ownStarted = true;
      void this.postOwnRank();
      this.scheduleOwn();
    } else if (this.ownDue) {
      this.ownDue = false;
      void this.postOwnRank();
    }
    if (this.queue.length > 0) {
      void this.drain();
    }
  }

  private onRankedStats(event: RankedStatsHookEvent): void {
    if (!this.wanted.has(event.puuid)) {
      // Not asked for: dropped unread. Friends-list pushes never become posts.
      return;
    }
    this.cached.set(event.puuid, event.stats);
    this.logger.debug('ranked stats arrived over the socket for a requested puuid', { puuid: event.puuid });
  }

  private onDisconnected(): void {
    this.context = null;
  }

  // --- own rank ----------------------------------------------------------------------------------------

  private scheduleOwn(): void {
    this.ownTimer?.();
    if (this.stopController.signal.aborted) {
      return;
    }
    this.ownTimer = this.schedule(() => {
      this.ownTimer = null;
      if (this.context !== null) {
        void this.postOwnRank();
      } else {
        this.ownDue = true;
      }
      this.scheduleOwn();
    }, this.ownIntervalMs);
  }

  private async postOwnRank(): Promise<void> {
    const context = this.context;
    if (context === null) {
      this.ownDue = true;
      return;
    }
    if (this.ownPuuid === null) {
      this.logger.warn('own rank skipped: the local player is unknown (current-summoner did not answer)');
      return;
    }
    this.ownInFlight = true;
    try {
      await this.pace();
      const result = await context.client.get(CURRENT_RANKED_STATS_PATH, RankedStatsSchema);
      if (!result.ok) {
        this.logger.warn('could not read own ranked stats; trying again on the next timer', {
          reason: result.reason,
          status: result.status,
        });
        return;
      }
      await this.post(mapRank(result.json, this.ownPuuid, { name: this.ownName }), 'own');
    } catch (error) {
      this.logger.error('own rank sync threw', errorFields(error));
    } finally {
      this.ownInFlight = false;
    }
  }

  // --- everyone the server asked about -----------------------------------------------------------------

  private async drain(): Promise<void> {
    if (this.draining) {
      return;
    }
    this.draining = true;
    try {
      while (this.queue.length > 0 && !this.stopController.signal.aborted) {
        const context = this.context;
        if (context === null) {
          // Disconnected before these were asked: forget the guard so the next lobby response re-lists them.
          for (const puuid of this.queue.splice(0)) {
            this.asked.delete(puuid);
          }
          break;
        }
        const puuid = this.queue.shift() as string;
        await this.syncOne(context, puuid);
      }
    } catch (error) {
      this.logger.error('rank sync threw', errorFields(error));
    } finally {
      this.draining = false;
    }
  }

  private async syncOne(context: ConnectedContext, puuid: string): Promise<void> {
    let stats = this.cached.get(puuid) ?? null;
    let statsSource: 'socket' | 'get' = 'socket';
    if (stats === null) {
      statsSource = 'get';
      await this.pace();
      const result = await context.client.get(
        fillPath(RANKED_STATS_BY_PUUID_PATH, { puuid }),
        RankedStatsSchema,
      );
      if (!result.ok) {
        this.logger.warn('rank lookup failed; left for the next lobby response', {
          puuid,
          reason: result.reason,
          status: result.status,
        });
        return;
      }
      stats = result.json;
    }
    this.cached.delete(puuid);

    let name: RiotIdName | null = this.sharedNames?.get(puuid) ?? this.ownNames.get(puuid) ?? null;
    if (name === null) {
      await this.pace();
      const result = await context.client.get(fillPath(SUMMONER_BY_PUUID_PATH, { puuid }), SummonerSchema);
      if (result.ok) {
        name = nameFromSummoner(result.json);
        this.ownNames.set(puuid, name);
      } else {
        this.logger.warn('name lookup failed; the rank is posted without a name', {
          puuid,
          reason: result.reason,
          status: result.status,
        });
      }
    }
    await this.post(mapRank(stats, puuid, { name }), statsSource);
    this.wanted.delete(puuid);
  }

  private async post(payload: CompanionRankPayloadInput, source: string): Promise<void> {
    const result = await this.api.request(
      'POST',
      RANK_API_PATH,
      payload,
      companionRankResponseSchema,
      this.postAttempts,
    );
    if (result.ok) {
      this.logger.info('rank posted', {
        puuid: payload.puuid,
        tier: payload.tier || null,
        division: payload.division === 'NA' ? null : payload.division || null,
        lp: payload.lp,
        named: payload.gameName !== null && payload.gameName !== undefined,
        stored: result.data.stored,
        source,
      });
      return;
    }
    this.logger.warn('rank post failed; left for the next lobby response', {
      puuid: payload.puuid,
      source,
      ...failureFields(result),
    });
  }

  /** Keeps client calls at most one per `callIntervalMs`. */
  private async pace(): Promise<void> {
    const elapsed = Date.now() - this.lastCallAt;
    if (elapsed < this.callIntervalMs) {
      await sleep(this.callIntervalMs - elapsed, this.stopController.signal);
    }
    this.lastCallAt = Date.now();
  }
}
