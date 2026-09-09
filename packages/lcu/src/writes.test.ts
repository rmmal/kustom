/**
 * The lobby writes (M4.1) against the fake client, plus the two guards that keep this package on the right
 * side of the Riot line: the allow-list (nothing POSTs outside `/lol-lobby/...`), and the verification gate,
 * which can never read `verified` while the reference row in docs/03-lcu-reference.md is still `unverified`.
 *
 * Every fake answer below is an **assumption**: the community-documented shape, not a capture. The test
 * names say so. A live run (`pnpm --filter companion verify-commands`) is what turns them into fixtures.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { LcuClient } from './client.js';
import { LIVE_CLIENT_DATA, WRITE_ENDPOINTS } from './endpoints.js';
import {
  type CannedRoute,
  type FakeLcu,
  type RecordedRequest,
  startFakeLcu,
} from './test-support/fake-lcu.js';
import {
  assertLobbyWritePath,
  createLobbyBody,
  describeWriteResponse,
  inviteBody,
  inviteWithFallback,
  isLobbyWritePath,
  isLobbyWriteVerified,
  LOBBY_WRITE_PATHS,
  LOBBY_WRITE_VERIFICATION,
  type LobbyWriteKind,
  postCreateLobby,
  postSwitchTeams,
} from './writes.js';

const PASSWORD = 'fake-lockfile-password';
const PUUID = 'aebd7c57-83d8-551d-a7b2-7caa7e8b1960';
const SRC_DIR = fileURLToPath(new URL('./', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const fakes: FakeLcu[] = [];
const clients: LcuClient[] = [];

async function setup(handle: (request: RecordedRequest) => CannedRoute | undefined) {
  const lcu = await startFakeLcu({ password: PASSWORD, handle });
  const client = new LcuClient({ port: lcu.port, password: PASSWORD, tls: { mode: 'pinned', ca: lcu.ca } });
  fakes.push(lcu);
  clients.push(client);
  return { lcu, client, posts: () => lcu.requests.filter((request) => request.method === 'POST') };
}

afterEach(async () => {
  for (const client of clients.splice(0)) {
    client.close();
  }
  for (const lcu of fakes.splice(0)) {
    await lcu.close();
  }
});

/** Every non-test source file under src/, relative path -> text. */
function sourceFiles(dir: string, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === 'test-support' || entry.name === 'node_modules') {
        continue;
      }
      Object.assign(out, sourceFiles(join(dir, entry.name), rel));
    } else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.d.ts')
    ) {
      out[rel] = readFileSync(join(dir, entry.name), 'utf8');
    }
  }
  return out;
}

describe('request bodies (community shapes, unverified)', () => {
  it('createLobbyBody is the body the reference row lists, blind by default', () => {
    expect(createLobbyBody({ lobbyName: 'Customs 09 Sep #1', lobbyPassword: '4821' })).toEqual({
      customGameLobby: {
        configuration: {
          gameMode: 'CLASSIC',
          mapId: 11,
          mutators: { id: 1 },
          spectatorPolicy: 'AllAllowed',
          teamSize: 5,
          gameServerRegion: '',
        },
        lobbyName: 'Customs 09 Sep #1',
        lobbyPassword: '4821',
      },
      isCustom: true,
    });
    expect(createLobbyBody({ lobbyName: 'n', lobbyPassword: 'p', mutatorId: 2 })).toMatchObject({
      customGameLobby: { configuration: { mutators: { id: 2 } } },
    });
  });

  it('inviteBody is a one-element array keyed by summoner id or puuid', () => {
    expect(inviteBody({ method: 'summonerId', summonerId: 2686822975473024 })).toEqual([
      { toSummonerId: 2686822975473024 },
    ]);
    expect(inviteBody({ method: 'puuid', puuid: PUUID })).toEqual([{ toPuuid: PUUID }]);
  });
});

