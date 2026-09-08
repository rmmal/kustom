/**
 * The lobby watcher against the fake League client (`@customs/lcu/test-support/fake-lcu`) for its reads and
 * the fake API (`test-support/fake-api.ts`) for its posts. Fixture-driven; no live client, no live API.
 * The numbered comments are the acceptance checks of the M2.2 brief in `docs/02-milestones.md`.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { companionLobbyPayloadSchema } from '@customs/db/schemas';
import {
  FIXTURES_DIR,
  LcuClient,
  type Lobby,
  LobbySchema,
  mapLobby,
  readFixture,
  type Summoner,
  SummonerSchema,
} from '@customs/lcu';
import { type CannedRoute, type FakeLcu, startFakeLcu } from '@customs/lcu/test-support/fake-lcu';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiClient } from './api.js';
import { type ConnectedContext, ConnectionMachine } from './connection.js';
import { composeHooks } from './hooks.js';
import { LOBBY_API_PATH, LobbyWatcher, type LobbyWatcherOptions, type Scheduler } from './lobbyWatcher.js';
import { createMemoryLogger, type MemoryLogger } from './log.js';
import { type FakeApi, type FakeApiResponse, startFakeApi } from './test-support/fake-api.js';

const PATCH = '16.17';
const TOKEN = 'tok_lobby_watcher_0123456789';
const PASSWORD = 'fake-lockfile-password-4b3c2d';
const PARTY = 'e3c69392-a134-43cb-97ae-8add18c72494';
const LEADER = '34151cbd-d9f8-5dad-9dc8-c6a8e253c0de';
const FRIEND = 'c04e977c-133a-5d94-9fd3-6202f8beec4c';
const LOBBY_PATH = '/lol-lobby/v2/lobby';
const FRIEND_LOOKUP = `GET /lol-summoner/v2/summoners/puuid/${FRIEND}`;

function fixtureBody(id: string): unknown {
  const read = readFixture(PATCH, id);
  if (!read.ok) {
    throw new Error(read.reason);
  }
  return read.envelope.body;
}

const lobbyFixture = (id: string): Lobby => LobbySchema.parse(fixtureBody(id));
const ownSummoner = (): Summoner => SummonerSchema.parse(fixtureBody('current-summoner'));

interface RecordedLine {
  ts: string;
  uri?: string;
  eventType?: 'Create' | 'Update' | 'Delete';
  data?: unknown;
  dropped?: boolean;
}

function recordedLobbyEvents(from = '', to = '￿'): RecordedLine[] {
  const text = readFileSync(join(FIXTURES_DIR, PATCH, 'ws-events.ndjson'), 'utf8');
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as RecordedLine)
    .filter((line) => line.dropped !== true && line.uri === LOBBY_PATH)
    .filter((line) => line.ts.localeCompare(from) >= 0 && line.ts.localeCompare(to) <= 0);
}

const okResponse = (overrides: Record<string, unknown> = {}): FakeApiResponse => ({
  status: 200,
  body: {
    ok: true,
    lobbyId: '3f1e2d4c-5b6a-4798-8c9d-0e1f2a3b4c5d',
    status: 'open',
    created: true,
    memberCount: 1,
    rosterFrozen: false,
    recheckInMs: null,
    ranksNeeded: [],
    ...overrides,
  },
});

const lobby404: CannedRoute = {
  status: 404,
  body: { errorCode: 'RPC_ERROR', httpStatus: 404, message: 'LOBBY_NOT_FOUND' },
};

interface Harness {
  api: FakeApi;
  lcu: FakeLcu;
  client: LcuClient;
  context: ConnectedContext;
  logger: MemoryLogger;
  watcher: LobbyWatcher;
  scheduled: { ms: number; fire: () => void; cancelled: boolean }[];
  lobbyPosts(): CompanionLobbyPost[];
  lookups(): number;
}

interface CompanionLobbyPost {
  partyId: string;
  lobbyName: string | null;
  lobbyPassword: string | null;
  members: {
    puuid: string;
    summonerId: number;
    gameName: string | null;
    tagLine: string | null;
    side: 100 | 200 | null;
    isSpectator: boolean;
  }[];
}

const harnesses: Harness[] = [];

async function setup(
  options: {
    lobbyResponses?: readonly FakeApiResponse[];
    lcuRoutes?: Record<string, CannedRoute>;
    lobbyAtConnect?: CannedRoute;
    manualTimers?: boolean;
    watcher?: Partial<LobbyWatcherOptions>;
    apiMaxAttempts?: number;
    summoner?: Summoner | null;
    /** Do not run `onConnected` in setup; the test drives the connect path itself. */
    skipConnect?: boolean;
  } = {},
): Promise<Harness> {
  const api = await startFakeApi({
    token: TOKEN,
    routes: { [`POST ${LOBBY_API_PATH}`]: options.lobbyResponses ?? [okResponse()] },
  });
  const lcu = await startFakeLcu({
    password: PASSWORD,
    routes: { [`GET ${LOBBY_PATH}`]: options.lobbyAtConnect ?? lobby404, ...options.lcuRoutes },
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
    patch: '16.17',
    summoner: options.summoner === undefined ? ownSummoner() : options.summoner,
    phase: 'Lobby',
  };
  const logger = createMemoryLogger();
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
  const watcher = new LobbyWatcher({
    api: new ApiClient({
      apiBase: api.baseUrl,
      token: TOKEN,
      logger,
      backoff: { minMs: 5, maxMs: 20 },
      maxAttempts: options.apiMaxAttempts ?? 1,
      timeoutMs: 3_000,
    }),
    logger,
    lookupIntervalMs: 5,
    backoff: { minMs: 10, maxMs: 40 },
    ...(options.manualTimers ? { schedule: manual } : {}),
    ...options.watcher,
  });
  const harness: Harness = {
    api,
    lcu,
    client,
    context,
    logger,
    watcher,
    scheduled,
    lobbyPosts: () =>
      api.requests
        .filter((request) => request.method === 'POST' && request.path === LOBBY_API_PATH)
        .map((request) => JSON.parse(request.body) as CompanionLobbyPost),
    lookups: () =>
      lcu.requests.filter((request) => request.path.startsWith('/lol-summoner/v2/summoners/puuid/')).length,
  };
  harnesses.push(harness);
  if (!options.skipConnect) {
    // The machine fires onConnected before any event: the own name is seeded and the lobby is read once.
    void watcher.hooks().onConnected?.(context);
    await until(() => lcu.requests.some((request) => request.path === LOBBY_PATH));
    await pause(10);
  }
  return harness;
}

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    harness.watcher.stop();
    harness.client.close();
    await harness.lcu.close();
    await harness.api.close();
  }
});

