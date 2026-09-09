/**
 * The process-list fallback and the stateful discovery (M2.19). Every process list here is a fake; nothing
 * in this file shells out, and every path is read through an injected `readFile`.
 */

import { describe, expect, it } from 'vitest';
import {
  createLockfileDiscovery,
  discoverLockfile,
  PROCESS_ARGS_PATH,
  PROCESS_LIST_PATH,
  WINDOWS_LOCKFILE_PATH,
} from './lockfile.js';
import type { LogFields, Logger } from './log.js';
import type { LeagueProcess, ProcessLister, ProcessListResult } from './processDiscovery.js';

const INSTALL = 'D:\\Games\\Riot Games\\League of Legends';
const EXE = `${INSTALL}\\LeagueClientUx.exe`;
const CUSTOM_LOCKFILE = `${INSTALL}\\lockfile`;
const PASSWORD = 'sEcReT-pass_word';
const VALID = `LeagueClient:12345:54321:${PASSWORD}:https`;
const COMMAND_LINE = `"${EXE}" "--app-port=54321" "--remoting-auth-token=${PASSWORD}" "--app-pid=12345"`;

const running: LeagueProcess = { pid: 777, executablePath: EXE, commandLine: COMMAND_LINE };

function lister(result: ProcessListResult): ProcessLister & { calls: number } {
  const fn = (async () => {
    fn.calls += 1;
    return result;
  }) as ProcessLister & { calls: number };
  fn.calls = 0;
  return fn;
}

/** A filesystem holding only the given files; every other path is ENOENT. */
function fs(files: Record<string, string>): (path: string) => Promise<string> {
  return (path) =>
    path in files
      ? Promise.resolve(files[path] ?? '')
      : Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' }));
}

