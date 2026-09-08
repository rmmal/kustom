/**
 * Rank and name sync against the fake League client and the fake API. Fixture-driven; the clock and the
 * timers are injected. The numbered comments are the acceptance checks of the M2.4 brief.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { companionRankPayloadSchema } from '@customs/db/schemas';
import {
  LcuClient,
  type RankedStats,
  RankedStatsSchema,
  readFixture,
  type Summoner,
  SummonerSchema,
} from '@customs/lcu';
import { type CannedRoute, type FakeLcu, startFakeLcu } from '@customs/lcu/test-support/fake-lcu';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiClient } from './api.js';
import type { ConnectedContext } from './connection.js';
import type { Scheduler } from './lobbyWatcher.js';
import { createMemoryLogger, type MemoryLogger } from './log.js';
import { CURRENT_RANKED_STATS_PATH, RANK_API_PATH, RankSync, type RankSyncOptions } from './rankSync.js';
import { type FakeApi, type FakeApiResponse, startFakeApi } from './test-support/fake-api.js';

const PATCH = '16.17';
const TOKEN = 'tok_rank_sync_0123456789abc';
const PASSWORD = 'fake-lockfile-password-1d2e3f';
const OWN = '34151cbd-d9f8-5dad-9dc8-c6a8e253c0de';
const A = 'aebd7c57-83d8-551d-a7b2-7caa7e8b1960';
const B = 'c04e977c-133a-5d94-9fd3-6202f8beec4c';
const C = '0f0f0f0f-1111-2222-3333-444444444444';
const HOUR = 60 * 60 * 1000;

function fixtureBody(id: string): unknown {
  const read = readFixture(PATCH, id);
  if (!read.ok) {
    throw new Error(read.reason);
  }
  return read.envelope.body;
}

const ownSummoner = (): Summoner => SummonerSchema.parse(fixtureBody('current-summoner'));
const rankRoute = (puuid: string): string => `GET /lol-ranked/v1/ranked-stats/${puuid}`;
const nameRoute = (puuid: string): string => `GET /lol-summoner/v2/summoners/puuid/${puuid}`;

const okRank: FakeApiResponse = {
  status: 200,
  body: { ok: true, playerId: '3f1e2d4c-5b6a-4798-8c9d-0e1f2a3b4c5d', stored: true },
};

interface RankPost {
  puuid: string;
  tier: string | null;
  division: string | null;
  lp: number | null;
  queue: string;
  gameName: string | null;
  tagLine: string | null;
}

interface Harness {
  api: FakeApi;
  lcu: FakeLcu;
  client: LcuClient;
  context: ConnectedContext;
  logger: MemoryLogger;
  sync: RankSync;
  clock: { now: number };
  scheduled: { ms: number; fire: () => void; cancelled: boolean }[];
  posts(): RankPost[];
  gets(prefix: string): string[];
}

const harnesses: Harness[] = [];

async function setup(
  options: {
    lcuRoutes?: Record<string, CannedRoute>;
    sync?: Partial<RankSyncOptions>;
    connect?: boolean;
  } = {},
): Promise<Harness> {
  const api = await startFakeApi({ token: TOKEN, routes: { [`POST ${RANK_API_PATH}`]: [okRank] } });
  const lcu = await startFakeLcu({
    password: PASSWORD,
    routes: {
      [`GET ${CURRENT_RANKED_STATS_PATH}`]: { status: 200, body: fixtureBody('current-ranked-stats') },
      [rankRoute(A)]: { status: 200, body: fixtureBody('ranked-stats-by-puuid--other') },
      [rankRoute(B)]: { status: 200, body: fixtureBody('ranked-stats-by-puuid--other') },
      [nameRoute(A)]: { status: 200, body: fixtureBody('summoner-by-puuid--other') },
      [nameRoute(B)]: { status: 200, body: fixtureBody('summoner-by-puuid--other') },
      ...options.lcuRoutes,
    },
  });
  const client = new LcuClient({
    port: lcu.port,
    password: PASSWORD,
    tls: { mode: 'pinned', ca: lcu.ca },
    timeoutMs: 2_000,
  });
  const context: ConnectedContext = {
    client,
    version: '16.17.8104348+branch.releases-16-17',
    patch: PATCH,
    summoner: ownSummoner(),
    phase: 'Lobby',
  };
  const logger = createMemoryLogger();
  const clock = { now: Date.parse('2026-09-08T18:00:00.000Z') };
  const scheduled: Harness['scheduled'] = [];
  const manual: Scheduler = (fn, ms) => {
    const entry = {
      ms,
      cancelled: false,
      fire: () => {
        if (!entry.cancelled) {
          entry.cancelled = true;
          fn();
        }
      },
    };
    scheduled.push(entry);
    return () => {
      entry.cancelled = true;
    };
  };
  const sync = new RankSync({
    api: new ApiClient({ apiBase: api.baseUrl, token: TOKEN, logger, maxAttempts: 1, timeoutMs: 3_000 }),
    logger,
    now: () => clock.now,
    schedule: manual,
    callIntervalMs: 5,
    ...options.sync,
  });
  const harness: Harness = {
    api,
    lcu,
    client,
    context,
    logger,
    sync,
    clock,
    scheduled,
    posts: () =>
      api.requests
        .filter((request) => request.method === 'POST' && request.path === RANK_API_PATH)
        .map((request) => JSON.parse(request.body) as RankPost),
    gets: (prefix) =>
      lcu.requests
        .filter((request) => request.method === 'GET' && request.path.startsWith(prefix))
        .map((request) => request.path),
  };
  harnesses.push(harness);
  if (options.connect !== false) {
    await sync.hooks().onConnected?.(context);
    await sync.settled();
  }
  return harness;
}

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    harness.sync.stop();
    harness.client.close();
    await harness.lcu.close();
    await harness.api.close();
  }
});

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('RankSync: own rank', () => {
  it('on start: exactly one current-ranked-stats GET and one rank POST for the own puuid (check 1)', async () => {
    const h = await setup();
    expect(h.gets(CURRENT_RANKED_STATS_PATH)).toHaveLength(1);
    expect(h.gets('/lol-ranked/v1/ranked-stats/')).toEqual([]);
    expect(h.gets('/lol-summoner/')).toEqual([]);
    expect(h.posts()).toEqual([
      {
        puuid: OWN,
        tier: 'SILVER',
        division: 'IV',
        lp: 30,
        queue: 'RANKED_SOLO_5x5',
        gameName: 'PRT Empty',
        tagLine: 'EUNE',
      },
    ]);
    expect(companionRankPayloadSchema.safeParse(h.posts()[0]).success).toBe(true);
  });

  it('an unranked reading (tier "", division "NA") normalises to null tier and division on the wire schema (check 2)', async () => {
    const h = await setup({
      lcuRoutes: {
        [`GET ${CURRENT_RANKED_STATS_PATH}`]: {
          status: 200,
          body: fixtureBody('ranked-stats-by-puuid--ws-cached'),
        },
      },
    });
    const post = h.posts()[0];
    // Verbatim on the wire; the server's schema is the one normalisation.
    expect(post).toMatchObject({ puuid: OWN, tier: '', division: 'NA', lp: 0 });
    expect(companionRankPayloadSchema.parse(post)).toMatchObject({ tier: null, division: null, lp: null });
  });

  it('six hours of injected time: exactly two own-rank posts in seven hours, nobody else refetched (check 6)', async () => {
    const h = await setup();
    h.sync.needed([A]);
    await h.sync.settled();
    expect(h.posts().map((post) => post.puuid)).toEqual([OWN, A]);

    h.clock.now += 6 * HOUR;
    const timer = h.scheduled.find((entry) => !entry.cancelled && entry.ms === 6 * HOUR);
    expect(timer).toBeDefined();
    timer?.fire();
    await pause(10);
    await h.sync.settled();
    h.clock.now += HOUR;
    await pause(10);

    expect(h.posts().filter((post) => post.puuid === OWN)).toHaveLength(2);
    expect(h.gets(CURRENT_RANKED_STATS_PATH)).toHaveLength(2);
    expect(h.gets(`/lol-ranked/v1/ranked-stats/${A}`)).toHaveLength(1);
    // The next tick is armed for six hours more, and nothing else is scheduled.
    expect(h.scheduled.filter((entry) => !entry.cancelled).map((entry) => entry.ms)).toEqual([6 * HOUR]);
  });

  it('a reconnect does not re-post the own rank; a timer that fired while disconnected posts on reconnect', async () => {
    const h = await setup();
    await h.sync.hooks().onDisconnected?.('socket_closed');
    await h.sync.hooks().onConnected?.(h.context);
    await h.sync.settled();
    expect(h.posts()).toHaveLength(1);

    await h.sync.hooks().onDisconnected?.('client_lost');
    h.scheduled.find((entry) => !entry.cancelled)?.fire();
    await pause(10);
    expect(h.posts()).toHaveLength(1);
    await h.sync.hooks().onConnected?.(h.context);
    await h.sync.settled();
    expect(h.posts()).toHaveLength(2);
  });
});

describe('RankSync: the puuids the server asked about', () => {
  it('ranksNeeded [a, b]: two ranked-stats GETs, two summoner GETs, two posts with the name filled (check 3)', async () => {
    const h = await setup();
    h.sync.needed([A, B]);
    await h.sync.settled();
    expect(h.gets('/lol-ranked/v1/ranked-stats/')).toEqual([
      `/lol-ranked/v1/ranked-stats/${A}`,
      `/lol-ranked/v1/ranked-stats/${B}`,
    ]);
    expect(h.gets('/lol-summoner/v2/summoners/puuid/')).toEqual([
      `/lol-summoner/v2/summoners/puuid/${A}`,
      `/lol-summoner/v2/summoners/puuid/${B}`,
    ]);
    const others = h.posts().filter((post) => post.puuid !== OWN);
    expect(others).toEqual([
      {
        puuid: A,
        tier: 'SILVER',
        division: 'II',
        lp: 1,
        queue: 'RANKED_SOLO_5x5',
        gameName: 'XETA',
        tagLine: 'EUNE',
      },
      {
        puuid: B,
        tier: 'SILVER',
        division: 'II',
        lp: 1,
        queue: 'RANKED_SOLO_5x5',
        gameName: 'XETA',
        tagLine: 'EUNE',
      },
    ]);
  });

  it('the same ranksNeeded again within the hour: zero further client calls (check 4)', async () => {
    const h = await setup();
    h.sync.needed([A, B]);
    await h.sync.settled();
    const callsBefore = h.lcu.requests.length;
    h.clock.now += 30 * 60 * 1000;
    h.sync.needed([A, B]);
    h.sync.needed([B, A]);
    await h.sync.settled();
    await pause(20);
    expect(h.lcu.requests.length).toBe(callsBefore);
    expect(h.posts()).toHaveLength(3);

    // An hour later the server may still list them; then they are asked again.
    h.clock.now += HOUR;
    h.sync.needed([A]);
    await h.sync.settled();
    expect(h.gets(`/lol-ranked/v1/ranked-stats/${A}`)).toHaveLength(2);
  });

  it('a cached-ranked-stats event for a puuid in ranksNeeded replaces its GET; for anyone else it is dropped (check 5)', async () => {
    const h = await setup();
    const stats: RankedStats = RankedStatsSchema.parse(fixtureBody('ranked-stats-by-puuid--ws-cached'));
    // Never asked about: no call, no post.
    await h.sync.hooks().onRankedStats?.({ puuid: C, stats }, h.context);
    await h.sync.settled();
    expect(h.posts()).toHaveLength(1);

    h.sync.needed([A, B]);
    // Arrives while a's GET is in flight, before b's would go out.
    await h.sync.hooks().onRankedStats?.({ puuid: B, stats }, h.context);
    await h.sync.hooks().onRankedStats?.({ puuid: C, stats }, h.context);
    await h.sync.settled();
    expect(h.gets('/lol-ranked/v1/ranked-stats/')).toEqual([`/lol-ranked/v1/ranked-stats/${A}`]);
    const b = h.posts().find((post) => post.puuid === B);
    expect(b).toMatchObject({ tier: '', division: 'NA', gameName: 'XETA', tagLine: 'EUNE' });
    expect(h.posts().some((post) => post.puuid === C)).toBe(false);
    expect(h.lcu.requests.some((request) => request.path.includes(C))).toBe(false);
  });

  it('reuses a name the lobby watcher already knows instead of looking it up again', async () => {
    const names = new Map([[A, { gameName: 'Known', tagLine: 'EUW' }]]);
    const h = await setup({ sync: { names } });
    h.sync.needed([A]);
    await h.sync.settled();
    expect(h.gets('/lol-summoner/')).toEqual([]);
    expect(h.posts().find((post) => post.puuid === A)).toMatchObject({ gameName: 'Known', tagLine: 'EUW' });
  });

  it('a ranked-stats GET that 500s: one log line, no crash, no retry, nothing posted for that puuid (check 8)', async () => {
    const h = await setup({
      lcuRoutes: {
        [rankRoute(A)]: { status: 500, body: { errorCode: 'RPC_ERROR', httpStatus: 500, message: 'x' } },
      },
    });
    h.sync.needed([A, B]);
    await h.sync.settled();
    expect(h.gets(`/lol-ranked/v1/ranked-stats/${A}`)).toHaveLength(1);
    expect(h.posts().map((post) => post.puuid)).toEqual([OWN, B]);
    const lines = h.logger.lines.filter((line) => line.message.includes('rank lookup failed'));
    expect(lines).toHaveLength(1);
    expect(lines[0]?.fields).toMatchObject({ puuid: A, status: 500 });
    // Not re-asked within the hour even if the server lists the puuid again.
    h.sync.needed([A]);
    await h.sync.settled();
    expect(h.gets(`/lol-ranked/v1/ranked-stats/${A}`)).toHaveLength(1);
  });

  it('a name lookup that 404s still posts the rank, without a name', async () => {
    const h = await setup({
      lcuRoutes: {
        [nameRoute(A)]: { status: 404, body: { errorCode: 'RPC_ERROR', httpStatus: 404, message: 'no' } },
      },
    });
    h.sync.needed([A]);
    await h.sync.settled();
    expect(h.posts().find((post) => post.puuid === A)).toMatchObject({
      tier: 'SILVER',
      gameName: null,
      tagLine: null,
    });
  });

  it('the own puuid in ranksNeeded is left to the own path, and posting is never blocked by the list', async () => {
    const h = await setup();
    h.sync.needed([OWN]);
    await h.sync.settled();
    expect(h.gets('/lol-ranked/v1/ranked-stats/')).toEqual([]);
    expect(h.posts()).toHaveLength(1);
  });

  it('paces client calls: ten puuids never go faster than the interval', async () => {
    const puuids = Array.from({ length: 6 }, (_, i) => `p${i}-0000-0000-0000-000000000000`);
    const routes: Record<string, CannedRoute> = {};
    for (const puuid of puuids) {
      routes[rankRoute(puuid)] = { status: 200, body: fixtureBody('ranked-stats-by-puuid--other') };
      routes[nameRoute(puuid)] = { status: 200, body: fixtureBody('summoner-by-puuid--other') };
    }
    const h = await setup({ lcuRoutes: routes, sync: { callIntervalMs: 20 } });
    const started = Date.now();
    h.sync.needed(puuids);
    await h.sync.settled(10_000);
    // 12 client calls at 20 ms spacing: at least 11 gaps.
    expect(Date.now() - started).toBeGreaterThanOrEqual(11 * 20 - 5);
    expect(h.posts()).toHaveLength(7);
  });

  it('a disconnect mid-pass re-arms the rest for the next connection', async () => {
    const h = await setup({ sync: { callIntervalMs: 50 } });
    h.sync.needed([A, B]);
    await pause(5);
    await h.sync.hooks().onDisconnected?.('socket_closed');
    await h.sync.settled();
    const posted = h.posts().filter((post) => post.puuid !== OWN).length;
    expect(posted).toBeLessThanOrEqual(1);
    await h.sync.hooks().onConnected?.(h.context);
    h.sync.needed([A, B]);
    await h.sync.settled();
    expect(
      h
        .posts()
        .filter((post) => post.puuid !== OWN)
        .map((post) => post.puuid)
        .sort(),
    ).toEqual([A, B]);
  });
});

describe('the companion never reads the client’s loss counter (check 7)', () => {
  it('the string is absent from apps/companion/src', () => {
    const dir = new URL('.', import.meta.url).pathname;
    const forbidden = ['los', 'ses'].join('');
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.ts')) {
        continue;
      }
      expect(readFileSync(join(dir, name), 'utf8').includes(forbidden), name).toBe(false);
    }
  });
});