function until(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = (): void => {
      if (check()) {
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        reject(new Error('timed out waiting for condition'));
      } else {
        setTimeout(tick, 5);
      }
    };
    tick();
  });
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function update(h: Harness, lobby: Lobby, eventType: 'Create' | 'Update' = 'Update'): void {
  void h.watcher.hooks().onLobbyEvent?.({ eventType, lobby }, h.context);
}

function remove(h: Harness): void {
  void h.watcher.hooks().onLobbyEvent?.({ eventType: 'Delete', lobby: null }, h.context);
}

describe('LobbyWatcher: posting the roster', () => {
  it('posts lobby.json on an Update: one member, side 100, no spectator, the name, no password (check 2)', async () => {
    const h = await setup();
    update(h, lobbyFixture('lobby'));
    await h.watcher.settled();

    const posts = h.lobbyPosts();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toEqual({
      partyId: PARTY,
      lobbyName: "PRT Empty's Game",
      lobbyPassword: null,
      // The companion's own name comes free from current-summoner.
      members: [
        {
          puuid: LEADER,
          summonerId: 47890856,
          gameName: 'PRT Empty',
          tagLine: 'EUNE',
          side: 100,
          isSpectator: false,
        },
      ],
    });
    expect(companionLobbyPayloadSchema.safeParse(posts[0]).success).toBe(true);
    expect(h.api.requests[0]?.authorization).toBe(`Bearer ${TOKEN}`);
    const posted = h.logger.lines.find((line) => line.message === 'lobby posted');
    expect(posted?.fields).toMatchObject({ partyId: PARTY, members: 1, status: 'open', rosterFrozen: false });
  });

  it('posts the two-player and spectator fixtures with sides and the spectator flag (checks 3, 4)', async () => {
    const h = await setup({
      lcuRoutes: { [FRIEND_LOOKUP]: { status: 404, body: { errorCode: 'RPC_ERROR' } } },
    });
    update(h, lobbyFixture('lobby--two-players'));
    await h.watcher.settled();
    update(h, lobbyFixture('lobby--spectator'));
    await h.watcher.settled();

    const posts = h.lobbyPosts();
    expect(posts).toHaveLength(2);
    expect(posts[0]?.members.map((member) => [member.puuid, member.side, member.isSpectator])).toEqual([
      [LEADER, 100, false],
      [FRIEND, 200, false],
    ]);
    expect(posts[1]?.members.map((member) => [member.puuid, member.side, member.isSpectator])).toEqual([
      [LEADER, 100, false],
      [FRIEND, null, true],
    ]);
  });

  it('drops a bot member and a bot puuid in a team array, keeping the local player (check 5)', async () => {
    const h = await setup();
    const base = lobbyFixture('lobby');
    const bot = { ...base.members[0], puuid: '', summonerId: 0, isBot: true } as Lobby['members'][number];
    update(h, {
      ...base,
      members: [...base.members, bot],
      gameConfig: { ...base.gameConfig, customTeam100: [...base.gameConfig.customTeam100, bot] },
    });
    await h.watcher.settled();

    expect(h.lobbyPosts()[0]?.members.map((member) => member.puuid)).toEqual([LEADER]);
    expect(h.lookups()).toBe(0);
  });

  it('posts nothing on the two recorded Delete frames (check 6)', async () => {
    const h = await setup();
    const deletes = recordedLobbyEvents().filter((event) => event.eventType === 'Delete');
    expect(deletes).toHaveLength(2);
    for (const event of deletes) {
      void h.watcher
        .hooks()
        .onLobbyEvent?.({ eventType: event.eventType ?? 'Delete', lobby: null }, h.context);
    }
    await pause(50);
    await h.watcher.settled();

    expect(h.lobbyPosts()).toHaveLength(0);
    expect(h.logger.lines.filter((line) => line.message === 'lobby closed; nothing posted')).toHaveLength(2);
  });

  it('replays every recorded lobby event and each post validates with a non-empty partyId (check 1)', async () => {
    const h = await setup({ lcuRoutes: { [FRIEND_LOOKUP]: { status: 404, body: {} } } });
    const events = recordedLobbyEvents();
    for (const event of events) {
      if (event.eventType === 'Delete') {
        remove(h);
      } else {
        update(h, LobbySchema.parse(event.data), event.eventType);
      }
      await h.watcher.settled();
    }
    const posts = h.lobbyPosts();
    expect(posts.length).toBe(events.length - 2);
    for (const post of posts) {
      const parsed = companionLobbyPayloadSchema.parse(post);
      expect(parsed.partyId.length).toBeGreaterThan(0);
    }
    expect(h.logger.lines.filter((line) => line.level === 'error')).toEqual([]);
  });

  it('skips a lobby that is not a custom game, once per party', async () => {
    const h = await setup();
    const base = lobbyFixture('lobby');
    const normal: Lobby = { ...base, gameConfig: { ...base.gameConfig, isCustom: false, queueId: 450 } };
    update(h, normal);
    update(h, normal);
    await pause(30);

    expect(h.lobbyPosts()).toHaveLength(0);
    expect(h.logger.lines.filter((line) => line.message.includes('not a custom game'))).toHaveLength(1);
  });
});

