/**
 * The lobby writes (M4.1) against the fake client, plus the two guards that keep this package on the right
 * side of the Riot line: the allow-list (nothing POSTs outside `/lol-lobby/...`), and the verification gate,
 * which can never read `verified` while the reference row in docs/03-lcu-reference.md is still `unverified`.
 *
 * Every fake answer below is an **assumption**: the shape read from the 16.17 client's own UI code and
 * OpenAPI document, not a capture. The test names say so. A live run (`pnpm --filter companion
 * verify-commands`) is what turns them into fixtures. The one capture that exists is a refusal: the
 * community body answered `500 INVALID_LOBBY` on 2026-09-09 (`create-lobby--legacy-blind.json`).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { LcuClient } from './client.js';
import { LIVE_CLIENT_DATA, WRITE_ENDPOINTS } from './endpoints.js';
import { readFixture } from './fixtures.js';
import { type CustomGameQueues, CustomGameQueuesSchema, LcuErrorSchema } from './schemas.js';
import {
  type CannedRoute,
  type FakeLcu,
  type RecordedRequest,
  startFakeLcu,
} from './test-support/fake-lcu.js';
import {
  assertLobbyWritePath,
  chooseCustomLobbyMutator,
  createLobbyBody,
  createLobbyBodyVariant,
  createLobbyCandidates,
  customLobbyIdsFor,
  describeMutators,
  describeWriteResponse,
  inviteBody,
  inviteWithFallback,
  isLobbyWritePath,
  isLobbyWriteVerified,
  KNOWN_CUSTOM_LOBBY_IDS,
  LOBBY_WRITE_PATHS,
  LOBBY_WRITE_VERIFICATION,
  type LobbyWriteKind,
  postCreateLobby,
  postCreateLobbyCandidates,
  postSwitchSide,
  summonersRiftSubcategory,
  switchSidePath,
} from './writes.js';

const PASSWORD = 'fake-lockfile-password';
const PUUID = 'aebd7c57-83d8-551d-a7b2-7caa7e8b1960';
const SRC_DIR = fileURLToPath(new URL('./', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const IDS = { queueId: 3100, mutatorId: 19 };

/**
 * Assumed: what `/lol-game-queues/v1/custom` lists for Summoner's Rift on 16.17. The blind entry has empty
 * words, like the client's own config for queue 3100 did in the log; the others carry the names the older
 * game-type configs had. Shape per the 16.17 OpenAPI document.
 */
const ASSUMED_CUSTOM_QUEUES: CustomGameQueues = CustomGameQueuesSchema.parse({
  queueAvailability: 'Available',
  spectatorPolicies: ['AllAllowed', 'FriendsAllowed', 'LobbyAllowed', 'NotAllowed'],
  spectatorSlotLimit: 4,
  gameServerRegions: [],
  subcategories: [
    {
      mapId: 12,
      gameMode: 'ARAM',
      numPlayersPerTeam: 5,
      mutators: [{ id: 21, name: 'GAME_CFG_TEAM_BUILDER_RANDOM', pickMode: 'AllRandomPickStrategy' }],
    },
    {
      mapId: 11,
      gameMode: 'CLASSIC',
      numPlayersPerTeam: 5,
      queueAvailability: 'Available',
      mutators: [
        { id: 19, name: '', pickMode: '', banMode: '' },
        {
          id: 20,
          name: 'GAME_CFG_DRAFT_STD',
          pickMode: 'DraftModeSinglePickStrategy',
          banMode: 'StandardBanStrategy',
        },
        { id: 6, name: 'GAME_CFG_TOURNAMENT_DRAFT', pickMode: 'TournamentPickStrategy' },
        { id: 4, name: 'GAME_CFG_PICK_RANDOM', pickMode: 'AllRandomPickStrategy' },
      ],
    },
  ],
});

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

