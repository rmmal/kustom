import { describe, expect, it } from 'vitest';
import {
  lockfilePathFromExecutable,
  parsePowerShellProcessList,
  parseUxCommandLine,
  parseWmicProcessList,
  powerShellArgs,
  resolveProcessLister,
  WMIC_ARGS,
  windowsProcessLister,
} from './processDiscovery.js';

const EXE = 'D:\\Games\\Riot Games\\League of Legends\\LeagueClientUx.exe';
// The shape the client's own Ux log shows (docs/03 "Process args fallback"): every argument quoted on its own.
const COMMAND_LINE =
  `"${EXE}" "--riotclient-auth-token=rcTOKEN" "--riotclient-app-port=55555" "--app-port=53107" ` +
  '"--remoting-auth-token=abc_DEF-123" "--app-pid=4242" "--locale=en_GB" "--release=16.17.812.4632"';

describe('parseUxCommandLine', () => {
  it('reads the port, the password and the LeagueClient pid off a quoted command line', () => {
    expect(parseUxCommandLine(COMMAND_LINE)).toEqual({ port: 53107, password: 'abc_DEF-123', appPid: 4242 });
  });

  it('reads them off an unquoted command line too', () => {
    const line = `${EXE} --app-port=1234 --remoting-auth-token=pw --app-pid=9`;
    expect(parseUxCommandLine(line)).toEqual({ port: 1234, password: 'pw', appPid: 9 });
  });

  it('does not confuse --riotclient-app-port with --app-port', () => {
    const line = `"${EXE}" "--riotclient-app-port=1" "--remoting-auth-token=pw"`;
    expect(parseUxCommandLine(line)).toBeNull();
  });

  it('is null without both values, and null on a port that is not a port', () => {
    expect(parseUxCommandLine(`"${EXE}" "--app-port=1234"`)).toBeNull();
    expect(parseUxCommandLine(`"${EXE}" "--remoting-auth-token=pw"`)).toBeNull();
    expect(parseUxCommandLine(`"${EXE}" "--app-port=99999" "--remoting-auth-token=pw"`)).toBeNull();
    expect(parseUxCommandLine('')).toBeNull();
  });

  it('leaves appPid null when --app-pid is missing', () => {
    expect(parseUxCommandLine(`"${EXE}" "--app-port=1234" "--remoting-auth-token=pw"`)).toEqual({
      port: 1234,
      password: 'pw',
      appPid: null,
    });
  });
});

describe('lockfilePathFromExecutable', () => {
  it('replaces the executable with the lockfile in the same directory', () => {
    expect(lockfilePathFromExecutable(EXE)).toBe('D:\\Games\\Riot Games\\League of Legends\\lockfile');
    expect(lockfilePathFromExecutable(`"${EXE}"`)).toBe('D:\\Games\\Riot Games\\League of Legends\\lockfile');
  });

  it('is null for an empty or directory-less path', () => {
    expect(lockfilePathFromExecutable('')).toBeNull();
    expect(lockfilePathFromExecutable('LeagueClientUx.exe')).toBeNull();
  });
});

describe('parsePowerShellProcessList', () => {
  it('treats empty output as "not running"', () => {
    expect(parsePowerShellProcessList('')).toEqual({ ok: true, processes: [] });
    expect(parsePowerShellProcessList('\r\n')).toEqual({ ok: true, processes: [] });
  });

  it('reads the single object ConvertTo-Json prints for one process', () => {
    const json = JSON.stringify({ ProcessId: 100, ExecutablePath: EXE, CommandLine: COMMAND_LINE });
    expect(parsePowerShellProcessList(`\uFEFF${json}\r\n`)).toEqual({
      ok: true,
      processes: [{ pid: 100, executablePath: EXE, commandLine: COMMAND_LINE }],
    });
  });

  it('reads the array for several processes and nulls the fields a protected process hides', () => {
    const json = JSON.stringify([
      { ProcessId: 100, ExecutablePath: EXE, CommandLine: COMMAND_LINE },
      { ProcessId: 101, ExecutablePath: null, CommandLine: null },
    ]);
    const result = parsePowerShellProcessList(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.processes).toHaveLength(2);
      expect(result.processes[1]).toEqual({ pid: 101, executablePath: null, commandLine: null });
    }
  });

  it('reports rather than throws on output that is not JSON or the wrong shape', () => {
    expect(parsePowerShellProcessList('Get-CimInstance : not recognized').ok).toBe(false);
    expect(parsePowerShellProcessList('"just a string"').ok).toBe(false);
  });
});