describe('LobbyWatcher: connect while already in a lobby (check 7)', () => {
  it('GETs the lobby once on connect and posts it exactly once', async () => {
    const h = await setup({ lobbyAtConnect: { status: 200, body: fixtureBody('lobby') }, skipConnect: true });
    void h.watcher.hooks().onConnected?.(h.context);
    await until(() => h.lobbyPosts().length === 1);
    await h.watcher.settled();

    expect(h.lobbyPosts()).toHaveLength(1);
    expect(h.lobbyPosts()[0]?.partyId).toBe(PARTY);
    expect(h.lcu.requests.filter((request) => request.path === LOBBY_PATH)).toHaveLength(1);
    expect(h.logger.lines.some((line) => line.message === 'already in a lobby at connect')).toBe(true);
  });

  it('posts nothing and logs one line when the GET is a 404', async () => {
    const h = await setup({ lobbyAtConnect: lobby404, skipConnect: true });
    void h.watcher.hooks().onConnected?.(h.context);
    await until(() => h.logger.lines.some((line) => line.message === 'no lobby open at connect'));
    await pause(30);

    expect(h.lobbyPosts()).toHaveLength(0);
    expect(h.logger.lines.filter((line) => line.message === 'no lobby open at connect')).toHaveLength(1);
  });

  it('lets a lobby event that arrives first win over a slow connect-time GET', async () => {
    const h = await setup({
      lobbyAtConnect: { status: 200, body: fixtureBody('lobby'), delayMs: 150 },
      lcuRoutes: { [FRIEND_LOOKUP]: { status: 404, body: {} } },
      skipConnect: true,
    });
    void h.watcher.hooks().onConnected?.(h.context);
    update(h, lobbyFixture('lobby--two-players'));
    await pause(300);
    await h.watcher.settled();

    const posts = h.lobbyPosts();
    expect(posts).toHaveLength(1);
    expect(posts[0]?.members).toHaveLength(2);
    expect(h.logger.lines.some((line) => line.message.includes('superseded by an event'))).toBe(true);
  });
});

