/**
 * `--verify-commands` (M4.1, second edition) against the fake client with a scripted prompt: the create
 * candidates in order until one is accepted, one fixture per attempt plus the two dialog reads, one POST for
 * invite and one for the side switch, a report in the config directory, no API call, no secret in anything
 * it prints or writes. The fake's write answers are assumptions (the shapes read from the 16.17 client's own
 * UI code), as everywhere else; it refuses every create whose `queueId` is not 3100 with the real
 * `500 INVALID_LOBBY` body from the 2026-09-09 capture, so the loop is exercised.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixtureEnvelopeSchema, type Lobby, LobbySchema, readFixture } from '@customs/lcu';
import {
  type CannedRoute,
  type FakeLcu,
  type RecordedRequest,
  startFakeLcu,
} from '@customs/lcu/test-support/fake-lcu';
import { afterEach, describe, expect, it } from 'vitest';
import type { PromptIo } from './config.js';
import {
  parseIdAnswer,
  reportPath,
  resolveFixturesDir,
  runVerifyCommands,
  shapeOf,
} from './verifyCommands.js';

const PATCH = '16.17';
const PASSWORD = 'fake-lockfile-password-verify-77';
const OTHER = 'aebd7c57-83d8-551d-a7b2-7caa7e8b1960';

/** Assumed dialog data (shape per the 16.17 OpenAPI document): a nameless blind entry like the client's own. */
const ASSUMED_CUSTOM_QUEUES = {
  queueAvailability: 'Available',
  spectatorPolicies: ['AllAllowed', 'FriendsAllowed', 'LobbyAllowed', 'NotAllowed'],
  subcategories: [
    {
      mapId: 11,
      gameMode: 'CLASSIC',
      numPlayersPerTeam: 5,
      queueAvailability: 'Available',
      mutators: [
        { id: 19, name: '', pickMode: '', banMode: '' },
        { id: 20, name: 'GAME_CFG_DRAFT_STD', pickMode: 'DraftModeSinglePickStrategy' },
      ],
    },
  ],
};
const ASSUMED_QUEUES = [
  {
    id: 3100,
    name: 'SR Blind Pick Custom',
    gameMode: 'CLASSIC',
    mapId: 11,
    isCustom: true,
    gameTypeConfig: { id: 19, name: '', pickMode: '' },
  },
  { id: 420, name: 'Ranked Solo/Duo', gameMode: 'CLASSIC', mapId: 11, isCustom: false },
];
const INVALID_LOBBY: CannedRoute = {
  status: 500,
  body: { errorCode: 'RPC_ERROR', httpStatus: 500, implementationDetails: {}, message: 'INVALID_LOBBY' },
};

function fixtureBody(id: string): unknown {
  const read = readFixture(PATCH, id);
  if (!read.ok) {
    throw new Error(read.reason);
  }
  return read.envelope.body;
}

interface World {
  lobby: Lobby | null;
  phase: string;
}

