import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  defaultLockfileCandidates,
  discoverLockfile,
  LOCKFILE_CANDIDATES_ENV,
  lockfileCandidatesFromEnv,
  MACOS_LOCKFILE_PATH,
  parseLockfile,
  WINDOWS_LOCKFILE_PATH,
} from './lockfile.js';

const VALID = 'LeagueClient:12345:54321:sEcReT-pass_word:https';

/** A filesystem with nothing in it. Tests must never read the real default path: League may be running. */
const enoent = (): Promise<string> => Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' }));

describe('parseLockfile', () => {
  it('parses the documented format', () => {
    const result = parseLockfile(VALID);
    expect(result).toEqual({
      ok: true,
      credentials: {
        name: 'LeagueClient',
        pid: 12345,
        port: 54321,
        password: 'sEcReT-pass_word',
        protocol: 'https',
      },
    });
  });

  it('tolerates a trailing newline and surrounding whitespace', () => {
    const result = parseLockfile(`  ${VALID}\r\n`);
    expect(result.ok).toBe(true);
  });

  it('rejects an empty file', () => {
    expect(parseLockfile('')).toEqual({ ok: false, reason: 'empty file' });
    expect(parseLockfile('\n')).toEqual({ ok: false, reason: 'empty file' });
  });

  it('rejects the wrong number of fields', () => {
    const result = parseLockfile('LeagueClient:123:456:https');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('expected 5');
    }
  });

  it('rejects a non-numeric port and pid', () => {
    const port = parseLockfile('LeagueClient:123:abc:pw:https');
    expect(port.ok).toBe(false);
    if (!port.ok) {
      expect(port.reason).toContain('port');
    }
    const pid = parseLockfile('LeagueClient:x:456:pw:https');
    expect(pid.ok).toBe(false);
    if (!pid.ok) {
      expect(pid.reason).toContain('pid');
    }
  });

  it('rejects an out-of-range port', () => {
    expect(parseLockfile('LeagueClient:1:70000:pw:https').ok).toBe(false);
    expect(parseLockfile('LeagueClient:1:0:pw:https').ok).toBe(false);
  });

  it('rejects a protocol other than https', () => {
    const result = parseLockfile('LeagueClient:1:2:pw:http');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('protocol');
    }
  });

  it('rejects an empty password', () => {
    expect(parseLockfile('LeagueClient:1:2::https').ok).toBe(false);
  });
});

describe('defaultLockfileCandidates', () => {
  it('uses the Riot Games install dir on Windows', () => {
    expect(defaultLockfileCandidates('win32')).toEqual([WINDOWS_LOCKFILE_PATH]);
    expect(WINDOWS_LOCKFILE_PATH).toBe('C:\\Riot Games\\League of Legends\\lockfile');
  });

  it('uses the app bundle on macOS', () => {
    expect(defaultLockfileCandidates('darwin')).toEqual([MACOS_LOCKFILE_PATH]);
    expect(MACOS_LOCKFILE_PATH).toBe('/Applications/League of Legends.app/Contents/LoL/lockfile');
  });

  it('has no defaults elsewhere', () => {
    expect(defaultLockfileCandidates('linux')).toEqual([]);
  });
});

describe('lockfileCandidatesFromEnv', () => {
  it('is null when the variable is unset, so the platform defaults apply', () => {
    expect(lockfileCandidatesFromEnv({})).toBeNull();
  });

  it('splits on the path delimiter and drops blanks', () => {
    expect(lockfileCandidatesFromEnv({ [LOCKFILE_CANDIDATES_ENV]: ' /a : :/b ' }, ':')).toEqual(['/a', '/b']);
    expect(lockfileCandidatesFromEnv({ [LOCKFILE_CANDIDATES_ENV]: 'C:\\x\\lockfile;D:\\y' }, ';')).toEqual([
      'C:\\x\\lockfile',
      'D:\\y',
    ]);
  });

  it('treats an empty value as "no defaults"', () => {
    expect(lockfileCandidatesFromEnv({ [LOCKFILE_CANDIDATES_ENV]: '' })).toEqual([]);
  });
});