describe('LobbyWatcher: one post in flight, newest wins (check 8)', () => {
  it('feeds the recorded burst with a 500 ms post: at most two POSTs, the last carrying the last event', async () => {
    const h = await setup({
      lobbyResponses: [okResponse({ recheckInMs: null }), { ...okResponse(), delayMs: 500 }],
    });
    const burst = recordedLobbyEvents('2026-09-08T16:36:41.502Z', '2026-09-08T16:36:46.976Z');
    expect(burst.length).toBeGreaterThanOrEqual(11);
    expect(burst.every((event) => event.eventType !== 'Delete')).toBe(true);

    const lobbies = burst.map((event) => LobbySchema.parse(event.data));
    for (const [index, lobby] of lobbies.entries()) {
      update(h, lobby, index === 0 ? 'Create' : 'Update');
    }
    await pause(100);
    await h.watcher.settled(8_000);

    const posts = h.lobbyPosts();
    expect(posts.length).toBeLessThanOrEqual(2);
    expect(posts.length).toBeGreaterThanOrEqual(1);
    const last = lobbies[lobbies.length - 1] as Lobby;
    expect(posts[posts.length - 1]).toEqual(
      JSON.parse(
        JSON.stringify(mapLobby(last, new Map([[LEADER, { gameName: 'PRT Empty', tagLine: 'EUNE' }]]))),
      ),
    );
  });
});

describe('LobbyWatcher: names without waiting (check 9)', () => {
  it('posts the unknown member with null names at once, looks them up once, and re-posts once with names', async () => {
    const h = await setup({
      // The lookup takes 100 ms, so every event below is posted before the name is known.
      lcuRoutes: {
        [FRIEND_LOOKUP]: { status: 200, body: fixtureBody('summoner-by-puuid--other'), delayMs: 100 },
      },
      watcher: { lookupIntervalMs: 200 },
    });
    const started = Date.now();
    const lobby = lobbyFixture('lobby--two-players');
    update(h, lobby);
    await until(() => h.lobbyPosts().length >= 1);
    expect(Date.now() - started).toBeLessThan(50);
    expect(h.lobbyPosts()[0]?.members[1]).toMatchObject({ puuid: FRIEND, gameName: null, tagLine: null });

    // However many events arrive, the friend is asked about once.
    update(h, lobby);
    update(h, lobby);
    await until(() => h.lobbyPosts().some((post) => post.members[1]?.gameName === 'XETA'));
    await h.watcher.settled();
    await pause(50);

    expect(h.lookups()).toBe(1);
    const posts = h.lobbyPosts();
    const named = posts.filter((post) => post.members[1]?.gameName === 'XETA');
    expect(named).toHaveLength(1);
    // The re-post is the last one; everything before it went out nameless rather than waiting.
    expect(posts[posts.length - 1]).toBe(named[0]);
    expect(posts.slice(0, -1).every((post) => post.members[1]?.gameName === null)).toBe(true);
    expect(named[0]?.members[1]).toMatchObject({ gameName: 'XETA', tagLine: 'EUNE', side: 200 });
    expect(h.watcher.knownNames.get(FRIEND)).toEqual({ gameName: 'XETA', tagLine: 'EUNE' });
  });

  it('logs a 404 lookup once, posts nothing extra, and never retries it', async () => {
    const h = await setup({
      lcuRoutes: { [FRIEND_LOOKUP]: { status: 404, body: { errorCode: 'RPC_ERROR' } } },
    });
    const lobby = lobbyFixture('lobby--two-players');
    update(h, lobby);
    await h.watcher.settled();
    await pause(30);
    update(h, lobby);
    await h.watcher.settled();
    await pause(30);

    expect(h.lookups()).toBe(1);
    expect(h.lobbyPosts()).toHaveLength(2);
    expect(h.lobbyPosts().every((post) => post.members[1]?.gameName === null)).toBe(true);
    const failed = h.logger.lines.filter((line) => line.message.startsWith('summoner lookup failed'));
    expect(failed).toHaveLength(1);
    expect(failed[0]?.fields).toMatchObject({ puuid: FRIEND, status: 404 });
  });

  it('never looks up the local player, whose name comes from current-summoner', async () => {
    const h = await setup();
    update(h, lobbyFixture('lobby'));
    await h.watcher.settled();
    await pause(30);
    expect(h.lookups()).toBe(0);
    expect(h.lobbyPosts()[0]?.members[0]).toMatchObject({ gameName: 'PRT Empty', tagLine: 'EUNE' });
  });
});

