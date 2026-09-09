/**
 * Lockfile discovery and parsing.
 *
 * The League client writes `<install dir>/lockfile` with `LeagueClient:<pid>:<port>:<password>:https`
 * while it runs and removes it on exit. See docs/03-lcu-reference.md "Connecting".
 *
 * Discovery never throws on absence: the companion polls this forever while the client is closed. When every
 * known path is missing, the process list is asked where the client is (M2.19, `processDiscovery.ts`), which
 * covers a League installed somewhere other than the default directory.
 */

import { readFile as fsReadFile } from 'node:fs/promises';
import { delimiter } from 'node:path';
import { z } from 'zod';
import type { Logger } from './log.js';
import {
  LEAGUE_UX_PROCESS_NAME,
  type LeagueProcess,
  lockfilePathFromExecutable,
  type ProcessLister,
  type ProcessListResult,
  parseUxCommandLine,
  resolveProcessLister,
} from './processDiscovery.js';

/**
 * Environment override for the platform default candidates: a `path.delimiter`-separated list of lockfile
 * paths that replaces the defaults (not the `--lockfile` override, which is still tried first). Exists so
 * unit tests and CI can point discovery away from a real install; set it to a path that does not exist and
 * a running client on the same machine is invisible (the process-list fallback is off too). Unset for users.
 */
export const LOCKFILE_CANDIDATES_ENV = 'LCU_LOCKFILE_CANDIDATES';

/** Default install location on Windows. The packaged companion targets this. */
export const WINDOWS_LOCKFILE_PATH = 'C:\\Riot Games\\League of Legends\\lockfile';

/**
 * Default install location on macOS. Today's LeagueClient log on this Mac shows the client
 * "Running from cwd '/Applications/League of Legends.app/Contents/LoL'", which is where the
 * lockfile lands. Not yet confirmed against a running client (M0.2).
 */
export const MACOS_LOCKFILE_PATH = '/Applications/League of Legends.app/Contents/LoL/lockfile';

export const LockfileCredentialsSchema = z.object({
  /** Always `LeagueClient` for the League client. Kept so a mismatch is visible. */
  name: z.string().min(1),
  pid: z.number().int().positive(),
  port: z.number().int().min(1).max(65535),
  password: z.string().min(1),
  protocol: z.literal('https'),
});

export type LockfileCredentials = z.infer<typeof LockfileCredentialsSchema>;

export type ParseLockfileResult =
  | { readonly ok: true; readonly credentials: LockfileCredentials }
  | { readonly ok: false; readonly reason: string };

/** Parses the lockfile text. Tolerates surrounding whitespace; nothing else. */
export function parseLockfile(text: string): ParseLockfileResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'empty file' };
  }
  const parts = trimmed.split(':');
  if (parts.length !== 5) {
    return { ok: false, reason: `expected 5 colon-separated fields, got ${parts.length}` };
  }
  const [name, pid, port, password, protocol] = parts;
  const candidate = {
    name,
    pid: Number(pid),
    port: Number(port),
    password,
    protocol,
  };
  const parsed = LockfileCredentialsSchema.safeParse(candidate);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    return { ok: false, reason: issues.join('; ') };
  }
  return { ok: true, credentials: parsed.data };
}

/** Candidate lockfile paths for a platform, in the order they are tried. */
export function defaultLockfileCandidates(platform: NodeJS.Platform = process.platform): string[] {
  switch (platform) {
    case 'win32':
      return [WINDOWS_LOCKFILE_PATH];
    case 'darwin':
      return [MACOS_LOCKFILE_PATH];
    default:
      // Linux is not a supported client platform, but a Wine/Lutris user can pass an override.
      return [];
  }
}

/**
 * Candidates from `LCU_LOCKFILE_CANDIDATES` when set (split on the platform path delimiter, blanks dropped),
 * else null. An empty value (`LCU_LOCKFILE_CANDIDATES=`) counts as set and means "no defaults".
 */
