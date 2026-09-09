/**
 * Finding a League client that is not at the default install path, from the process list (M2.19).
 *
 * Two sources, both from the running `LeagueClientUx.exe` (docs/03-lcu-reference.md "Process args fallback"):
 *  1. its `ExecutablePath`: the install directory, so `<dir>\lockfile` can be read like any other candidate;
 *  2. its `CommandLine`: `--app-port=<port>` and `--remoting-auth-token=<password>` (and `--app-pid=<pid>`,
 *     the LeagueClient pid the lockfile would carry), for when the file cannot be read.
 *
 * The shell-out lives here and only runs on `win32`: PowerShell `Get-CimInstance Win32_Process` first (the
 * script goes in as `-EncodedCommand`, so no quoting rules apply), `wmic` when PowerShell is not there.
 * Nothing in this file throws to a caller: a lister answers `{ error }` and discovery goes on polling.
 * The command line carries the client password and is never logged, in full or in part.
 *
 * Observed on Windows: pending (the first run on the custom-install PC confirms it; docs/03 row).
 */

import { execFile } from 'node:child_process';
import { win32 } from 'node:path';
import { z } from 'zod';

/** The process the client's UI runs in. Its command line carries the connection details. */
export const LEAGUE_UX_PROCESS_NAME = 'LeagueClientUx.exe';

/** The lockfile's name inside the install directory. */
export const LOCKFILE_NAME = 'lockfile';

/** One running client process, as much of it as the process list would say. */
export interface LeagueProcess {
  readonly pid: number | null;
  readonly executablePath: string | null;
  /** Never logged: it carries `--remoting-auth-token`. */
  readonly commandLine: string | null;
}

export type ProcessListResult =
  | { readonly ok: true; readonly processes: readonly LeagueProcess[] }
  /** The process list could not be read (no PowerShell, timeout, access denied). A reason, never a throw. */
  | { readonly ok: false; readonly error: string };

/** Lists the running `LeagueClientUx.exe` processes. Injected in tests; never shells out there. */
export type ProcessLister = () => Promise<ProcessListResult>;

/** What the client's command line says about how to reach it. */
export interface CommandLineCredentials {
  readonly port: number;
  readonly password: string;
  /** `--app-pid=`: the LeagueClient pid (the one the lockfile names), when present. */
  readonly appPid: number | null;
}

const ARG_VALUE = String.raw`(?:"([^"]*)"|([^\s"]+))`;

function argValue(commandLine: string, name: string): string | null {
  // `--name=value` or `"--name=value"`; the client quotes each argument individually.
  const pattern = new RegExp(String.raw`(?:^|\s)"?--${name}=${ARG_VALUE}`);
  const match = pattern.exec(commandLine);
  if (!match) {
    return null;
  }
  const value = match[1] ?? match[2] ?? '';
  return value.replace(/"$/, '');
}

/**
 * Pulls `--app-port` and `--remoting-auth-token` out of a `LeagueClientUx.exe` command line.
 * Null when either is missing or the port is not a port.
 */
export function parseUxCommandLine(commandLine: string): CommandLineCredentials | null {
  const portText = argValue(commandLine, 'app-port');
  const password = argValue(commandLine, 'remoting-auth-token');
  if (portText === null || password === null || password.length === 0) {
    return null;
  }
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }
  const pidText = argValue(commandLine, 'app-pid');
  const appPid = pidText === null ? Number.NaN : Number(pidText);
  return {
    port,
    password,
    appPid: Number.isInteger(appPid) && appPid > 0 ? appPid : null,
  };
}

/** `C:\Games\Riot\League of Legends\LeagueClientUx.exe` -> `C:\Games\Riot\League of Legends\lockfile`. */
export function lockfilePathFromExecutable(executablePath: string): string | null {
  const trimmed = executablePath.trim().replace(/^"|"$/g, '');
  if (trimmed.length === 0) {
    return null;
  }
  const dir = win32.dirname(trimmed);
  if (dir === trimmed || dir === '.' || dir.length === 0) {
    return null;
  }
  return win32.join(dir, LOCKFILE_NAME);
}

// PowerShell: `ConvertTo-Json` gives one object for one process and an array for several; nothing for none.
const PowerShellProcessSchema = z.object({
  ProcessId: z.number().int().nullable().optional(),
  ExecutablePath: z.string().nullable().optional(),
  CommandLine: z.string().nullable().optional(),
});

const PowerShellOutputSchema = z.union([PowerShellProcessSchema, z.array(PowerShellProcessSchema)]);