describe('LobbyWatcher: the recheck knock (check 10)', () => {
  it('re-posts the byte-identical payload after recheckInMs, once', async () => {
    const h = await setup({
      lobbyResponses: [okResponse({ recheckInMs: 7000 }), okResponse({ recheckInMs: null })],
      manualTimers: true,
    });
    update(h, lobbyFixture('lobby'));
    await h.watcher.settled();

    expect(h.scheduled).toHaveLength(1);
    expect(h.scheduled[0]?.ms).toBe(7000);
    h.scheduled[0]?.fire();
    await until(() => h.lobbyPosts().length === 2);
    await h.watcher.settled();

    const bodies = h.api.requests
      .filter((request) => request.path === LOBBY_API_PATH)
      .map((request) => request.body);
    expect(bodies[0]).toBe(bodies[1]);
    // The second answer said null: nothing more is scheduled.
    expect(h.scheduled).toHaveLength(1);
  });

  it('schedules nothing for recheckInMs null', async () => {
    const h = await setup({ lobbyResponses: [okResponse({ recheckInMs: null })], manualTimers: true });
    update(h, lobbyFixture('lobby'));
    await h.watcher.settled();
    expect(h.scheduled).toHaveLength(0);
  });

  it('drops the recheck when a real lobby event supersedes it', async () => {
    const h = await setup({
      lobbyResponses: [okResponse({ recheckInMs: 7000 }), okResponse({ recheckInMs: null })],
      manualTimers: true,
      lcuRoutes: { [FRIEND_LOOKUP]: { status: 404, body: {} } },
    });
    update(h, lobbyFixture('lobby'));
    await h.watcher.settled();
    expect(h.scheduled).toHaveLength(1);
    update(h, lobbyFixture('lobby--two-players'));
    await h.watcher.settled();
    expect(h.scheduled[0]?.cancelled).toBe(true);
    h.scheduled[0]?.fire();
    await pause(30);
    expect(h.lobbyPosts()).toHaveLength(2);
    expect(h.lobbyPosts()[1]?.members).toHaveLength(2);
  });

  it('uses a real timer by default: recheckInMs 120 produces the re-post about 120 ms later', async () => {
    const h = await setup({
      lobbyResponses: [okResponse({ recheckInMs: 120 }), okResponse({ recheckInMs: null })],
    });
    update(h, lobbyFixture('lobby'));
    await h.watcher.settled();
    const posted = Date.now();
    await until(() => h.lobbyPosts().length === 2);
    const elapsed = Date.now() - posted;
    expect(elapsed).toBeGreaterThanOrEqual(100);
    expect(elapsed).toBeLessThan(1_000);
  });

  it('keeps ranksNeeded and logs rosterFrozen', async () => {
    const h = await setup({
      lobbyResponses: [
        okResponse({ ranksNeeded: [FRIEND], rosterFrozen: true, status: 'in_game', memberCount: 10 }),
      ],
      lcuRoutes: { [FRIEND_LOOKUP]: { status: 404, body: {} } },
    });
    update(h, lobbyFixture('lobby--two-players'));
    await h.watcher.settled();
    update(h, lobbyFixture('lobby--two-players'));
    await h.watcher.settled();

    expect(h.watcher.ranksNeeded).toEqual([FRIEND]);
    expect(h.watcher.lastResponse?.rosterFrozen).toBe(true);
    const frozen = h.logger.lines.filter((line) => line.message.includes('roster is frozen'));
    expect(frozen).toHaveLength(1);
    expect(frozen[0]?.fields).toMatchObject({ partyId: PARTY, status: 'in_game', memberCount: 10 });
  });
});