function handler(world: World): (request: RecordedRequest) => CannedRoute | undefined {
  return (request) => {
    const key = `${request.method} ${request.path}`;
    switch (key) {
      case 'GET /lol-patch/v1/game-version':
        return {
          status: 200,
          body: '"16.17.8104348+branch.releases-16-17"',
          contentType: 'application/json',
        };
      case 'GET /lol-summoner/v1/current-summoner':
        return { status: 200, body: fixtureBody('current-summoner') };
      case 'GET /lol-gameflow/v1/gameflow-phase':
        return { status: 200, body: JSON.stringify(world.phase), contentType: 'application/json' };
      case 'GET /lol-game-queues/v1/custom':
        return { status: 200, body: ASSUMED_CUSTOM_QUEUES };
      case 'GET /lol-game-queues/v1/queues':
        return { status: 200, body: ASSUMED_QUEUES };
      case 'GET /lol-lobby/v2/lobby':
        return world.lobby
          ? { status: 200, body: world.lobby }
          : { status: 404, body: { errorCode: 'RPC_ERROR', httpStatus: 404, message: 'LOBBY_NOT_FOUND' } };
      case 'GET /lol-summoner/v1/alias/lookup?gameName=XETA&tagLine=EUNE':
        return { status: 200, body: { puuid: OTHER, alias: { gameName: 'XETA', tagLine: 'EUNE' } } };
      case `GET /lol-summoner/v2/summoners/puuid/${OTHER}`:
        return { status: 200, body: fixtureBody('summoner-by-puuid--other') };
      case 'POST /lol-lobby/v2/lobby': {
        const body = JSON.parse(request.body) as {
          queueId?: number;
          customGameLobby: { configuration: { mutators: { id: number } } };
        };
        // Assumed: only queueId 3100 (blind) and 20 (the draft entry) are accepted; the mutator id names the pick mode.
        if (body.queueId !== 3100 && body.queueId !== 20) {
          return INVALID_LOBBY;
        }
        const base = LobbySchema.parse(fixtureBody('lobby'));
        world.lobby = {
          ...base,
          partyId: `party-verify-${body.customGameLobby.configuration.mutators.id}`,
          gameConfig: {
            ...base.gameConfig,
            customMutatorName:
              body.customGameLobby.configuration.mutators.id === 20
                ? 'DraftModeSinglePickStrategy'
                : 'SimulPickStrategy',
          },
          invitations: [],
        };
        // Assumed: the lobby, with the chat credentials every lobby body carries (must be scrubbed).
        return { status: 200, body: { ...world.lobby, multiUserChatPassword: 'chat-secret-do-not-write' } };
      }
      case 'POST /lol-lobby/v2/lobby/invitations': {
        if (!world.lobby) {
          return {
            status: 404,
            body: { errorCode: 'RPC_ERROR', httpStatus: 404, message: 'LOBBY_NOT_FOUND' },
          };
        }
        world.lobby = {
          ...world.lobby,
          invitations: [
            {
              invitationId: '',
              invitationType: 'invalid',
              state: 'Pending',
              timestamp: '1',
              toPuuid: OTHER,
              toSummonerId: 52699007,
            },
          ],
        };
        return { status: 200, body: JSON.parse(request.body) };
      }
      case 'POST /lol-lobby/v2/lobby/team/TEAM2': {
        if (!world.lobby) {
          return {
            status: 404,
            body: { errorCode: 'RPC_ERROR', httpStatus: 404, message: 'LOBBY_NOT_FOUND' },
          };
        }
        const { customTeam100, customTeam200 } = world.lobby.gameConfig;
        world.lobby = {
          ...world.lobby,
          gameConfig: {
            ...world.lobby.gameConfig,
            customTeam100: [],
            customTeam200: [...customTeam200, ...customTeam100],
          },
        };
        return { status: 204, body: null };
      }
      default:
        return undefined;
    }
  };
}

function scriptedIo(answers: readonly string[]): PromptIo & { said: string[]; asked: string[] } {
  const queue = [...answers];
  const said: string[] = [];
  const asked: string[] = [];
  return {
    said,
    asked,
    say: (line) => {
      said.push(line);
    },
    ask: async (question) => {
      asked.push(question);
      return queue.shift() ?? '';
    },
    askHidden: async () => '',
  };
}

interface Harness {
  lcu: FakeLcu;
  world: World;
  configDir: string;
  fixturesDir: string;
  lockfilePath: string;
  run(
    answers: readonly string[],
    overrides?: { lockfileCandidates?: string[] },
  ): Promise<{ code: number; io: ReturnType<typeof scriptedIo> }>;
  posts(): RecordedRequest[];
}

const harnesses: Harness[] = [];