describe('request bodies (read from the 16.17 client, unverified as POSTs)', () => {
  it("createLobbyBody is the client dialog's body: queueId at the top, mutators.id inside, no isCustom, null password when empty", () => {
    expect(createLobbyBody({ lobbyName: 'Customs 09 Sep #1', lobbyPassword: '4821', ids: IDS })).toEqual({
      customGameLobby: {
        configuration: {
          gameMode: 'CLASSIC',
          gameMutator: '',
          gameServerRegion: '',
          mapId: 11,
          mutators: { id: 19 },
          spectatorPolicy: 'AllAllowed',
          spectatorDelayEnabled: true,
          teamSize: 5,
          hidePublicly: false,
          aramMapMutator: 'NONE',
        },
        lobbyName: 'Customs 09 Sep #1',
        hidePublicly: false,
        lobbyPassword: '4821',
      },
      queueId: 3100,
    });
    const open = createLobbyBody({
      lobbyName: 'n',
      lobbyPassword: '',
      ids: { queueId: 3130, mutatorId: 3130 },
    });
    expect(open).toMatchObject({ customGameLobby: { lobbyPassword: null }, queueId: 3130 });
    expect(open).not.toHaveProperty('isCustom');
  });

  it('the fallback variants carry the schema-complete and the legacy shapes, each with queueId', () => {
    const full = createLobbyBodyVariant('dto-full', { lobbyName: 'n', lobbyPassword: 'p', ids: IDS });
    expect(full).toMatchObject({
      queueId: 3100,
      customGameLobby: {
        configuration: { mutators: { id: 19 }, gameTypeConfig: { id: 19 }, maxPlayerCount: 10 },
      },
      gameCustomization: {},
    });
    const legacy = createLobbyBodyVariant('legacy-queue', {
      lobbyName: 'n',
      lobbyPassword: 'p',
      ids: { queueId: 3100, mutatorId: 1 },
    });
    expect(legacy).toEqual({
      customGameLobby: {
        configuration: {
          gameMode: 'CLASSIC',
          mapId: 11,
          mutators: { id: 1 },
          spectatorPolicy: 'AllAllowed',
          teamSize: 5,
          gameServerRegion: '',
        },
        lobbyName: 'n',
        lobbyPassword: 'p',
      },
      isCustom: true,
      queueId: 3100,
    });
  });

  it('createLobbyCandidates ranks the live dialog ids first, then the known 3100/19 pair, and dedupes', () => {
    const withLive = createLobbyCandidates({
      lobbyName: 'n',
      lobbyPassword: 'p',
      live: { queueId: 20, mutatorId: 20 },
    });
    expect(withLive.map((candidate) => candidate.id)).toEqual([
      'ui-live-20',
      'ui-3100-19',
      'ui-3100-3100',
      'dto-full-3100-19',
      'legacy-queue-3100',
    ]);
    expect(withLive.map((candidate) => candidate.variant)).toEqual([
      'ui',
      'ui',
      'ui',
      'dto-full',
      'legacy-queue',
    ]);
    expect(withLive.every((candidate) => candidate.evidence.length > 20)).toBe(true);
    // The live read landing on the known pair is the same body as the second candidate: listed once.
    const onKnown = createLobbyCandidates({ lobbyName: 'n', lobbyPassword: 'p', live: IDS });
    expect(onKnown.map((candidate) => candidate.id)).toEqual([
      'ui-live-19',
      'ui-3100-3100',
      'dto-full-3100-19',
      'legacy-queue-3100',
    ]);
    const noLive = createLobbyCandidates({ lobbyName: 'n', lobbyPassword: 'p', live: null });
    expect(noLive[0]?.id).toBe('ui-3100-19');
    expect(noLive).toHaveLength(4);
  });

  it('the mutator chooser reads the dialog: words first, the known blind id when the words are empty, null otherwise', () => {
    const rift = summonersRiftSubcategory(ASSUMED_CUSTOM_QUEUES);
    expect(rift?.mutators).toHaveLength(4);
    expect(chooseCustomLobbyMutator(rift as NonNullable<typeof rift>, 'blind')?.id).toBe(19);
    expect(chooseCustomLobbyMutator(rift as NonNullable<typeof rift>, 'draft')?.id).toBe(20);
    expect(chooseCustomLobbyMutator(rift as NonNullable<typeof rift>, 'tournamentDraft')?.id).toBe(6);
    expect(chooseCustomLobbyMutator(rift as NonNullable<typeof rift>, 'allRandom')?.id).toBe(4);
    expect(customLobbyIdsFor(ASSUMED_CUSTOM_QUEUES, 'draft')).toEqual({ queueId: 20, mutatorId: 20 });
    expect(describeMutators(rift as NonNullable<typeof rift>)).toBe(
      '19, 20 GAME_CFG_DRAFT_STD pick=DraftModeSinglePickStrategy ban=StandardBanStrategy, 6 GAME_CFG_TOURNAMENT_DRAFT pick=TournamentPickStrategy, 4 GAME_CFG_PICK_RANDOM pick=AllRandomPickStrategy',
    );

    const nameless: CustomGameQueues = {
      subcategories: [{ mapId: 11, gameMode: 'CLASSIC', mutators: [{ id: 19 }, { id: 20 }] }],
    };
    expect(customLobbyIdsFor(nameless, 'blind')).toEqual({ queueId: 19, mutatorId: 19 });
    expect(customLobbyIdsFor(nameless, 'draft')).toBeNull();
    expect(customLobbyIdsFor({ subcategories: [] }, 'blind')).toBeNull();
    expect(KNOWN_CUSTOM_LOBBY_IDS).toEqual({ blindQueueId: 3100, blindGameTypeConfigId: 19 });
  });

  it('inviteBody is a one-element array keyed by summoner id or puuid', () => {
    expect(inviteBody({ method: 'summonerId', summonerId: 2686822975473024 })).toEqual([
      { toSummonerId: 2686822975473024 },
    ]);
    expect(inviteBody({ method: 'puuid', puuid: PUUID })).toEqual([{ toPuuid: PUUID }]);
  });

  it('switchSidePath names the side in the path, as the client UI does', () => {
    expect(switchSidePath(100)).toBe('/lol-lobby/v2/lobby/team/TEAM1');
    expect(switchSidePath(200)).toBe('/lol-lobby/v2/lobby/team/TEAM2');
  });
});

