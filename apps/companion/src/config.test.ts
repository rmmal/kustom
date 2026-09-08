import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CONFIG_DIR_ENV,
  configDir,
  configPath,
  DEFAULT_API_BASE,
  loadConfig,
  logsDir,
  type PromptIo,
  promptFirstRun,
  saveConfig,
} from './config.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'companion-config-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A scripted person: answers in order, records what was said and asked. Hidden answers are never echoed. */
function scriptedIo(answers: readonly string[], hidden: readonly string[]) {
  const said: string[] = [];
  const asked: string[] = [];
  const plain = [...answers];
  const secret = [...hidden];
  const io: PromptIo = {
    say: (line) => {
      said.push(line);
    },
    ask: (question) => {
      asked.push(question);
      return Promise.resolve(plain.shift() ?? '');
    },
    askHidden: (question) => {
      asked.push(question);
      return Promise.resolve(secret.shift() ?? '');
    },
  };
  return { io, said, asked };
}

describe('configDir', () => {
  const home = '/home/friend';

  it('uses %APPDATA% on Windows', () => {
    expect(
      configDir({ platform: 'win32', env: { APPDATA: 'C:\\Users\\friend\\AppData\\Roaming' }, home }),
    ).toBe(join('C:\\Users\\friend\\AppData\\Roaming', 'customs-night'));
    expect(configDir({ platform: 'win32', env: {}, home })).toBe(
      join(home, 'AppData', 'Roaming', 'customs-night'),
    );
  });

  it('uses Application Support on macOS and XDG on Linux', () => {
    expect(configDir({ platform: 'darwin', env: {}, home })).toBe(
      join(home, 'Library', 'Application Support', 'customs-night'),
    );
    expect(configDir({ platform: 'linux', env: {}, home })).toBe(join(home, '.config', 'customs-night'));
    expect(configDir({ platform: 'linux', env: { XDG_CONFIG_HOME: '/xdg' }, home })).toBe(
      join('/xdg', 'customs-night'),
    );
  });

  it('honours the environment override on every platform', () => {
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      expect(configDir({ platform, env: { [CONFIG_DIR_ENV]: '/custom/dir ' }, home })).toBe('/custom/dir');
    }
  });

  it('derives the config and logs paths', () => {
    expect(configPath('/d')).toBe(join('/d', 'config.json'));
    expect(logsDir('/d')).toBe(join('/d', 'logs'));
  });
});

describe('loadConfig / saveConfig', () => {
  it('reports missing when there is no file', () => {
    const dir = tempDir();
    expect(loadConfig(dir)).toEqual({ status: 'missing', path: configPath(dir), partial: {} });
  });

  it('round-trips a config with owner-only permissions and a trimmed apiBase', () => {
    const dir = join(tempDir(), 'nested', 'customs-night');
    const path = saveConfig(dir, { apiBase: 'https://customs.example/', companionToken: 'tok_abcdef' });
    expect(path).toBe(configPath(dir));
    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(statSync(dir).mode & 0o077).toBe(0);
    }
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      apiBase: 'https://customs.example',
      companionToken: 'tok_abcdef',
    });
    expect(loadConfig(dir)).toEqual({
      status: 'ok',
      path,
      config: { apiBase: 'https://customs.example', companionToken: 'tok_abcdef' },
    });
  });

  it('treats a file without a token as missing but keeps the usable fields', () => {
    const dir = tempDir();
    writeFileSync(
      configPath(dir),
      JSON.stringify({ apiBase: 'http://localhost:3000', lockfilePath: 'D:\\lol\\lockfile' }),
    );
    expect(loadConfig(dir)).toEqual({
      status: 'missing',
      path: configPath(dir),
      partial: { apiBase: 'http://localhost:3000', lockfilePath: 'D:\\lol\\lockfile' },
    });
  });

  it('refuses a file that is not JSON rather than overwriting it', () => {
    const dir = tempDir();
    writeFileSync(configPath(dir), '{not json');
    const result = loadConfig(dir);
    expect(result.status).toBe('invalid');
  });

  it('rejects an apiBase with a path', () => {
    const dir = tempDir();
    writeFileSync(configPath(dir), JSON.stringify({ apiBase: 'https://x.example/api', companionToken: 't' }));
    expect(loadConfig(dir).status).toBe('missing');
  });
});

describe('promptFirstRun', () => {
  it('offers the default apiBase, takes the token hidden, checks reachability and writes the file', async () => {
    const dir = tempDir();
    const checked: string[] = [];
    const { io, said, asked } = scriptedIo([''], ['  tok_secret_value  ']);
    const config = await promptFirstRun({
      io,
      checkApiBase: async (apiBase) => {
        checked.push(apiBase);
        return null;
      },
    });
    expect(config).toEqual({ apiBase: DEFAULT_API_BASE, companionToken: 'tok_secret_value' });
    expect(checked).toEqual([DEFAULT_API_BASE]);
    expect(asked[0]).toContain(`[${DEFAULT_API_BASE}]`);
    expect(asked[1]).toContain('hidden');
    // The token is never printed back.
    expect(said.join('\n')).not.toContain('tok_secret_value');
    expect(asked.join('\n')).not.toContain('tok_secret_value');

    const path = saveConfig(dir, config);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(config);
  });

  it('re-asks on an unreachable apiBase unless the person keeps it', async () => {
    const { io, said } = scriptedIo(['https://typo.example', 'n', 'https://down.example/', 'y'], ['tok']);
    const config = await promptFirstRun({
      io,
      checkApiBase: async (apiBase) => (apiBase === 'https://typo.example' ? 'ENOTFOUND' : 'ECONNREFUSED'),
    });
    expect(config.apiBase).toBe('https://down.example');
    expect(said.some((line) => line.includes('ENOTFOUND'))).toBe(true);
  });

  it('rejects an invalid address and an empty token, and keeps a partial lockfilePath', async () => {
    const { io, said } = scriptedIo(['not a url', 'http://localhost:3000'], ['', 'tok']);
    const config = await promptFirstRun({ io, partial: { lockfilePath: '/x/lockfile' } });
    expect(config).toEqual({
      apiBase: 'http://localhost:3000',
      companionToken: 'tok',
      lockfilePath: '/x/lockfile',
    });
    expect(said.some((line) => line.includes('origin'))).toBe(true);
    expect(said.some((line) => line.includes('token is required'))).toBe(true);
  });
});
