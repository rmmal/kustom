/**
 * The companion's config file: where it lives, what it holds, and the first-run prompt that fills it.
 *
 * Location (`docs/01-architecture.md` "Companion", plus the dev platforms):
 *  - Windows: `%APPDATA%\customs-night\config.json`
 *  - macOS:   `~/Library/Application Support/customs-night/config.json`
 *  - Linux:   `$XDG_CONFIG_HOME/customs-night/config.json` (default `~/.config`)
 *  - any:     `CUSTOMS_NIGHT_CONFIG_DIR` overrides the directory.
 *
 * Shape: `{ apiBase, companionToken }`, plus an optional `lockfilePath` for a non-default League install.
 * The file is written with mode 0600 (owner only; Windows ignores the mode). Nothing else is ever written to
 * the config directory except `logs/`.
 *
 * The token is never printed, logged or echoed; the hidden prompt masks it.
 */

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { z } from 'zod';

export const CONFIG_DIR_ENV = 'CUSTOMS_NIGHT_CONFIG_DIR';
export const CONFIG_DIR_NAME = 'customs-night';
export const CONFIG_FILE_NAME = 'config.json';
export const LOGS_DIR_NAME = 'logs';

/**
 * The API origin used when the config file names none. The packaged exe (M2.6) bakes the deployed origin in
 * through an esbuild `define` (`__CUSTOMS_NIGHT_API_BASE__`); under `pnpm --filter companion dev` the define
 * is absent and this is the local dev server. A `config.json` with its own `apiBase` always wins over it.
 */
declare const __CUSTOMS_NIGHT_API_BASE__: string | undefined;

export const LOCAL_API_BASE = 'http://localhost:3000';

export const DEFAULT_API_BASE: string =
  typeof __CUSTOMS_NIGHT_API_BASE__ === 'string' && __CUSTOMS_NIGHT_API_BASE__.length > 0
    ? __CUSTOMS_NIGHT_API_BASE__
    : LOCAL_API_BASE;

export const apiBaseSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value) => value.replace(/\/+$/, ''))
  .refine((value) => /^https?:\/\/[^/\s]+$/.test(value), {
    message: 'apiBase must be an origin like https://customs.example (no path)',
  });

export const configSchema = z.object({
  apiBase: apiBaseSchema,
  companionToken: z.string().trim().min(1),
  /** A non-default League install. Tried before the platform default lockfile paths. */
  lockfilePath: z.string().trim().min(1).optional(),
});

export type CompanionConfig = z.infer<typeof configSchema>;

export interface ConfigEnv {
  readonly platform?: NodeJS.Platform;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly home?: string;
}

/** The directory the config file and `logs/` live in. */
export function configDir(options: ConfigEnv = {}): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  const override = env[CONFIG_DIR_ENV];
  if (override && override.trim().length > 0) {
    return override.trim();
  }
  switch (platform) {
    case 'win32':
      return join(
        env.APPDATA && env.APPDATA.length > 0 ? env.APPDATA : join(home, 'AppData', 'Roaming'),
        CONFIG_DIR_NAME,
      );
    case 'darwin':
      return join(home, 'Library', 'Application Support', CONFIG_DIR_NAME);
    default: {
      const xdg = env.XDG_CONFIG_HOME;
      return join(xdg && xdg.length > 0 ? xdg : join(home, '.config'), CONFIG_DIR_NAME);
    }
  }
}

export function configPath(dir: string): string {
  return join(dir, CONFIG_FILE_NAME);
}

export function logsDir(dir: string): string {
  return join(dir, LOGS_DIR_NAME);
}

export type LoadConfigResult =
  | { readonly status: 'ok'; readonly config: CompanionConfig; readonly path: string }
  /** No file, or a file without a usable token: the first-run prompt is needed. */
  | { readonly status: 'missing'; readonly path: string; readonly partial: Partial<CompanionConfig> }
  /** A file that exists but is not JSON. Refuse to overwrite it silently. */
  | { readonly status: 'invalid'; readonly path: string; readonly reason: string };

/** Reads and validates the config file. Never throws. */
export function loadConfig(dir: string): LoadConfigResult {
  const path = configPath(dir);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    if (code === 'ENOENT') {
      return { status: 'missing', path, partial: {} };
    }
    return { status: 'invalid', path, reason: error instanceof Error ? error.message : String(error) };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    // Never V8's message: it quotes a snippet of the source, which for a hand-edited file may be the token.
    const position = error instanceof Error ? /position (\d+)/.exec(error.message)?.[1] : undefined;
    return { status: 'invalid', path, reason: position ? `not JSON (at position ${position})` : 'not JSON' };
  }
  const parsed = configSchema.safeParse(raw);
  if (parsed.success) {
    return { status: 'ok', config: parsed.data, path };
  }
  // Keep whatever fields are usable so the prompt can offer them as defaults.
  const partial: Partial<CompanionConfig> = {};
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    const apiBase = apiBaseSchema.safeParse(record.apiBase);
    if (apiBase.success) {
      partial.apiBase = apiBase.data;
    }
    if (typeof record.lockfilePath === 'string' && record.lockfilePath.trim().length > 0) {
      partial.lockfilePath = record.lockfilePath.trim();
    }
  }
  return { status: 'missing', path, partial };
}