describe('the 2026-09-09 capture', () => {
  it('pins the refusal: the community body answered 500 INVALID_LOBBY on 16.17 for mutators.id 1 and 2', () => {
    for (const [id, mutatorId] of [
      ['create-lobby--legacy-blind', 1],
      ['create-lobby--legacy-draft', 2],
    ] as const) {
      const read = readFixture('16.17', id);
      expect(read.ok, `${id} exists`).toBe(true);
      if (!read.ok) {
        continue;
      }
      expect(read.envelope.method).toBe('POST');
      expect(read.envelope.status).toBe(500);
      expect(read.envelope.request).toMatchObject({
        customGameLobby: {
          configuration: { mutators: { id: mutatorId } },
          lobbyPassword: '[redacted]',
        },
        isCustom: true,
      });
      expect(read.envelope.request).not.toHaveProperty('queueId');
      expect(LcuErrorSchema.parse(read.envelope.body)).toMatchObject({
        errorCode: 'RPC_ERROR',
        httpStatus: 500,
        message: 'INVALID_LOBBY',
      });
    }
  });

  it('pins that both invite bodies answer 404 LOBBY_NOT_FOUND when there is no lobby', () => {
    for (const id of ['lobby-invitations--no-lobby', 'lobby-invitations--by-puuid--no-lobby']) {
      const read = readFixture('16.17', id);
      expect(read.ok, `${id} exists`).toBe(true);
      if (!read.ok) {
        continue;
      }
      expect(read.envelope.status).toBe(404);
      expect(LcuErrorSchema.parse(read.envelope.body).message).toBe('LOBBY_NOT_FOUND');
    }
  });
});

