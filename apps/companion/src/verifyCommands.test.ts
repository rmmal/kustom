/**
 * `--verify-commands` (M4.1) against the fake client with a scripted prompt: one POST per kind, one fixture
 * per POST, a report in the config directory, no API call, no secret in anything it prints or writes.
 * The fake's write answers are assumptions (community shapes), as everywhere else.
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
import { reportPath, resolveFixturesDir, runVerifyCommands, shapeOf } from './verifyCommands.js';

const PATCH = '16.17';
const PASSWORD = 'fake-lockfile-password-verify-77';
const OTHER = 'aebd7c57-83d8-551d-a7b2-7caa7e8b1960';

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
      case 'GET /lol-lobby/v2/lobby':
        return world.lobby
          ? { status: 200, body: world.lobby }
          : { status: 404, body: { errorCode: 'RPC_ERROR', httpStatus: 404, message: 'LOBBY_NOT_FOUND' } };
      case 'GET /lol-summoner/v1/alias/lookup?gameName=XETA&tagLine=EUNE':
        return { status: 200, body: { puuid: OTHER, alias: { gameName: 'XETA', tagLine: 'EUNE' } } };
      case `GET /lol-summoner/v2/summoners/puuid/${OTHER}`:
        return { status: 200, body: fixtureBody('summoner-by-puuid--other') };
      case 'POST /lol-lobby/v2/lobby': {
        const base = LobbySchema.parse(fixtureBody('lobby'));
        world.lobby = { ...base, partyId: 'party-verify', invitations: [] };
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
      case 'POST /lol-lobby/v1/lobby/custom/switch-teams': {
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
            customTeam100: customTeam200,
            customTeam200: customTeam100,
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
        now: () => new Date('2026-09-09T21:00:00.000Z'),
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
  it('runs exactly one POST per kind with default answers, writes one fixture per POST and the report, and never a secret', async () => {
    const h = await setup();
    // create? / password visible? / draft too? / Riot ID / invite? / switch? / full side too?
    const { code, io } = await h.run(['', 'y', '', 'XETA#EUNE', '', '', '']);
    expect(code).toBe(0);
    expect(h.posts().map((request) => request.path)).toEqual([
      '/lol-lobby/v2/lobby',
      '/lol-lobby/v2/lobby/invitations',
      '/lol-lobby/v1/lobby/custom/switch-teams',
    ]);
    expect(JSON.parse(h.posts()[1]?.body ?? '')).toEqual([{ toSummonerId: 52699007 }]);
    expect(h.posts()[2]?.body).toBe('');
    // Reads only besides: the verified GETs, nothing else.
    for (const request of h.lcu.requests.filter((entry) => entry.method === 'GET')) {
      expect(request.path).toMatch(/^\/lol-(patch|summoner|gameflow|lobby)\//);
    }

    const patchDir = join(h.fixturesDir, PATCH);
    expect(readdirSync(patchDir).sort()).toEqual([
      'create-lobby.json',
      'lobby-invitations.json',
      'switch-teams-v1.json',
    ]);
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
        isCustom: true,
      },
    });
    expect((create.body as { multiUserChatPassword: string }).multiUserChatPassword).toBe('[redacted]');
    expect((create.body as { partyId: string }).partyId).toBe('party-verify');
    const switchFixture = FixtureEnvelopeSchema.parse(
      JSON.parse(readFileSync(join(patchDir, 'switch-teams-v1.json'), 'utf8')),
    );
    expect(switchFixture.status).toBe(204);
    expect(switchFixture.request).toBeUndefined();
    expect(switchFixture.body).toBeNull();

    const report = readFileSync(reportPath(h.configDir, PATCH, '2026-09-09'), 'utf8');
    expect(report).toContain('1. Create custom lobby');
    expect(report).toContain('answer: 200');
    expect(report).toContain('partyId=party-verify');
    expect(report).toContain('2. Invite');
    expect(report).toContain('[{"toSummonerId":52699007}]');
    expect(report).toContain('"state":"Pending"');
    expect(report).toContain('3. Switch side');
    expect(report).toContain('local side before 100, after 200: MOVED');
    for (const text of [report, io.said.join('\n')]) {
      expect(text).not.toContain(PASSWORD);
      expect(text).not.toContain('chat-secret');
    }
    expect(report).toContain('password visible in the client: y');
    expect(io.said.some((line) => line.includes('Paste that file back'))).toBe(true);
    expect(io.asked.length).toBe(7);
  });

  it('runs no POST and writes no fixture when every probe is skipped, but still writes the report', async () => {
    const h = await setup();
    const { code } = await h.run(['s', '', 's']);
    expect(code).toBe(0);
    expect(h.posts()).toEqual([]);
    expect(existsSync(join(h.fixturesDir, PATCH))).toBe(false);
    const report = readFileSync(reportPath(h.configDir, PATCH, '2026-09-09'), 'utf8');
    expect(report.match(/skipped/g)?.length).toBe(3);
  });

  it('asks before replacing a lobby the player is already in, and defaults to not replacing it', async () => {
    const h = await setup({ lobby: LobbySchema.parse(fixtureBody('lobby')) });
    const { code } = await h.run(['', '', 's']);
    expect(code).toBe(0);
    expect(h.posts()).toEqual([]);
    expect(h.world.lobby?.partyId).toBe('e3c69392-a134-43cb-97ae-8add18c72494');
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

  it('helpers: shapeOf prints keys, never values; fixtures go to the repo when present and the config dir otherwise', () => {
    expect(shapeOf({ partyId: 'x', members: [] })).toBe('{ partyId, members }');
    expect(shapeOf([{ a: 1 }, { a: 2 }])).toBe('[2 × { a }]');
    expect(shapeOf(null)).toBe('null');
    expect(shapeOf('"None"')).toBe('string');
    expect(resolveFixturesDir('/cfg', '/explicit')).toBe('/explicit');
    // Under the repo the lcu fixtures directory exists, so the default is the repo.
    expect(
      resolveFixturesDir('/cfg').endsWith('fixtures/') || resolveFixturesDir('/cfg').endsWith('fixtures'),
    ).toBe(true);
    expect(resolveFixturesDir('/cfg')).not.toBe(join('/cfg', 'fixtures'));
  });
});
