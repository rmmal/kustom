/**
 * Runs the real smoke script as a subprocess against the in-process fake client, so the fixture-writing and
 * `--diff` paths are exercised without League installed.
 */

import { execFile } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FixtureEnvelopeSchema } from '../fixtures.js';
import { LOCKFILE_CANDIDATES_ENV } from '../lockfile.js';
import { type CannedRoute, type FakeLcu, startFakeLcu } from '../test-support/fake-lcu.js';

const execFileAsync = promisify(execFile);
const packageDir = fileURLToPath(new URL('../../', import.meta.url));
const tsx = join(packageDir, 'node_modules', '.bin', 'tsx');
const smoke = join(packageDir, 'src', 'cli', 'smoke.ts');

const PUUID = '11111111-2222-3333-4444-555555555555';

/** A PC with a game in progress has a live data server on 2999; tests always point at a dead port. */
const LIVE_PORT_ARGS = ['--live-port', '1'];

/**
 * A machine with League running has a real lockfile at the platform default; the script must never see it
 * from a test, so the default candidates are redirected to a path that does not exist.
 */
const NO_DEFAULT_LOCKFILE_ENV = {
  ...process.env,
  [LOCKFILE_CANDIDATES_ENV]: join(tmpdir(), 'lcu-smoke-no-default-install', 'lockfile'),
};

const routes: Record<string, CannedRoute> = {
  'GET /lol-patch/v1/game-version': {
    status: 200,
    body: '"16.17.812.4632"',
    contentType: 'application/json',
  },
  'GET /system/v1/builds': { status: 200, body: { version: '16.17.812.4632' } },
  'GET /lol-summoner/v1/current-summoner': {
    status: 200,
    body: { puuid: PUUID, summonerId: 7, gameName: 'Test Name', tagLine: 'EUNE' },
  },
  'GET /lol-summoner/v1/alias/lookup?gameName=Test%20Name&tagLine=EUNE': {
    status: 200,
    body: { puuid: PUUID },
  },
  [`GET /lol-summoner/v2/summoners/puuid/${PUUID}`]: { status: 200, body: { summonerId: 7, puuid: PUUID } },
  // A credential-looking key next to real data: the fixture must carry `[redacted]`, never the value.
  'GET /lol-ranked/v1/current-ranked-stats': {
    status: 200,
    body: { queueMap: {}, sessionToken: 'do-not-write-me' },
  },
  [`GET /lol-ranked/v1/ranked-stats/${PUUID}`]: { status: 200, body: { queueMap: {} } },
  'GET /lol-gameflow/v1/gameflow-phase': { status: 200, body: '"None"', contentType: 'application/json' },
  'GET /lol-gameflow/v1/session': { status: 404, body: { errorCode: 'RPC_ERROR', httpStatus: 404 } },
  'GET /lol-lobby/v2/lobby': { status: 404, body: { errorCode: 'RPC_ERROR', httpStatus: 404 } },
  'GET /lol-end-of-game/v1/eog-stats-block': {
    status: 404,
    body: { errorCode: 'RPC_ERROR', httpStatus: 404 },
  },
  [`GET /lol-match-history/v1/products/lol/${PUUID}/matches?begIndex=0&endIndex=20`]: {
    status: 200,
    body: {
      games: {
        games: [
          { gameId: 100, gameType: 'MATCHED_GAME' },
          { gameId: 200, gameType: 'CUSTOM_GAME' },
        ],
      },
    },
  },
  'GET /lol-match-history/v1/games/200': { status: 200, body: { gameId: 200, participants: [] } },
  'GET /lol-match-history/v1/games/100': { status: 200, body: { gameId: 100, participants: [] } },
  'GET /swagger/v2/swagger.json': { status: 404, body: 'Not Found', contentType: 'text/plain' },
};