/** Parses the JSON `Get-CimInstance ... | ConvertTo-Json -Compress` prints. Empty output is "not running". */
export function parsePowerShellProcessList(stdout: string): ProcessListResult {
  const text = stdout.replace(/^\uFEFF/, '').trim();
  if (text.length === 0) {
    return { ok: true, processes: [] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'PowerShell output was not JSON' };
  }
  const parsed = PowerShellOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: 'PowerShell output had an unexpected shape' };
  }
  const rows = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
  return {
    ok: true,
    processes: rows.map((row) => ({
      pid: typeof row.ProcessId === 'number' && row.ProcessId > 0 ? row.ProcessId : null,
      executablePath: row.ExecutablePath ?? null,
      commandLine: row.CommandLine ?? null,
    })),
  };
}

/**
 * Parses `wmic process where name='LeagueClientUx.exe' get CommandLine,ExecutablePath,ProcessId /format:list`:
 * blank-line separated `Key=Value` blocks. `No Instances Available.` (on stderr, but tolerated here) is
 * "not running".
 */
export function parseWmicProcessList(stdout: string): ProcessListResult {
  const text = stdout.replace(/\r/g, '').trim();
  if (text.length === 0 || /No Instances Available/i.test(text)) {
    return { ok: true, processes: [] };
  }
  const processes: LeagueProcess[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    const fields = new Map<string, string>();
    for (const line of block.split('\n')) {
      const eq = line.indexOf('=');
      if (eq > 0) {
        fields.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
      }
    }
    if (fields.size === 0) {
      continue;
    }
    const pid = Number(fields.get('ProcessId') ?? '');
    const executablePath = fields.get('ExecutablePath') ?? '';
    const commandLine = fields.get('CommandLine') ?? '';
    processes.push({
      pid: Number.isInteger(pid) && pid > 0 ? pid : null,
      executablePath: executablePath.length > 0 ? executablePath : null,
      commandLine: commandLine.length > 0 ? commandLine : null,
    });
  }
  return { ok: true, processes };
}

const POWERSHELL_SCRIPT = [
  `Get-CimInstance Win32_Process -Filter "Name='${LEAGUE_UX_PROCESS_NAME}'"`,
  'Select-Object ProcessId,ExecutablePath,CommandLine',
  'ConvertTo-Json -Compress',
].join(' | ');

/** The PowerShell invocation, as `execFile` arguments. Exported for the test that checks the encoding. */
export function powerShellArgs(script: string = POWERSHELL_SCRIPT): readonly string[] {
  return [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64'),
  ];
}

export const WMIC_ARGS: readonly string[] = [
  'process',
  'where',
  `name='${LEAGUE_UX_PROCESS_NAME}'`,
  'get',
  'CommandLine,ExecutablePath,ProcessId',
  '/format:list',
];

export interface WindowsProcessListerOptions {
  /** Per command. Default 15 s: a cold PowerShell on a busy PC takes a few seconds. */
  readonly timeoutMs?: number;
  /** Injected in tests. Resolves stdout; rejects like `execFile` does (an `Error` with `code`). */
  readonly run?: (file: string, args: readonly string[], timeoutMs: number) => Promise<string>;
}

function runCommand(file: string, args: readonly string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function describeFailure(error: unknown): string {
  if (error && typeof error === 'object') {
    const record = error as { code?: unknown; killed?: unknown; signal?: unknown };
    if (record.killed === true || record.signal === 'SIGTERM') {
      return 'timed out';
    }
    if (typeof record.code === 'string') {
      return record.code;
    }
    if (typeof record.code === 'number') {
      return `exit ${record.code}`;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * The Windows process lister: PowerShell, then `wmic` when PowerShell cannot be started. Only ever called
 * on `win32` (`resolveProcessLister`); never throws. The output is parsed, never logged.
 */
export function windowsProcessLister(options: WindowsProcessListerOptions = {}): ProcessLister {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const run = options.run ?? runCommand;
  return async () => {
    let powerShellFailure: string;
    try {
      const stdout = await run('powershell.exe', powerShellArgs(), timeoutMs);
      return parsePowerShellProcessList(stdout);
    } catch (error) {
      powerShellFailure = describeFailure(error);
    }
    try {
      const stdout = await run('wmic.exe', WMIC_ARGS, timeoutMs);
      return parseWmicProcessList(stdout);
    } catch (error) {
      return { ok: false, error: `powershell: ${powerShellFailure}; wmic: ${describeFailure(error)}` };
    }
  };
}

/**
 * The lister discovery uses when none is injected: the Windows one on a real Windows host, nothing elsewhere.
 * Both the injected platform (what discovery is pretending to be) and the real one must be `win32`, so a test
 * that says `platform: 'win32'` on a Mac never shells out.
 */
export function resolveProcessLister(
  platform: NodeJS.Platform,
  hostPlatform: NodeJS.Platform = process.platform,
): ProcessLister | null {
  if (platform === 'win32' && hostPlatform === 'win32') {
    return windowsProcessLister();
  }
  return null;
}