describe('LobbyWatcher: failures', () => {
  it('retries a 5xx with backoff while the payload is still the newest, and stops once it is not', async () => {
    const h = await setup({
      lobbyResponses: [{ status: 503, body: { ok: false, error: 'try later' } }, okResponse()],
      manualTimers: true,
      lcuRoutes: { [FRIEND_LOOKUP]: { status: 404, body: {} } },
    });
    update(h, lobbyFixture('lobby'));
    await h.watcher.settled();
    expect(h.lobbyPosts()).toHaveLength(1);
    expect(h.scheduled).toHaveLength(1);
    expect(h.scheduled[0]?.ms).toBeLessThanOrEqual(40);
    h.scheduled[0]?.fire();
    await until(() => h.lobbyPosts().length === 2);
    await h.watcher.settled();
    expect(h.api.requests[1]?.body).toBe(h.api.requests[0]?.body);

    // A newer roster cancels a pending retry.
    const h2 = await setup({
      lobbyResponses: [{ status: 500, body: 'oops', contentType: 'text/html' }, okResponse()],
      manualTimers: true,
      lcuRoutes: { [FRIEND_LOOKUP]: { status: 404, body: {} } },
    });
    update(h2, lobbyFixture('lobby'));
    await h2.watcher.settled();
    expect(h2.scheduled).toHaveLength(1);
    update(h2, lobbyFixture('lobby--two-players'));
    await h2.watcher.settled();
    expect(h2.scheduled[0]?.cancelled).toBe(true);
    expect(h2.lobbyPosts()).toHaveLength(2);
    expect(h2.lobbyPosts()[1]?.members).toHaveLength(2);
  });

  it('stops posting a party after a 403 until the next Create', async () => {
    const h = await setup({
      lobbyResponses: [
        { status: 403, body: { ok: false, error: 'a companion may only report a lobby it is in' } },
        okResponse(),
      ],
    });
    const lobby = lobbyFixture('lobby');
    update(h, lobby);
    await h.watcher.settled();
    update(h, lobby);
    update(h, lobby);
    await pause(30);
    expect(h.lobbyPosts()).toHaveLength(1);
    const refused = h.logger.lines.filter((line) => line.message.startsWith('api refused the lobby post'));
    expect(refused).toHaveLength(1);
    expect(refused[0]?.fields).toMatchObject({ partyId: PARTY, status: 403 });

    update(h, lobby, 'Create');
    await h.watcher.settled();
    expect(h.lobbyPosts()).toHaveLength(2);
  });

  it('logs and drops a 2xx whose body does not match the response schema, without throwing', async () => {
    const h = await setup({
      lobbyResponses: [{ status: 200, body: { ok: true, lobbyId: 'nope' } }],
      manualTimers: true,
    });
    update(h, lobbyFixture('lobby'));
    await h.watcher.settled();
    expect(h.lobbyPosts()).toHaveLength(1);
    expect(h.scheduled).toHaveLength(0);
    const dropped = h.logger.lines.find((line) => line.message === 'lobby post dropped');
    expect(dropped?.fields).toMatchObject({ partyId: PARTY, reason: 'schema' });
    expect(h.logger.lines.filter((line) => line.level === 'error')).toEqual([]);
  });

  it('logs and drops a 400 without retrying', async () => {
    const h = await setup({
      lobbyResponses: [{ status: 400, body: { ok: false, error: 'bad', issues: [] } }],
      manualTimers: true,
    });
    update(h, lobbyFixture('lobby'));
    await h.watcher.settled();
    expect(h.scheduled).toHaveLength(0);
    expect(h.logger.lines.find((line) => line.message === 'lobby post dropped')?.fields).toMatchObject({
      status: 400,
    });
  });

  it('writes no raw event body and no chat credential to the log (check 11)', async () => {
    const h = await setup({
      lobbyResponses: [
        okResponse({ recheckInMs: 50 }),
        { status: 500, body: 'x', contentType: 'text/plain' },
        okResponse(),
      ],
      lcuRoutes: { [FRIEND_LOOKUP]: { status: 404, body: {} } },
    });
    const raw = fixtureBody('lobby--spectator') as Record<string, unknown>;
    expect(Object.keys(raw)).toContain('mucJwtDto');
    const leaky = LobbySchema.parse({
      ...raw,
      mucJwtDto: { jwt: 'live-jwt-value' },
      multiUserChatPassword: 'live-chat-password',
    });
    update(h, leaky, 'Create');
    await h.watcher.settled();
    remove(h);
    await pause(150);
    await h.watcher.settled();

    const text = JSON.stringify(h.logger.lines);
    expect(text).not.toContain('mucJwtDto');
    expect(text).not.toContain('multiUserChatPassword');
    expect(text).not.toContain('live-jwt-value');
    expect(text).not.toContain('live-chat-password');
    expect(text).not.toContain('customTeam100');
    expect(text).not.toContain(TOKEN);
  });
});