async function setup(world: Partial<World> = {}): Promise<Harness> {
  const state: World = { lobby: null, phase: 'None', ...world };
  const lcu = await startFakeLcu({ password: PASSWORD, handle: handler(state) });
  const dir = mkdtempSync(join(tmpdir(), 'companion-verify-'));
  const configDir = join(dir, 'config');
  const fixturesDir = join(dir, 'fixtures');
  const lockfilePath = join(dir, 'lockfile');
  writeFileSync(lockfilePath, `LeagueClient:123:${lcu.port}:${PASSWORD}:https`);
  const harness: Harness = {
    lcu,
    world: state,
    configDir,
    fixturesDir,
    lockfilePath,
    async run(answers, overrides = {}) {
      const io = scriptedIo(answers);
      const code = await runVerifyCommands({
        configDir,
        io,
        lockfile: { candidates: overrides.lockfileCandidates ?? [lockfilePath] },
        tls: { mode: 'pinned', ca: lcu.ca },
        fixturesDir,
        now: () => new Date('2026-09-10T21:00:00.000Z'),
      });
      return { code, io };
    },
    posts: () => lcu.requests.filter((request) => request.method === 'POST'),
  };
  harnesses.push(harness);
  return harness;
}

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.lcu.close();
    rmSync(join(harness.configDir, '..'), { recursive: true, force: true });
  }
});