/** Writes the config with owner-only permissions. Creates the directory. Throws on I/O failure. */
export function saveConfig(dir: string, config: CompanionConfig): string {
  const path = configPath(dir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const body = `${JSON.stringify(configSchema.parse(config), null, 2)}\n`;
  writeFileSync(path, body, { mode: 0o600 });
  // `mode` only applies when the file is created; a pre-existing file (the partial-config first-run path)
  // keeps whatever mode it had, so tighten it explicitly. Windows has no POSIX modes; ignore failure there.
  try {
    chmodSync(path, 0o600);
  } catch (error) {
    if (process.platform !== 'win32') {
      throw error;
    }
  }
  return path;
}

/** How the first-run prompt talks to a person. Injected so tests can script it. */
export interface PromptIo {
  /** Prints a line. */
  say(line: string): void;
  /** Asks a question; the answer is echoed as typed. */
  ask(question: string): Promise<string>;
  /** Asks a question without echoing the answer. */
  askHidden(question: string): Promise<string>;
}

/** Reachability check for the typed `apiBase`. Returns null when fine, else a one-line reason. */
export type ApiBaseCheck = (apiBase: string) => Promise<string | null>;

export interface FirstRunOptions {
  readonly io: PromptIo;
  readonly partial?: Partial<CompanionConfig>;
  readonly checkApiBase?: ApiBaseCheck;
}

/**
 * The first-run conversation. When the built-in origin answers `GET /api/health`, the only question is the
 * token (hidden): one paste, not two answers (M2.6). Otherwise it asks for the API origin (default offered),
 * checks it, and lets the person keep an unreachable one (the API may simply be down right now; the client
 * retries forever). A partial config that already names an `apiBase` is offered as the default and confirmed.
 */
export async function promptFirstRun(options: FirstRunOptions): Promise<CompanionConfig> {
  const { io } = options;
  const partial = options.partial ?? {};
  io.say(
    'Customs Night companion: first run. Paste the token from the admin page; it is stored locally only.',
  );

  let apiBase = partial.apiBase ?? DEFAULT_API_BASE;
  let settled = false;
  if (partial.apiBase === undefined && options.checkApiBase) {
    const problem = await options.checkApiBase(apiBase);
    if (problem === null) {
      io.say(`  Using ${apiBase}.`);
      settled = true;
    } else {
      io.say(`  ${apiBase} did not answer: ${problem}`);
    }
  }
  while (!settled) {
    const answer = await io.ask(`API address [${apiBase}]: `);
    const parsed = apiBaseSchema.safeParse(answer.trim().length > 0 ? answer : apiBase);
    if (!parsed.success) {
      io.say(`  ${parsed.error.issues[0]?.message ?? 'invalid address'}`);
      continue;
    }
    apiBase = parsed.data;
    if (!options.checkApiBase) {
      break;
    }
    const problem = await options.checkApiBase(apiBase);
    if (problem === null) {
      io.say(`  ${apiBase} answered.`);
      break;
    }
    io.say(`  ${apiBase} did not answer: ${problem}`);
    const keep = await io.ask('  Keep it anyway? [y/N]: ');
    if (/^y(es)?$/i.test(keep.trim())) {
      break;
    }
  }

  let companionToken = '';
  while (companionToken.length === 0) {
    companionToken = (await io.askHidden('Companion token (input hidden): ')).trim();
    if (companionToken.length === 0) {
      io.say('  A token is required.');
    }
  }

  const config: CompanionConfig = { apiBase, companionToken };
  if (partial.lockfilePath) {
    config.lockfilePath = partial.lockfilePath;
  }
  return config;
}

/**
 * A `PromptIo` over the process's stdin/stdout. The hidden prompt puts a TTY into raw mode and reads keys
 * itself so the token is never echoed; on a non-TTY stdin (piped input) it falls back to a plain line read.
 */
export function stdioPrompt(
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stdout,
): PromptIo {
  const say = (line: string): void => {
    output.write(`${line}\n`);
  };
  const askLine = async (question: string): Promise<string> => {
    const rl = createInterface({ input, output, terminal: false });
    try {
      return await rl.question(question);
    } finally {
      rl.close();
    }
  };
  const askHidden = (question: string): Promise<string> => {
    if (!input.isTTY || typeof input.setRawMode !== 'function') {
      return askLine(question);
    }
    output.write(question);
    return new Promise((resolve) => {
      let buffer = '';
      const wasRaw = input.isRaw;
      input.setRawMode(true);
      input.resume();
      const finish = (value: string): void => {
        input.off('data', onData);
        input.setRawMode(wasRaw);
        input.pause();
        output.write('\n');
        resolve(value);
      };
      const onData = (chunk: Buffer | string): void => {
        const text = chunk.toString('utf8');
        for (const ch of text) {
          if (ch === '\u0003') {
            // Ctrl-C during the prompt: leave the terminal sane and exit.
            input.setRawMode(wasRaw);
            output.write('\n');
            process.exit(130);
          }
          if (ch === '\r' || ch === '\n') {
            finish(buffer);
            return;
          }
          if (ch === '\u007f' || ch === '\b') {
            buffer = buffer.slice(0, -1);
            continue;
          }
          if (ch >= ' ') {
            buffer += ch;
          }
        }
      };
      input.on('data', onData);
    });
  };
  return { say, ask: askLine, askHidden };
}