describe('LobbyWatcher through the connection machine', () => {
  it('posts at connect, on events, and again after a reconnect', async () => {
    const api = await startFakeApi({
      token: TOKEN,
      routes: { [`POST ${LOBBY_API_PATH}`]: [okResponse()] },
    });
    const lcu = await startFakeLcu({
      password: PASSWORD,
      routes: {
        'GET /lol-patch/v1/game-version': {
          status: 200,
          body: '"16.17.8104348+branch.releases-16-17.code.public.content.release.anticheat.vanguard"',
          contentType: 'application/json',
        },
        'GET /lol-summoner/v1/current-summoner': { status: 200, body: fixtureBody('current-summoner') },
        'GET /lol-gameflow/v1/gameflow-phase': {
          status: 200,
          body: '"Lobby"',
          contentType: 'application/json',
        },
        [`GET ${LOBBY_PATH}`]: { status: 200, body: fixtureBody('lobby') },
        [FRIEND_LOOKUP]: { status: 200, body: fixtureBody('summoner-by-puuid--other') },
      },
    });
    const dir = mkdtempSync(join(tmpdir(), 'companion-lobby-'));
    const lockfile = join(dir, 'lockfile');
    writeFileSync(lockfile, `LeagueClient:4242:${lcu.port}:${PASSWORD}:https`);
    const logger = createMemoryLogger();
    const watcher = new LobbyWatcher({
      api: new ApiClient({ apiBase: api.baseUrl, token: TOKEN, logger, backoff: { minMs: 5, maxMs: 20 } }),
      logger,
      lookupIntervalMs: 5,
    });
    const machine = new ConnectionMachine({
      logger,
      hooks: composeHooks(logger, watcher.hooks()),
      lockfile: { overridePath: lockfile, candidates: [], env: {} },
      tls: { mode: 'pinned', ca: lcu.ca },
      pollIntervalMs: 40,
      backoff: { minMs: 20, maxMs: 60 },
      requestTimeoutMs: 2_000,
    });
    const run = machine.run();
    const posts = (): CompanionLobbyPost[] =>
      api.requests
        .filter((request) => request.path === LOBBY_API_PATH)
        .map((request) => JSON.parse(request.body) as CompanionLobbyPost);
    try {
      await machine.waitForState('watching');
      await until(() => posts().length === 1);
      expect(posts()[0]?.members).toHaveLength(1);

      lcu.emitEvent(LOBBY_PATH, 'Update', fixtureBody('lobby--spectator'));
      await until(
        () => posts().length >= 2 && (posts()[posts().length - 1]?.members[1]?.gameName ?? null) !== null,
      );
      const spectatorPost = posts()[posts().length - 1];
      expect(spectatorPost?.members[1]).toMatchObject({
        puuid: FRIEND,
        side: null,
        isSpectator: true,
        gameName: 'XETA',
      });

      lcu.emitEvent(LOBBY_PATH, 'Delete', null);
      await pause(50);
      const before = posts().length;

      lcu.closeSockets(1001, 'restart');
      await machine.waitForState('disconnected');
      await machine.waitForState('watching');
      await until(() => posts().length === before + 1);
      // The reconnect GET (lobby.json, one member) went out exactly once.
      expect(posts()[posts().length - 1]?.members).toHaveLength(1);
      expect(lcu.requests.filter((request) => request.path === LOBBY_PATH)).toHaveLength(2);
    } finally {
      machine.stop();
      await run;
      watcher.stop();
      await lcu.close();
      await api.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