describe('parseWmicProcessList', () => {
  it('reads /format:list blocks', () => {
    const out = `\r\n\r\nCommandLine=${COMMAND_LINE}\r\nExecutablePath=${EXE}\r\nProcessId=100\r\n\r\n\r\n`;
    expect(parseWmicProcessList(out)).toEqual({
      ok: true,
      processes: [{ pid: 100, executablePath: EXE, commandLine: COMMAND_LINE }],
    });
  });

  it('treats "No Instances Available." and empty output as "not running"', () => {
    expect(parseWmicProcessList('No Instances Available.\r\n')).toEqual({ ok: true, processes: [] });
    expect(parseWmicProcessList('')).toEqual({ ok: true, processes: [] });
  });
});

describe('windowsProcessLister', () => {
  it('sends the script as an encoded command and parses what PowerShell prints', async () => {
    const calls: { file: string; args: readonly string[] }[] = [];
    const lister = windowsProcessLister({
      run: async (file, args) => {
        calls.push({ file, args });
        return JSON.stringify({ ProcessId: 7, ExecutablePath: EXE, CommandLine: COMMAND_LINE });
      },
    });
    const result = await lister();
    expect(result).toEqual({
      ok: true,
      processes: [{ pid: 7, executablePath: EXE, commandLine: COMMAND_LINE }],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.file).toBe('powershell.exe');
    expect(calls[0]?.args).toEqual(powerShellArgs());
    const encoded = calls[0]?.args.at(-1) ?? '';
    const script = Buffer.from(encoded, 'base64').toString('utf16le');
    expect(script).toContain("Name='LeagueClientUx.exe'");
    expect(script).toContain('ConvertTo-Json');
  });

  it('falls back to wmic when PowerShell cannot be started, and never throws when both fail', async () => {
    const files: string[] = [];
    const viaWmic = windowsProcessLister({
      run: async (file) => {
        files.push(file);
        if (file === 'powershell.exe') {
          throw Object.assign(new Error('spawn powershell.exe ENOENT'), { code: 'ENOENT' });
        }
        return `CommandLine=${COMMAND_LINE}\r\nExecutablePath=${EXE}\r\nProcessId=8\r\n`;
      },
    });
    expect(await viaWmic()).toEqual({
      ok: true,
      processes: [{ pid: 8, executablePath: EXE, commandLine: COMMAND_LINE }],
    });
    expect(files).toEqual(['powershell.exe', 'wmic.exe']);

    const neither = windowsProcessLister({
      run: async (file, args) => {
        expect(file === 'powershell.exe' ? powerShellArgs() : WMIC_ARGS).toEqual(args);
        throw Object.assign(new Error('killed'), { killed: true, signal: 'SIGTERM' });
      },
    });
    const result = await neither();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('powershell: timed out; wmic: timed out');
      // The error never quotes output, so it never can carry a command line.
      expect(result.error).not.toContain('remoting-auth-token');
    }
  });
});

describe('resolveProcessLister', () => {
  it('only exists when both the requested and the real platform are Windows', () => {
    expect(resolveProcessLister('win32', 'win32')).not.toBeNull();
    expect(resolveProcessLister('win32', 'darwin')).toBeNull();
    expect(resolveProcessLister('darwin', 'win32')).toBeNull();
    expect(resolveProcessLister('darwin', 'darwin')).toBeNull();
  });
});