function recordingLogger(): Logger & { lines: { level: string; message: string; fields?: LogFields }[] } {
  const lines: { level: string; message: string; fields?: LogFields }[] = [];
  const log = (level: string) => (message: string, fields?: LogFields) => {
    lines.push(fields ? { level, message, fields } : { level, message });
  };
  return { lines, debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') };
}

describe('discoverLockfile: process-list fallback', () => {
  it('reads the lockfile beside the running client when the default path is missing', async () => {
    const list = lister({ ok: true, processes: [running] });
    const result = await discoverLockfile({
      platform: 'win32',
      env: {},
      readFile: fs({ [CUSTOM_LOCKFILE]: VALID }),
      listProcesses: list,
    });
    expect(result).toEqual({
      status: 'found',
      path: CUSTOM_LOCKFILE,
      source: 'process_path',
      credentials: { name: 'LeagueClient', pid: 12345, port: 54321, password: PASSWORD, protocol: 'https' },
    });
    expect(list.calls).toBe(1);
  });

  it('does not ask the process list when a path already answers', async () => {
    const list = lister({ ok: true, processes: [running] });
    const result = await discoverLockfile({
      platform: 'win32',
      env: {},
      readFile: fs({ [WINDOWS_LOCKFILE_PATH]: VALID }),
      listProcesses: list,
    });
    expect(result.status).toBe('found');
    expect(list.calls).toBe(0);
  });

  it('falls back to the command line when the lockfile beside the executable cannot be read', async () => {
    const logger = recordingLogger();
    const result = await discoverLockfile({
      platform: 'win32',
      env: {},
      readFile: fs({}),
      listProcesses: lister({ ok: true, processes: [running] }),
      logger,
    });
    expect(result).toEqual({
      status: 'found',
      path: PROCESS_ARGS_PATH,
      source: 'process_args',
      credentials: { name: 'LeagueClient', pid: 12345, port: 54321, password: PASSWORD, protocol: 'https' },
    });
    // The password is in the command line and must reach neither a log line nor a field.
    expect(JSON.stringify(logger.lines)).not.toContain(PASSWORD);
    expect(JSON.stringify(logger.lines)).not.toContain('remoting-auth-token');
  });

  it('uses the Ux pid when the command line names no --app-pid', async () => {
    const proc: LeagueProcess = {
      pid: 777,
      executablePath: null,
      commandLine: `"${EXE}" "--app-port=1" "--remoting-auth-token=${PASSWORD}"`,
    };
    const result = await discoverLockfile({
      platform: 'win32',
      env: {},
      readFile: fs({}),
      listProcesses: lister({ ok: true, processes: [proc] }),
    });
    expect(result.status).toBe('found');
    if (result.status === 'found') {
      expect(result.credentials.pid).toBe(777);
      expect(result.credentials.port).toBe(1);
    }
  });

  it('reports "not running" and never quotes a command line in what it tried', async () => {
    const idle = await discoverLockfile({
      platform: 'win32',
      env: {},
      readFile: fs({}),
      listProcesses: lister({ ok: true, processes: [] }),
    });
    expect(idle).toEqual({
      status: 'not_found',
      tried: [
        { path: WINDOWS_LOCKFILE_PATH, reason: 'missing' },
        { path: PROCESS_LIST_PATH, reason: 'not running' },
      ],
    });

    const bare: LeagueProcess = { pid: 9, executablePath: null, commandLine: `"${EXE}" "--locale=en_GB"` };
    const useless = await discoverLockfile({
      platform: 'win32',
      env: {},
      readFile: fs({}),
      listProcesses: lister({ ok: true, processes: [bare] }),
    });
    expect(useless.status).toBe('not_found');
    if (useless.status === 'not_found') {
      expect(useless.tried.map((attempt) => attempt.path)).toEqual([
        WINDOWS_LOCKFILE_PATH,
        PROCESS_LIST_PATH,
        PROCESS_ARGS_PATH,
      ]);
      expect(JSON.stringify(useless.tried)).not.toContain('locale');
    }
  });

  it('never throws when the lister fails or rejects', async () => {
    const logger = recordingLogger();
    const failed = await discoverLockfile({
      platform: 'win32',
      env: {},
      readFile: fs({}),
      listProcesses: lister({ ok: false, error: 'powershell: ENOENT; wmic: ENOENT' }),
      logger,
    });
    expect(failed).toEqual({
      status: 'not_found',
      tried: [
        { path: WINDOWS_LOCKFILE_PATH, reason: 'missing' },
        { path: PROCESS_LIST_PATH, reason: 'unavailable: powershell: ENOENT; wmic: ENOENT' },
      ],
    });
    expect(logger.lines.some((line) => line.level === 'warn' && line.message.includes('process list'))).toBe(
      true,
    );

    const rejected = await discoverLockfile({
      platform: 'win32',
      env: {},
      readFile: fs({}),
      listProcesses: () => Promise.reject(new Error('boom')),
    });
    expect(rejected.status).toBe('not_found');
    if (rejected.status === 'not_found') {
      expect(rejected.tried[1]).toEqual({ path: PROCESS_LIST_PATH, reason: 'unavailable: boom' });
    }
  });

  it('skips the process list when explicit candidates or the environment replaced the defaults', async () => {
    const list = lister({ ok: true, processes: [] });
    const explicit = await discoverLockfile({ candidates: ['/x'], readFile: fs({}), listProcesses: list });
    expect(explicit).toEqual({
      status: 'not_found',
      tried: [
        { path: '/x', reason: 'missing' },
        { path: PROCESS_LIST_PATH, reason: 'not running' },
      ],
    });
    // An injected lister is honoured even then; the platform default one is what is withheld.
    expect(list.calls).toBe(1);

    const viaEnv = await discoverLockfile({
      platform: 'win32',
      env: { LCU_LOCKFILE_CANDIDATES: '/from-env' },
      readFile: fs({}),
    });
    expect(viaEnv).toEqual({ status: 'not_found', tried: [{ path: '/from-env', reason: 'missing' }] });
  });

  it('is off on a non-Windows platform unless a lister is injected', async () => {
    const result = await discoverLockfile({ platform: 'darwin', env: {}, readFile: fs({}) });
    expect(result.status).toBe('not_found');
    if (result.status === 'not_found') {
      expect(result.tried).toHaveLength(1);
    }
  });
});

describe('createLockfileDiscovery', () => {
  it('remembers the lockfile it found through the process list and reads it directly afterwards', async () => {
    const list = lister({ ok: true, processes: [running] });
    const discover = createLockfileDiscovery({
      platform: 'win32',
      env: {},
      readFile: fs({ [CUSTOM_LOCKFILE]: VALID }),
      listProcesses: list,
      processListMinIntervalMs: 0,
    });
    const first = await discover();
    expect(first.status).toBe('found');
    if (first.status === 'found') {
      expect(first.source).toBe('process_path');
    }
    expect(list.calls).toBe(1);

    const second = await discover();
    expect(second.status).toBe('found');
    if (second.status === 'found') {
      expect(second.source).toBe('path');
      expect(second.path).toBe(CUSTOM_LOCKFILE);
    }
    expect(list.calls).toBe(1);
  });

  it('notices the client leaving through the remembered path, then asks the process list again', async () => {
    const files: Record<string, string> = { [CUSTOM_LOCKFILE]: VALID };
    let processes: LeagueProcess[] = [running];
    const list: ProcessLister = async () => ({ ok: true, processes });
    const discover = createLockfileDiscovery({
      platform: 'win32',
      env: {},
      readFile: (path) => fs(files)(path),
      listProcesses: list,
      processListMinIntervalMs: 0,
    });
    expect((await discover()).status).toBe('found');

    delete files[CUSTOM_LOCKFILE];
    processes = [];
    const gone = await discover();
    expect(gone.status).toBe('not_found');
    if (gone.status === 'not_found') {
      expect(gone.tried.map((attempt) => attempt.path)).toEqual([
        CUSTOM_LOCKFILE,
        WINDOWS_LOCKFILE_PATH,
        PROCESS_LIST_PATH,
      ]);
    }

    files[CUSTOM_LOCKFILE] = VALID;
    processes = [running];
    expect((await discover()).status).toBe('found');
  });

  it('asks the process list at most once per interval and reuses the last answer in between', async () => {
    let clock = 0;
    const list = lister({ ok: true, processes: [] });
    const discover = createLockfileDiscovery({
      platform: 'win32',
      env: {},
      readFile: fs({}),
      listProcesses: list,
      processListMinIntervalMs: 15_000,
      now: () => clock,
    });
    await discover();
    clock = 5_000;
    await discover();
    clock = 10_000;
    await discover();
    expect(list.calls).toBe(1);
    clock = 15_000;
    await discover();
    expect(list.calls).toBe(2);
  });

  it('keeps going when the lister rejects', async () => {
    const discover = createLockfileDiscovery({
      platform: 'win32',
      env: {},
      readFile: fs({}),
      listProcesses: () => Promise.reject(new Error('boom')),
      processListMinIntervalMs: 0,
    });
    const result = await discover();
    expect(result.status).toBe('not_found');
    if (result.status === 'not_found') {
      expect(result.tried.at(-1)).toEqual({ path: PROCESS_LIST_PATH, reason: 'unavailable: boom' });
    }
  });
});