export function lockfileCandidatesFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  platformDelimiter: string = delimiter,
): string[] | null {
  const raw = env[LOCKFILE_CANDIDATES_ENV];
  if (raw === undefined) {
    return null;
  }
  return raw
    .split(platformDelimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export interface DiscoverLockfileOptions {
  /** A configured path (companion config or `--lockfile`). Tried first when set. */
  readonly overridePath?: string | undefined;
  /**
   * Paths tried after the override and before the platform defaults. `createLockfileDiscovery` puts the
   * lockfile it last found through the process list here, so a custom install is read like a default one.
   */
  readonly extraCandidates?: readonly string[];
  /** Defaults to `process.platform`. Injected in tests. */
  readonly platform?: NodeJS.Platform;
  /** Replaces the platform defaults entirely. Injected in tests. Wins over the environment override. */
  readonly candidates?: readonly string[];
  /**
   * Where `LCU_LOCKFILE_CANDIDATES` is read from. Defaults to `process.env`; tests pass `{}` to ignore it.
   */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Injected in tests. */
  readonly readFile?: (path: string) => Promise<string>;
  /**
   * The process-list fallback (M2.19), tried when every path is missing. `undefined` picks the platform one
   * (PowerShell/wmic on a real Windows host, nothing elsewhere) unless `candidates` or `LCU_LOCKFILE_CANDIDATES`
   * replaced the defaults, which is what tests and CI do to stay away from a real client. `null` disables it.
   * Tests inject a fake; nothing in a test may shell out.
   */
  readonly listProcesses?: ProcessLister | null;
  /** Where discovery reports what it did with the process list. Never the command line. */
  readonly logger?: Logger;
}

export interface LockfileAttempt {
  readonly path: string;
  /** `missing`, `malformed: <why>`, or the fs error code. */
  readonly reason: string;
}

/**
 * Where the credentials came from: a candidate path, the lockfile beside the running client's executable,
 * or the client's command line (`--app-port` / `--remoting-auth-token`) when no file could be read.
 */
export type LockfileSource = 'path' | 'process_path' | 'process_args';

/** The `path` reported for credentials read off the command line; there is no file. */
export const PROCESS_ARGS_PATH = `${LEAGUE_UX_PROCESS_NAME} command line`;

/** The `path` of the attempt that records what the process list said when nothing was found. */
export const PROCESS_LIST_PATH = `${LEAGUE_UX_PROCESS_NAME} (process list)`;

export type DiscoverLockfileResult =
  | {
      readonly status: 'found';
      readonly path: string;
      readonly credentials: LockfileCredentials;
      readonly source: LockfileSource;
    }
  | { readonly status: 'not_found'; readonly tried: readonly LockfileAttempt[] };

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return error instanceof Error ? error.message : String(error);
}

type ReadFile = (path: string) => Promise<string>;

type CandidateRead =
  | { readonly ok: true; readonly credentials: LockfileCredentials }
  | { readonly ok: false; readonly attempt: LockfileAttempt };

async function readCandidate(path: string, readFile: ReadFile): Promise<CandidateRead> {
  let text: string;
  try {
    text = await readFile(path);
  } catch (error) {
    const code = errorCode(error);
    return { ok: false, attempt: { path, reason: code === 'ENOENT' ? 'missing' : code } };
  }
  const parsed = parseLockfile(text);
  if (!parsed.ok) {
    return { ok: false, attempt: { path, reason: `malformed: ${parsed.reason}` } };
  }
  return { ok: true, credentials: parsed.credentials };
}

async function listSafely(listProcesses: ProcessLister): Promise<ProcessListResult> {
  try {
    return await listProcesses();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The process-list fallback: for each running `LeagueClientUx.exe`, the lockfile beside its executable, then
 * its command line. Appends what it tried to `tried`. Never throws.
 */
async function discoverFromProcesses(
  listProcesses: ProcessLister,
  readFile: ReadFile,
  logger: Logger | undefined,
  tried: LockfileAttempt[],
): Promise<DiscoverLockfileResult | null> {
  const listed = await listSafely(listProcesses);
  if (!listed.ok) {
    logger?.warn('process list unavailable; polling the lockfile paths only', { reason: listed.error });
    tried.push({ path: PROCESS_LIST_PATH, reason: `unavailable: ${listed.error}` });
    return null;
  }
  if (listed.processes.length === 0) {
    tried.push({ path: PROCESS_LIST_PATH, reason: 'not running' });
    return null;
  }
  for (const proc of listed.processes) {
    const found = await discoverFromProcess(proc, readFile, logger, tried);
    if (found) {
      return found;
    }
  }
  return null;
}

async function discoverFromProcess(
  proc: LeagueProcess,
  readFile: ReadFile,
  logger: Logger | undefined,
  tried: LockfileAttempt[],
): Promise<DiscoverLockfileResult | null> {
  const pidLabel = `pid ${proc.pid ?? '?'}`;
  const lockfilePath = proc.executablePath === null ? null : lockfilePathFromExecutable(proc.executablePath);
  if (lockfilePath !== null) {
    const read = await readCandidate(lockfilePath, readFile);
    if (read.ok) {
      logger?.info('League client found through the process list', { path: lockfilePath, uxPid: proc.pid });
      return { status: 'found', path: lockfilePath, credentials: read.credentials, source: 'process_path' };
    }
    tried.push(read.attempt);
  } else {
    tried.push({ path: PROCESS_LIST_PATH, reason: `${pidLabel}: no executable path` });
  }
  // The command line carries the client password: parsed here, never logged, never quoted in `tried`.
  const args = proc.commandLine === null ? null : parseUxCommandLine(proc.commandLine);
  if (args === null) {
    tried.push({ path: PROCESS_ARGS_PATH, reason: `${pidLabel}: no --app-port/--remoting-auth-token` });
    return null;
  }
  const pid = args.appPid ?? proc.pid;
  if (pid === null) {
    tried.push({ path: PROCESS_ARGS_PATH, reason: 'no pid' });
    return null;
  }
  logger?.info('League client found through its command line', { port: args.port, uxPid: proc.pid });
  return {
    status: 'found',
    path: PROCESS_ARGS_PATH,
    source: 'process_args',
    credentials: { name: 'LeagueClient', pid, port: args.port, password: args.password, protocol: 'https' },
  };
}

interface ResolvedCandidates {
  readonly paths: readonly string[];
  /** True when the platform defaults are in play, i.e. neither `candidates` nor the env replaced them. */
  readonly usingDefaults: boolean;
}

function resolveCandidates(options: DiscoverLockfileOptions): ResolvedCandidates {
  const fromEnv =
    options.candidates === undefined ? lockfileCandidatesFromEnv(options.env ?? process.env) : null;
  const defaults =
    options.candidates ?? fromEnv ?? defaultLockfileCandidates(options.platform ?? process.platform);
  return {
    paths: [
      ...(options.overridePath ? [options.overridePath] : []),
      ...(options.extraCandidates ?? []),
      ...defaults,
    ],
    usingDefaults: options.candidates === undefined && fromEnv === null,
  };
}

function resolveLister(options: DiscoverLockfileOptions, usingDefaults: boolean): ProcessLister | null {
  if (options.listProcesses !== undefined) {
    return options.listProcesses;
  }
  return usingDefaults ? resolveProcessLister(options.platform ?? process.platform) : null;
}

/**
 * Finds and parses the first readable, well-formed lockfile among the override, the extra candidates and the
 * platform defaults (or `candidates`, or `LCU_LOCKFILE_CANDIDATES`, in that order of precedence). When every
 * path fails, the process-list fallback runs (see `listProcesses`). A present-but-malformed file is reported
 * and skipped, so a stale or partially written lockfile does not stop discovery. Never throws.
 *
 * Stateless: every call re-reads every path and, on a miss, re-lists processes. Long-running callers use
 * `createLockfileDiscovery`, which remembers the path it found and rate-limits the shell-out.
 */
export async function discoverLockfile(
  options: DiscoverLockfileOptions = {},
): Promise<DiscoverLockfileResult> {
  const readFile = options.readFile ?? ((path: string) => fsReadFile(path, 'utf8'));
  const { paths, usingDefaults } = resolveCandidates(options);
  const tried: LockfileAttempt[] = [];

  for (const path of paths) {
    const read = await readCandidate(path, readFile);
    if (read.ok) {
      return { status: 'found', path, credentials: read.credentials, source: 'path' };
    }
    tried.push(read.attempt);
  }

  const listProcesses = resolveLister(options, usingDefaults);
  if (listProcesses !== null) {
    const found = await discoverFromProcesses(listProcesses, readFile, options.logger, tried);
    if (found) {
      return found;
    }
  }

  return { status: 'not_found', tried };
}

export interface LockfileDiscoveryOptions extends DiscoverLockfileOptions {
  /**
   * The least time between two process-list shell-outs; the previous answer is reused in between. Default
   * 15 s: discovery is polled every 5 s while the client is closed, and a PowerShell start on every poll is
   * not a fair price for a friend's idle PC. 0 in tests.
   */
  readonly processListMinIntervalMs?: number;
  /** Injected clock for the rate limit. Defaults to `Date.now`. */
  readonly now?: () => number;
}

export type LockfileDiscovery = () => Promise<DiscoverLockfileResult>;

/**
 * A `discoverLockfile` for a long-running caller (the companion's connection machine): the same options every
 * call, plus memory. A lockfile found beside the running client's executable is tried as a plain path on the
 * next calls (no shell-out while the client is up), and the process list is asked at most once per
 * `processListMinIntervalMs`. Never throws.
 */
export function createLockfileDiscovery(options: LockfileDiscoveryOptions = {}): LockfileDiscovery {
  const minIntervalMs = options.processListMinIntervalMs ?? 15_000;
  const now = options.now ?? Date.now;
  const inner = resolveLister(options, resolveCandidates(options).usingDefaults);

  let learnedPath: string | null = null;
  let lastListedAt: number | null = null;
  let lastListed: ProcessListResult = { ok: true, processes: [] };
  const throttled: ProcessLister | null =
    inner === null
      ? null
      : async () => {
          const at = now();
          if (lastListedAt !== null && at - lastListedAt < minIntervalMs) {
            return lastListed;
          }
          lastListedAt = at;
          lastListed = await listSafely(inner);
          return lastListed;
        };

  return async () => {
    const result = await discoverLockfile({
      ...options,
      extraCandidates: [...(learnedPath ? [learnedPath] : []), ...(options.extraCandidates ?? [])],
      listProcesses: throttled,
    });
    if (result.status === 'found' && result.source === 'process_path') {
      learnedPath = result.path;
    }
    return result;
  };
}