describe('the allow-list', () => {
  it('holds exactly the create, invite and two team paths, all under /lol-lobby/', () => {
    expect(LOBBY_WRITE_PATHS).toEqual([
      '/lol-lobby/v2/lobby',
      '/lol-lobby/v2/lobby/invitations',
      '/lol-lobby/v2/lobby/team/TEAM1',
      '/lol-lobby/v2/lobby/team/TEAM2',
    ]);
    for (const path of LOBBY_WRITE_PATHS) {
      expect(path.startsWith('/lol-lobby/')).toBe(true);
      expect(() => assertLobbyWritePath(path)).not.toThrow();
    }
  });

  it('throws for any champion-select, matchmaking, gameflow, spectator-move or in-game path', () => {
    for (const path of [
      '/lol-champ-select/v1/session/actions/1',
      '/lol-lobby/v2/lobby/matchmaking/search',
      '/lol-matchmaking/v1/ready-check/accept',
      '/lol-lobby-team-builder/champ-select/v1/session',
      '/lol-gameflow/v1/session/dodge',
      '/lol-gameflow/v1/pre-end-of-game/complete',
      '/lol-lobby/v1/lobby/custom/start-champ-select',
      '/lol-lobby/v2/lobby/team/SPECTATOR',
      '/lol-lobby/v1/lobby/custom/switch-teams',
      '/lol-lobby/v2/lobby/custom/switch-teams',
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
    // Any `.post(` / `.put(` / `.delete(` / `.patch(` at all, whatever the argument, plus the raw/request
    // spellings. client.ts defines the methods (its `post` forwards to `request('POST', ...)`) and socket.ts
    // has a `Set.delete`; neither reaches the client with a write. writes.ts is the one caller.
    const callers = Object.entries(files)
      .filter(([name]) => name !== 'client.ts' && name !== 'socket.ts')
      .filter(([, text]) =>
        /\.(post|put|delete|patch)\(|\.raw\(\s*['"`](POST|PUT|DELETE|PATCH)|\.request\(\s*['"`](POST|PUT|DELETE|PATCH)/.test(
          text,
        ),
      )
      .map(([name]) => name)
      .sort();
    expect(callers).toEqual(['writes.ts']);
    expect(files['client.ts']).toMatch(/post<T>\(path: string, body: unknown/);
    expect(files['socket.ts']).not.toMatch(/\.(post|put|patch)\(/);
  });

  it('names no gameplay path anywhere in the package, and the in-game server only as the documented GET', () => {
    const files = sourceFiles(SRC_DIR);
    const forbidden =
      /['"`]\/lol-champ-select|['"`]\/lol-lobby-team-builder|['"`]\/lol-matchmaking|['"`]\/lol-lobby\/v2\/lobby\/matchmaking|['"`]\/lol-gameflow\/v1\/session\/|['"`]\/lol-lobby\/v1\/lobby\/custom\/(start|cancel)-champ-select|\.post\([^)]*2999/;
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
          kind === 'create_lobby' ? 'createLobby' : kind === 'invite' ? 'invite' : 'switchSide'
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

  it('the switch-side row names the team path the code uses', () => {
    const doc = readFileSync(join(REPO_ROOT, 'docs', '03-lcu-reference.md'), 'utf8');
    const line = doc.split('\n').find((candidate) => candidate.startsWith('| Switch side |'));
    expect(line).toContain(WRITE_ENDPOINTS.switchSide.template);
  });
});

describe('writes against the fake client (answers are assumptions, not captures)', () => {
  it('postCreateLobby sends the dialog body and hands back the status and body (assumed: 200 with the lobby)', async () => {
    const { client, posts } = await setup((request) =>
      request.method === 'POST' && request.path === '/lol-lobby/v2/lobby'
        ? {
            status: 200,
            body: { partyId: 'party-1', gameConfig: { customMutatorName: 'SimulPickStrategy' } },
          }
        : undefined,
    );
    const write = await postCreateLobby(client, {
      lobbyName: 'customs-verify',
      lobbyPassword: '1234',
      ids: IDS,
    });
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

  it('postCreateLobbyCandidates stops at the first 2xx, reports every attempt, and stops on a dead client', async () => {
    const refusal: CannedRoute = {
      status: 500,
      body: { errorCode: 'RPC_ERROR', httpStatus: 500, implementationDetails: {}, message: 'INVALID_LOBBY' },
    };
    // Assumed: only the 3100/3100 pair is accepted.
    const { client, posts } = await setup((request) => {
      if (request.method !== 'POST' || request.path !== '/lol-lobby/v2/lobby') {
        return undefined;
      }
      const body = JSON.parse(request.body) as {
        queueId: number;
        customGameLobby: { configuration: { mutators: { id: number } } };
      };
      return body.queueId === 3100 && body.customGameLobby.configuration.mutators.id === 3100
        ? { status: 200, body: { partyId: 'party-2' } }
        : refusal;
    });
    const seen: string[] = [];
    const result = await postCreateLobbyCandidates(
      client,
      createLobbyCandidates({ lobbyName: 'n', lobbyPassword: 'p', live: { queueId: 7, mutatorId: 7 } }),
      (attempt) => {
        seen.push(`${attempt.candidate.id}:${describeWriteResponse(attempt.write.response)}`);
      },
    );
    expect(seen).toEqual(['ui-live-7:500 INVALID_LOBBY', 'ui-3100-19:500 INVALID_LOBBY', 'ui-3100-3100:200']);
    expect(result.accepted?.candidate.id).toBe('ui-3100-3100');
    expect(result.attempts).toHaveLength(3);
    expect(posts()).toHaveLength(3);

    const { client: refusing } = await setup(() => refusal);
    const none = await postCreateLobbyCandidates(
      refusing,
      createLobbyCandidates({ lobbyName: 'n', lobbyPassword: 'p', live: null }),
    );
    expect(none.accepted).toBeNull();
    expect(none.attempts).toHaveLength(4);

    const dead = new LcuClient({ port: 1, password: 'x', tls: { mode: 'insecure' }, timeoutMs: 500 });
    clients.push(dead);
    const gone = await postCreateLobbyCandidates(
      dead,
      createLobbyCandidates({ lobbyName: 'n', lobbyPassword: 'p', live: null }),
    );
    expect(gone.accepted).toBeNull();
    expect(gone.attempts).toHaveLength(1);
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

  it('postSwitchSide POSTs the team path for the side asked, with no body (assumed: 204)', async () => {
    const { client, posts } = await setup((request) =>
      request.method === 'POST' && request.path === '/lol-lobby/v2/lobby/team/TEAM2'
        ? { status: 204, body: null }
        : undefined,
    );
    const result = await postSwitchSide(client, 200);
    expect(result.path).toBe('/lol-lobby/v2/lobby/team/TEAM2');
    expect(result.body).toBeUndefined();
    expect(result.response.ok && result.response.status).toBe(204);
    expect(posts()).toHaveLength(1);
    expect(posts()[0]?.body).toBe('');
    expect(posts()[0]?.contentType).toBeUndefined();

    const missing = await postSwitchSide(client, 100);
    expect(missing.path).toBe('/lol-lobby/v2/lobby/team/TEAM1');
    expect(describeWriteResponse(missing.response)).toBe('404 fake lcu: no such route');
  });

  it('describeWriteResponse never includes a body, only status and message', async () => {
    const { client } = await setup(() => ({
      status: 400,
      body: { errorCode: 'RPC_ERROR', httpStatus: 400, message: 'bad', secret: 'do-not-print' },
    }));
    const write = await postCreateLobby(client, { lobbyName: 'n', lobbyPassword: 'pass', ids: IDS });
    expect(describeWriteResponse(write.response)).toBe('400 bad');
    const dead = new LcuClient({ port: 1, password: 'x', tls: { mode: 'insecure' }, timeoutMs: 500 });
    clients.push(dead);
    const gone = await postCreateLobby(dead, { lobbyName: 'n', lobbyPassword: 'pass', ids: IDS });
    expect(describeWriteResponse(gone.response)).toMatch(/^no answer \(/);
  });
});