describe('verify-commands', () => {
  it('tries the create candidates in order until one is accepted, then one POST for invite and one for the side, one fixture per attempt, the report, and never a secret', async () => {
    const h = await setup();
    // blind id (default 19) / run the candidates / password visible? / draft id (default 20) / create draft? /
    // Riot ID / invite? / switch? / full side too?
    const { code, io } = await h.run(['', '', 'y', '', 'y', 'XETA#EUNE', '', '', '']);
    expect(code).toBe(0);
    expect(h.posts().map((request) => request.path)).toEqual([
      '/lol-lobby/v2/lobby',
      '/lol-lobby/v2/lobby',
      '/lol-lobby/v2/lobby',
      '/lol-lobby/v2/lobby/invitations',
      '/lol-lobby/v2/lobby/team/TEAM2',
    ]);
    const creates = h
      .posts()
      .slice(0, 3)
      .map((request) => JSON.parse(request.body));
    // First the dialog's own id (19 for both), refused by the fake; then the known 3100/19 pair, accepted;
    // then draft with the accepted shape and the dialog's draft entry.
    expect(creates[0]).toMatchObject({
      queueId: 19,
      customGameLobby: { configuration: { mutators: { id: 19 } } },
    });
    expect(creates[1]).toMatchObject({
      queueId: 3100,
      customGameLobby: {
        configuration: { mutators: { id: 19 }, gameMutator: '', aramMapMutator: 'NONE' },
        lobbyName: 'customs-verify',
        lobbyPassword: '1234',
      },
    });
    expect(creates[1]).not.toHaveProperty('isCustom');
    expect(creates[2]).toMatchObject({
      queueId: 20,
      customGameLobby: { configuration: { mutators: { id: 20 } } },
    });
    expect(JSON.parse(h.posts()[3]?.body ?? '')).toEqual([{ toSummonerId: 52699007 }]);
    expect(h.posts()[4]?.body).toBe('');
    // Reads only besides: the verified GETs and the two dialog reads, nothing else.
    for (const request of h.lcu.requests.filter((entry) => entry.method === 'GET')) {
      expect(request.path).toMatch(/^\/lol-(patch|summoner|gameflow|lobby|game-queues)\//);
    }

    const patchDir = join(h.fixturesDir, PATCH);
    expect(readdirSync(patchDir).sort()).toEqual([
      'create-lobby--draft.json',
      'create-lobby--ui-3100-19.json',
      'create-lobby--ui-live-19.json',
      'create-lobby.json',
      'custom-game-queues.json',
      'game-queues.json',
      'lobby-invitations.json',
      'lobby-team.json',
    ]);
    const refused = FixtureEnvelopeSchema.parse(
      JSON.parse(readFileSync(join(patchDir, 'create-lobby--ui-live-19.json'), 'utf8')),
    );
    expect(refused).toMatchObject({
      status: 500,
      request: { queueId: 19, customGameLobby: { lobbyPassword: '[redacted]' } },
      body: { message: 'INVALID_LOBBY' },
    });
    const create = FixtureEnvelopeSchema.parse(
      JSON.parse(readFileSync(join(patchDir, 'create-lobby.json'), 'utf8')),
    );
    expect(create).toMatchObject({
      id: 'create-lobby',
      method: 'POST',
      path: '/lol-lobby/v2/lobby',
      status: 200,
      patch: PATCH,
      request: {
        customGameLobby: { lobbyName: 'customs-verify', lobbyPassword: '[redacted]' },
        queueId: 3100,
      },
    });
    expect(create.note).toContain('accepted candidate ui-3100-19');
    expect((create.body as { multiUserChatPassword: string }).multiUserChatPassword).toBe('[redacted]');
    expect((create.body as { partyId: string }).partyId).toBe('party-verify-19');
    const dialog = FixtureEnvelopeSchema.parse(
      JSON.parse(readFileSync(join(patchDir, 'custom-game-queues.json'), 'utf8')),
    );
    expect(dialog).toMatchObject({ method: 'GET', path: '/lol-game-queues/v1/custom', status: 200 });
    expect(dialog.body).toEqual(ASSUMED_CUSTOM_QUEUES);
    const team = FixtureEnvelopeSchema.parse(
      JSON.parse(readFileSync(join(patchDir, 'lobby-team.json'), 'utf8')),
    );
    expect(team).toMatchObject({ path: '/lol-lobby/v2/lobby/team/TEAM2', status: 204 });
    expect(team.request).toBeUndefined();
    expect(team.body).toBeNull();

    const report = readFileSync(reportPath(h.configDir, PATCH, '2026-09-10'), 'utf8');
    expect(report).toContain('1. Create custom lobby');
    expect(report).toContain(
      "Summoner's Rift entries: 19, 20 GAME_CFG_DRAFT_STD pick=DraftModeSinglePickStrategy",
    );
    expect(report).toContain('custom queue 3100 "SR Blind Pick Custom" CLASSIC map 11 gameTypeConfig 19');
    expect(report).toContain('auto-picked dialog entries: blind 19, draft 20');
    expect(report).toContain('5 candidate bodies, best evidence first:');
    expect(report).toContain('answer: 500 INVALID_LOBBY');
    expect(report).toContain('ACCEPTED: ui-3100-19 (ui shape, queueId 3100, mutators.id 19)');
    expect(report).toContain('partyId=party-verify-19');
    expect(report).toContain('customMutatorName=DraftModeSinglePickStrategy');
    expect(report).toContain('2. Invite');
    expect(report).toContain('[{"toSummonerId":52699007}]');
    expect(report).toContain('"state":"Pending"');
    expect(report).toContain('3. Switch side');
    expect(report).toContain('POST /lol-lobby/v2/lobby/team/TEAM2');
    expect(report).toContain('local side before 100, after 200: MOVED');
    for (const text of [report, io.said.join('\n')]) {
      expect(text).not.toContain(PASSWORD);
      expect(text).not.toContain('chat-secret');
    }
    expect(report).toContain('password visible in the client: y');
    expect(io.said.some((line) => line.includes('Paste that file back'))).toBe(true);
    expect(io.said.some((line) => line.includes('close it from the client'))).toBe(true);
    expect(io.asked.length).toBe(9);
  });

  it('runs no POST when every write is skipped, still reads and saves the dialog data, and writes the report', async () => {
    const h = await setup();
    // blind id / run the candidates? s / Riot ID (skip) / switch? s
    const { code } = await h.run(['', 's', '', 's']);
    expect(code).toBe(0);
    expect(h.posts()).toEqual([]);
    expect(readdirSync(join(h.fixturesDir, PATCH)).sort()).toEqual([
      'custom-game-queues.json',
      'game-queues.json',
    ]);
    const report = readFileSync(reportPath(h.configDir, PATCH, '2026-09-10'), 'utf8');
    expect(report.match(/skipped/g)?.length).toBe(3);
  });

  it('asks before replacing a lobby the player is already in, and defaults to not replacing it', async () => {
    const h = await setup({ lobby: LobbySchema.parse(fixtureBody('lobby')) });
    // replace? (No) / Riot ID (skip) / switch? s
    const { code } = await h.run(['', '', 's']);
    expect(code).toBe(0);
    expect(h.posts()).toEqual([]);
    expect(h.world.lobby?.partyId).toBe('e3c69392-a134-43cb-97ae-8add18c72494');
  });

  it('reports when every candidate is refused and goes on to the other steps without a lobby', async () => {
    const h = await setup();
    const refusing = await startFakeLcu({
      password: PASSWORD,
      handle: (request) =>
        request.method === 'POST' && request.path === '/lol-lobby/v2/lobby'
          ? INVALID_LOBBY
          : handler(h.world)(request),
    });
    writeFileSync(h.lockfilePath, `LeagueClient:123:${refusing.port}:${PASSWORD}:https`);
    try {
      // blind id / run the candidates / Riot ID / invite? / 4xx: retry by puuid? (yes, as on 2026-09-09)
      const io = scriptedIo(['', '', 'XETA#EUNE', '', '']);
      const code = await runVerifyCommands({
        configDir: h.configDir,
        io,
        lockfile: { candidates: [h.lockfilePath] },
        tls: { mode: 'pinned', ca: refusing.ca },
        fixturesDir: h.fixturesDir,
        now: () => new Date('2026-09-10T21:00:00.000Z'),
      });
      expect(code).toBe(0);
      const posts = refusing.requests.filter((request) => request.method === 'POST');
      expect(posts.map((request) => request.path)).toEqual([
        '/lol-lobby/v2/lobby',
        '/lol-lobby/v2/lobby',
        '/lol-lobby/v2/lobby',
        '/lol-lobby/v2/lobby',
        '/lol-lobby/v2/lobby',
        '/lol-lobby/v2/lobby/invitations',
        '/lol-lobby/v2/lobby/invitations',
      ]);
      const report = readFileSync(reportPath(h.configDir, PATCH, '2026-09-10'), 'utf8');
      expect(report).toContain('NONE ACCEPTED');
      expect(report).toContain('answer: 404 LOBBY_NOT_FOUND');
      expect(report).toContain('no lobby; skipped');
      expect(
        readdirSync(join(h.fixturesDir, PATCH)).filter((file) => file.startsWith('create-lobby')),
      ).toEqual([
        'create-lobby--dto-full-3100-19.json',
        'create-lobby--legacy-queue-3100.json',
        'create-lobby--ui-3100-19.json',
        'create-lobby--ui-3100-3100.json',
        'create-lobby--ui-live-19.json',
      ]);
      expect(existsSync(join(h.fixturesDir, PATCH, 'create-lobby.json'))).toBe(false);
    } finally {
      await refusing.close();
    }
  });

  it('refuses to run outside None/Lobby, and reports a missing client', async () => {
    const busy = await setup({ phase: 'ChampSelect' });
    const inGame = await busy.run([]);
    expect(inGame.code).toBe(4);
    expect(busy.posts()).toEqual([]);
    expect(inGame.io.said.some((line) => line.includes('ChampSelect'))).toBe(true);

    const gone = await setup();
    const missing = await gone.run([], { lockfileCandidates: [join(gone.configDir, 'nope', 'lockfile')] });
    expect(missing.code).toBe(2);
    expect(gone.lcu.requests).toEqual([]);
  });

  it('helpers: shapeOf prints keys, never values; parseIdAnswer; fixtures go to the repo when present and the config dir otherwise', () => {
    expect(shapeOf({ partyId: 'x', members: [] })).toBe('{ partyId, members }');
    expect(shapeOf([{ a: 1 }, { a: 2 }])).toBe('[2 × { a }]');
    expect(shapeOf(null)).toBe('null');
    expect(shapeOf('"None"')).toBe('string');
    expect(parseIdAnswer('', 19)).toBe(19);
    expect(parseIdAnswer(' 3130 ', 19)).toBe(3130);
    expect(parseIdAnswer('draft', 19)).toBe(19);
    expect(parseIdAnswer('', null)).toBeNull();
    expect(parseIdAnswer('-1', null)).toBeNull();
    expect(resolveFixturesDir('/cfg', '/explicit')).toBe('/explicit');
    // Under the repo the lcu fixtures directory exists, so the default is the repo.
    expect(
      resolveFixturesDir('/cfg').endsWith('fixtures/') || resolveFixturesDir('/cfg').endsWith('fixtures'),
    ).toBe(true);
    expect(resolveFixturesDir('/cfg')).not.toBe(join('/cfg', 'fixtures'));
  });
});