describe('the allow-list', () => {
  it('holds exactly the create, invite and two switch-teams paths, all under /lol-lobby/', () => {
    expect(LOBBY_WRITE_PATHS).toEqual([
      '/lol-lobby/v2/lobby',
      '/lol-lobby/v2/lobby/invitations',
      '/lol-lobby/v1/lobby/custom/switch-teams',
      '/lol-lobby/v2/lobby/custom/switch-teams',
    ]);
    for (const path of LOBBY_WRITE_PATHS) {
      expect(path.startsWith('/lol-lobby/')).toBe(true);
      expect(() => assertLobbyWritePath(path)).not.toThrow();
    }
  });

  it('throws for any champion-select, matchmaking, gameflow or in-game path', () => {
    for (const path of [
      '/lol-champ-select/v1/session/actions/1',
      '/lol-lobby/v2/lobby/matchmaking/search',
      '/lol-matchmaking/v1/ready-check/accept',
      '/lol-lobby-team-builder/champ-select/v1/session',
      '/lol-gameflow/v1/session/dodge',
      '/lol-gameflow/v1/pre-end-of-game/complete',
      '/liveclientdata/allgamedata',
      '/lol-lobby/v2/lobby/',
      'lol-lobby/v2/lobby',
    ]) {
      expect(isLobbyWritePath(path)).toBe(false);
      expect(() => assertLobbyWritePath(path)).toThrow(/refusing to POST outside the lobby allow-list/);
    }
  });

  it('is the only way this package POSTs: no other source file calls post/put/delete/raw on the client', () => {
    const files = sourceFiles(SRC_DIR);
    const callers = Object.entries(files)
      .filter(([, text]) =>
        /\b\w+\.(post|put|delete|patch)\(\s*(path|WRITE|'\/)|\.raw\(\s*'(POST|PUT|DELETE|PATCH)'|\.request\(\s*'(POST|PUT|DELETE|PATCH)'/.test(
          text,
        ),
      )
      .map(([name]) => name)
      .sort();
    // client.ts defines the methods (its `post` forwards to `request('POST', ...)`); writes.ts is the one caller.
    expect(callers).toEqual(['client.ts', 'writes.ts']);
    expect(files['client.ts']).toMatch(/post<T>\(path: string, body: unknown/);
  });

  it('names no gameplay path anywhere in the package, and the in-game server only as the documented GET', () => {
    const files = sourceFiles(SRC_DIR);
    const forbidden =
      /['"`]\/lol-champ-select|['"`]\/lol-lobby-team-builder|['"`]\/lol-matchmaking|['"`]\/lol-lobby\/v2\/lobby\/matchmaking|['"`]\/lol-gameflow\/v1\/session\/|\.post\([^)]*2999/;
    for (const [name, text] of Object.entries(files)) {
      expect(forbidden.test(text), `${name} names a gameplay path`).toBe(false);
    }
    const liveMentions = Object.entries(files)
      .filter(([, text]) => text.includes('liveclientdata') || text.includes('2999'))
      .map(([name]) => name)
      .sort();
    // The catalogue row and the smoke script's GET probe (`--live-port`); nothing else knows the port.
    expect(liveMentions).toEqual(['cli/smoke.ts', 'endpoints.ts']);
    expect(LIVE_CLIENT_DATA.port).toBe(2999);
    expect(LOBBY_WRITE_PATHS.some((path) => path.includes('liveclientdata'))).toBe(false);
  });
});

describe('the verification gate', () => {
  const rowLabels: Record<LobbyWriteKind, string> = {
    create_lobby: 'Create custom lobby',
    invite: 'Invite',
    switch_side: 'Switch side',
  };

  it('never reads verified while the row in docs/03-lcu-reference.md is unverified, and matches its patch when it is', () => {
    const doc = readFileSync(join(REPO_ROOT, 'docs', '03-lcu-reference.md'), 'utf8');
    for (const kind of Object.keys(rowLabels) as LobbyWriteKind[]) {
      const line = doc.split('\n').find((candidate) => candidate.startsWith(`| ${rowLabels[kind]} |`));
      expect(line, `docs/03 has a row for ${rowLabels[kind]}`).toBeDefined();
      const cells = (line as string).split('|').map((cell) => cell.trim());
      const status = cells[cells.length - 2] as string;
      expect(
        WRITE_ENDPOINTS[
          kind === 'create_lobby' ? 'createLobby' : kind === 'invite' ? 'invite' : 'switchSideCandidates'
        ],
      ).toBeDefined();
      const gate = LOBBY_WRITE_VERIFICATION[kind];
      const rowVerified = /^verified \(([\d.]+), (\d{4}-\d{2}-\d{2})\)/.exec(status);
      if (rowVerified === null) {
        expect(gate.verified, `${kind}: row reads "${status}", so the gate must be off`).toBe(false);
        expect(isLobbyWriteVerified(kind)).toBe(false);
      } else {
        expect(gate, `${kind}: row is verified, so the gate must carry the same patch`).toEqual({
          verified: true,
          patch: rowVerified[1],
          date: rowVerified[2],
        });
      }
    }
  });
});

describe('writes against the fake client (answers are assumptions, not captures)', () => {
  it('postCreateLobby sends the reference body and hands back the status and body (assumed: 200 with the lobby)', async () => {
    const { client, posts } = await setup((request) =>
      request.method === 'POST' && request.path === '/lol-lobby/v2/lobby'
        ? {
            status: 200,
            body: { partyId: 'party-1', gameConfig: { customMutatorName: 'SimulPickStrategy' } },
          }
        : undefined,
    );
    const write = await postCreateLobby(client, { lobbyName: 'customs-verify', lobbyPassword: '1234' });
    expect(write.path).toBe('/lol-lobby/v2/lobby');
    expect(write.response.ok && write.response.status).toBe(200);
    expect(write.response.ok && write.response.json).toEqual({
      partyId: 'party-1',
      gameConfig: { customMutatorName: 'SimulPickStrategy' },
    });
    expect(posts()).toHaveLength(1);
    expect(JSON.parse(posts()[0]?.body ?? '')).toEqual(write.body);
    expect(posts()[0]?.contentType).toBe('application/json');
  });

  it('inviteWithFallback POSTs [{ toSummonerId }] once when the client accepts it (assumed: 2xx)', async () => {
    const { client, posts } = await setup((request) =>
      request.method === 'POST' && request.path === '/lol-lobby/v2/lobby/invitations'
        ? { status: 200, body: [] }
        : undefined,
    );
    const result = await inviteWithFallback(client, { puuid: PUUID, summonerId: 7 });
    expect(result.used).toEqual({ method: 'summonerId', summonerId: 7 });
    expect(result.attempts).toHaveLength(1);
    expect(posts().map((request) => JSON.parse(request.body))).toEqual([[{ toSummonerId: 7 }]]);
  });

  it('inviteWithFallback retries with [{ toPuuid }] on a 4xx, and starts there when no summoner id is known', async () => {
    const { client, posts } = await setup((request) => {
      if (request.method !== 'POST' || request.path !== '/lol-lobby/v2/lobby/invitations') {
        return undefined;
      }
      return request.body.includes('toSummonerId')
        ? { status: 400, body: { errorCode: 'RPC_ERROR', httpStatus: 400, message: 'assumed rejection' } }
        : { status: 200, body: [] };
    });
    const result = await inviteWithFallback(client, { puuid: PUUID, summonerId: 7 });
    expect(result.used).toEqual({ method: 'puuid', puuid: PUUID });
    expect(result.attempts.map((attempt) => describeWriteResponse(attempt.response))).toEqual([
      '400 assumed rejection',
      '200',
    ]);
    const direct = await inviteWithFallback(client, { puuid: PUUID, summonerId: null });
    expect(direct.attempts).toHaveLength(1);
    expect(posts().map((request) => JSON.parse(request.body))).toEqual([
      [{ toSummonerId: 7 }],
      [{ toPuuid: PUUID }],
      [{ toPuuid: PUUID }],
    ]);
  });

  it('inviteWithFallback does not fall back on a 5xx or a dead client: that is not "wrong body"', async () => {
    const { client, posts } = await setup((request) =>
      request.method === 'POST'
        ? { status: 500, body: { errorCode: 'RPC_ERROR', httpStatus: 500 } }
        : undefined,
    );
    const result = await inviteWithFallback(client, { puuid: PUUID, summonerId: 7 });
    expect(result.used.method).toBe('summonerId');
    expect(posts()).toHaveLength(1);
  });

  it('postSwitchTeams tries v1 with no body and stops there when it answers (assumed: 204)', async () => {
    const { client, posts } = await setup((request) =>
      request.method === 'POST' && request.path === '/lol-lobby/v1/lobby/custom/switch-teams'
        ? { status: 204, body: null }
        : undefined,
    );
    const result = await postSwitchTeams(client);
    expect(result.used.path).toBe('/lol-lobby/v1/lobby/custom/switch-teams');
    expect(result.attempts).toHaveLength(1);
    expect(result.used.response.ok && result.used.response.status).toBe(204);
    expect(posts()[0]?.body).toBe('');
    expect(posts()[0]?.contentType).toBeUndefined();
  });

  it('postSwitchTeams falls through to v2 on a v1 404, and reports the last answer when both are missing', async () => {
    const { client, posts } = await setup((request) =>
      request.method === 'POST' && request.path === '/lol-lobby/v2/lobby/custom/switch-teams'
        ? { status: 204, body: null }
        : undefined,
    );
    const result = await postSwitchTeams(client);
    expect(result.attempts.map((attempt) => attempt.path)).toEqual([
      '/lol-lobby/v1/lobby/custom/switch-teams',
      '/lol-lobby/v2/lobby/custom/switch-teams',
    ]);
    expect(result.used.path).toBe('/lol-lobby/v2/lobby/custom/switch-teams');
    expect(posts()).toHaveLength(2);

    const { client: none } = await setup(() => undefined);
    const missing = await postSwitchTeams(none);
    expect(missing.attempts).toHaveLength(2);
    expect(describeWriteResponse(missing.used.response)).toBe('404 fake lcu: no such route');
  });

  it('describeWriteResponse never includes a body, only status and message', async () => {
    const { client } = await setup(() => ({
      status: 400,
      body: { errorCode: 'RPC_ERROR', httpStatus: 400, message: 'bad', secret: 'do-not-print' },
    }));
    const write = await postCreateLobby(client, { lobbyName: 'n', lobbyPassword: 'pass' });
    expect(describeWriteResponse(write.response)).toBe('400 bad');
    const dead = new LcuClient({ port: 1, password: 'x', tls: { mode: 'insecure' }, timeoutMs: 500 });
    clients.push(dead);
    const gone = await postCreateLobby(dead, { lobbyName: 'n', lobbyPassword: 'pass' });
    expect(describeWriteResponse(gone.response)).toMatch(/^no answer \(/);
  });
});