describe('discoverLockfile', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lcu-lockfile-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns not_found with every path tried when nothing exists', async () => {
    const missing = join(dir, 'nope');
    const result = await discoverLockfile({
      overridePath: missing,
      platform: 'darwin',
      env: {},
      readFile: enoent,
    });
    expect(result.status).toBe('not_found');
    if (result.status === 'not_found') {
      expect(result.tried.map((attempt) => attempt.path)).toEqual([missing, MACOS_LOCKFILE_PATH]);
      expect(result.tried[0]?.reason).toBe('missing');
    }
  });

  it('tries the Windows default after the override on win32', async () => {
    const result = await discoverLockfile({
      overridePath: '/override',
      platform: 'win32',
      env: {},
      readFile: enoent,
      listProcesses: null,
    });
    expect(result.status).toBe('not_found');
    if (result.status === 'not_found') {
      expect(result.tried.map((attempt) => attempt.path)).toEqual(['/override', WINDOWS_LOCKFILE_PATH]);
    }
  });

  it('replaces the platform defaults with LCU_LOCKFILE_CANDIDATES when set', async () => {
    const a = join(dir, 'a');
    const b = join(dir, 'b');
    await writeFile(b, VALID);
    const env = { [LOCKFILE_CANDIDATES_ENV]: [a, b].join(delimiter) };
    const result = await discoverLockfile({ platform: 'darwin', env });
    expect(result.status).toBe('found');
    if (result.status === 'found') {
      expect(result.path).toBe(b);
    }

    const none = await discoverLockfile({ platform: 'darwin', env, readFile: enoent });
    expect(none.status).toBe('not_found');
    if (none.status === 'not_found') {
      expect(none.tried.map((attempt) => attempt.path)).toEqual([a, b]);
    }
  });

  it('lets an explicit candidates list win over the environment', async () => {
    const env = { [LOCKFILE_CANDIDATES_ENV]: '/from-env' };
    const result = await discoverLockfile({ candidates: ['/explicit'], env, readFile: enoent });
    expect(result).toEqual({ status: 'not_found', tried: [{ path: '/explicit', reason: 'missing' }] });
  });

  it('still tries the override before the environment candidates', async () => {
    const env = { [LOCKFILE_CANDIDATES_ENV]: '/from-env' };
    const result = await discoverLockfile({ overridePath: '/override', env, readFile: enoent });
    expect(result.status).toBe('not_found');
    if (result.status === 'not_found') {
      expect(result.tried.map((attempt) => attempt.path)).toEqual(['/override', '/from-env']);
    }
  });

  it('finds and parses the override path first', async () => {
    const path = join(dir, 'lockfile');
    await writeFile(path, `${VALID}\n`);
    const result = await discoverLockfile({ overridePath: path, candidates: [join(dir, 'unused')] });
    expect(result).toEqual({
      status: 'found',
      path,
      source: 'path',
      credentials: {
        name: 'LeagueClient',
        pid: 12345,
        port: 54321,
        password: 'sEcReT-pass_word',
        protocol: 'https',
      },
    });
  });

  it('falls through to the platform candidates', async () => {
    const path = join(dir, 'lockfile');
    await writeFile(path, VALID);
    const result = await discoverLockfile({ candidates: [join(dir, 'missing'), path] });
    expect(result.status).toBe('found');
    if (result.status === 'found') {
      expect(result.path).toBe(path);
    }
  });

  it('reports a malformed file and keeps looking', async () => {
    const bad = join(dir, 'bad');
    const good = join(dir, 'good');
    await writeFile(bad, 'garbage');
    await writeFile(good, VALID);
    const result = await discoverLockfile({ overridePath: bad, candidates: [good] });
    expect(result.status).toBe('found');
    if (result.status === 'found') {
      expect(result.path).toBe(good);
    }

    const onlyBad = await discoverLockfile({ candidates: [bad] });
    expect(onlyBad.status).toBe('not_found');
    if (onlyBad.status === 'not_found') {
      expect(onlyBad.tried[0]?.reason).toMatch(/^malformed: /);
    }
  });

  it('never throws on unexpected fs errors', async () => {
    const result = await discoverLockfile({
      candidates: ['/x'],
      readFile: () => Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' })),
    });
    expect(result).toEqual({ status: 'not_found', tried: [{ path: '/x', reason: 'EACCES' }] });
  });

  it('honours an empty override as unset', async () => {
    const result = await discoverLockfile({ overridePath: undefined, candidates: [] });
    expect(result).toEqual({ status: 'not_found', tried: [] });
  });
});