async function runSmoke(args: readonly string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(tsx, [smoke, ...args, ...LIVE_PORT_ARGS], {
      cwd: packageDir,
      timeout: 30_000,
      env: NO_DEFAULT_LOCKFILE_ENV,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

function writeLockfile(path: string, fake: FakeLcu): void {
  writeFileSync(path, `LeagueClient:1234:${fake.port}:${fake.password}:https`);
}

describe('smoke script', () => {
  let fake: FakeLcu;
  let dir: string;
  let lockfile: string;
  let out: string;

  beforeAll(async () => {
    fake = await startFakeLcu({ routes });
    dir = mkdtempSync(join(tmpdir(), 'lcu-smoke-'));
    lockfile = join(dir, 'lockfile');
    out = join(dir, 'fixtures');
    writeLockfile(lockfile, fake);
  });

  afterAll(async () => {
    await fake.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('exits 2 with a clear message when there is no lockfile', async () => {
    const result = await runSmoke(['--lockfile', join(dir, 'nope'), '--out', out]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('League client not running: lockfile not found.');
    expect(result.stderr).toContain(join(dir, 'nope'));
    expect(result.stderr).toContain('lcu-smoke-no-default-install');
  });

  it('exits 3 on a dead port after a single pinned attempt, never stepping down to insecure', async () => {
    const dead = join(dir, 'dead-lockfile');
    writeFileSync(dead, 'LeagueClient:1:1:pw:https');
    const result = await runSmoke(['--lockfile', dead, '--out', out]);
    expect(result.code).toBe(3);
    expect(result.stdout).toContain('pinned to riotgames.pem -> ECONNREFUSED');
    expect(result.stdout).not.toContain('insecure');
    expect(result.stderr).toContain('No TLS mode reached the client');
  });

  it('writes one envelope per endpoint plus a manifest, falling back through TLS modes', async () => {
    const result = await runSmoke(['--lockfile', lockfile, '--out', out]);
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    // Pinned to Riot's root fails against the fake with a certificate error; the probe lands on insecure.
    expect(result.stdout).toContain('using: insecure');
    expect(result.stdout).toContain('client version: 16.17.812.4632 (from /lol-patch/v1/game-version)');
    expect(result.stdout).toContain('match-detail will use 200 (custom, result unknown)');

    const patchDir = join(out, '16.17');
    expect(existsSync(patchDir)).toBe(true);
    const files = readdirSync(patchDir).sort();
    expect(files).toEqual([
      'alias-lookup.json',
      'current-ranked-stats.json',
      'current-summoner.json',
      'custom-game-queues.json',
      'eog-stats-block.json',
      'game-queues.json',
      'game-version.json',
      'gameflow-phase.json',
      'gameflow-session.json',
      'lobby.json',
      'manifest.json',
      'match-detail.json',
      'match-history.json',
      'openapi-v3.json',
      'ranked-stats-by-puuid.json',
      'summoner-by-puuid.json',
      'swagger-v2.json',
      'system-builds.json',
    ]);

    const lobby = FixtureEnvelopeSchema.parse(JSON.parse(readFileSync(join(patchDir, 'lobby.json'), 'utf8')));
    expect(lobby.status).toBe(404);
    expect(lobby.patch).toBe('16.17');
    expect(lobby.body).toEqual({ errorCode: 'RPC_ERROR', httpStatus: 404 });

    const swagger = FixtureEnvelopeSchema.parse(
      JSON.parse(readFileSync(join(patchDir, 'swagger-v2.json'), 'utf8')),
    );
    expect(swagger.bodyText).toBe('Not Found');
    expect(swagger.body).toBeUndefined();

    const detail = FixtureEnvelopeSchema.parse(
      JSON.parse(readFileSync(join(patchDir, 'match-detail.json'), 'utf8')),
    );
    expect(detail.path).toBe('/lol-match-history/v1/games/200');

    const rankedText = readFileSync(join(patchDir, 'current-ranked-stats.json'), 'utf8');
    expect(rankedText).not.toContain('do-not-write-me');
    const ranked = FixtureEnvelopeSchema.parse(JSON.parse(rankedText));
    expect(ranked.body).toEqual({ queueMap: {}, sessionToken: '[redacted]' });
    expect(result.stdout).toMatch(/current-ranked-stats .*credential-looking keys redacted/);

    const manifest = JSON.parse(readFileSync(join(patchDir, 'manifest.json'), 'utf8')) as {
      patch: string;
      results: { id: string; status: string; note: string }[];
    };
    expect(manifest.patch).toBe('16.17');
    const live = manifest.results.find((row) => row.id === 'live-client-data');
    expect(live?.status).toBe('ERR');
    expect(live?.note).toContain('127.0.0.1:1');

    // GET only: the fake saw nothing but GETs and no WS upgrade.
    expect(new Set(fake.requests.map((request) => request.method))).toEqual(new Set(['GET']));
  });

  it('--game-id pins the match-detail probe', async () => {
    const result = await runSmoke(['--lockfile', lockfile, '--out', out, '--game-id', '100', '--diff']);
    expect(result.stdout).not.toContain('match-detail will use');
    expect(result.stdout).toMatch(/match-detail +\/lol-match-history\/v1\/games\/100 /);
  });

  it('--game-id with several ids pins the first and writes the rest as match-detail--<id> overlays (M5.18)', async () => {
    const overlays = mkdtempSync(join(tmpdir(), 'lcu-smoke-overlays-'));
    try {
      const result = await runSmoke(['--lockfile', lockfile, '--out', overlays, '--game-id', '200, 100']);
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/match-detail +\/lol-match-history\/v1\/games\/200 /);
      expect(result.stdout).toMatch(/match-detail--100 +\/lol-match-history\/v1\/games\/100 /);
      const pinned = FixtureEnvelopeSchema.parse(
        JSON.parse(readFileSync(join(overlays, '16.17', 'match-detail.json'), 'utf8')),
      );
      const overlay = FixtureEnvelopeSchema.parse(
        JSON.parse(readFileSync(join(overlays, '16.17', 'match-detail--100.json'), 'utf8')),
      );
      expect(pinned.body).toMatchObject({ gameId: 200 });
      expect(overlay).toMatchObject({ id: 'match-detail--100', path: '/lol-match-history/v1/games/100' });
      expect(overlay.body).toMatchObject({ gameId: 100 });
    } finally {
      rmSync(overlays, { recursive: true, force: true });
    }
  });

  it('--diff reports no changes right after a capture, and a change when the shape moves', async () => {
    const same = await runSmoke(['--lockfile', lockfile, '--out', out, '--diff']);
    expect(same.code).toBe(0);
    expect(same.stdout).toContain('no shape changes');

    // Simulate a patch that added a key to the lobby 404 body.
    const lobbyPath = join(out, '16.17', 'lobby.json');
    const lobby = JSON.parse(readFileSync(lobbyPath, 'utf8')) as { body: Record<string, unknown> };
    lobby.body = { errorCode: 'RPC_ERROR' };
    writeFileSync(lobbyPath, JSON.stringify(lobby));

    const changed = await runSmoke(['--lockfile', lockfile, '--out', out, '--diff']);
    expect(changed.code).toBe(1);
    expect(changed.stdout).toMatch(/lobby .*\+httpStatus \(vs 16\.17\)/);
    expect(changed.stdout).toContain('1 endpoint(s) differ');
  });

  it('--diff reports a status change and a missing fixture as changes', async () => {
    const lobbyPath = join(out, '16.17', 'lobby.json');
    const lobby = JSON.parse(readFileSync(lobbyPath, 'utf8')) as { status: number; body: unknown };
    lobby.status = 200;
    lobby.body = { errorCode: 'RPC_ERROR', httpStatus: 404 };
    writeFileSync(lobbyPath, JSON.stringify(lobby));
    rmSync(join(out, '16.17', 'gameflow-phase.json'));

    const result = await runSmoke(['--lockfile', lockfile, '--out', out, '--diff']);
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/lobby .*status 200 -> 404 \(vs 16\.17\)/);
    expect(result.stdout).toMatch(/gameflow-phase .*no saved fixture/);
    expect(result.stdout).toContain('2 endpoint(s) differ');
  });
});

describe('smoke --diff against a hyphenated patch directory', () => {
  let fake: FakeLcu;
  let dir: string;
  let lockfile: string;
  let out: string;

  beforeAll(async () => {
    // A lobby that answers 200 while "idle" produces the "unexpected status (idle: 404)" note, and the
    // hyphenated directory name puts a "-" in the "same as ..." note. Neither may count as a change.
    fake = await startFakeLcu({
      routes: { ...routes, 'GET /lol-lobby/v2/lobby': { status: 200, body: { partyId: 'p1', members: [] } } },
    });
    dir = mkdtempSync(join(tmpdir(), 'lcu-smoke-hyphen-'));
    lockfile = join(dir, 'lockfile');
    out = join(dir, 'fixtures');
    writeLockfile(lockfile, fake);
  });

  afterAll(async () => {
    await fake.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not mistake notes containing "-" for differences', async () => {
    const capture = await runSmoke(['--lockfile', lockfile, '--out', out]);
    expect(capture.code).toBe(0);
    renameSync(join(out, '16.17'), join(out, 'unknown-2026-09-08'));

    const result = await runSmoke(['--lockfile', lockfile, '--out', out, '--diff']);
    expect(result.stdout).toMatch(/lobby .*unexpected status \(idle: 404\); same as unknown-2026-09-08/);
    expect(result.stdout).toContain('no shape changes');
    expect(result.code).toBe(0);
  });
});
