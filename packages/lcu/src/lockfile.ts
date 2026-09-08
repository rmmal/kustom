/**
 * Lockfile discovery and parsing.
 *
 * The League client writes `<install dir>/lockfile` with `LeagueClient:<pid>:<port>:<password>:https`
 * while it runs and removes it on exit. See docs/03-lcu-reference.md "Connecting".
 *
 * Discovery never throws on absence: the companion polls this forever while the client is closed.
 */

import { readFile as fsReadFile } from 'node:fs/promises';
import { z } from 'zod';

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

export interface DiscoverLockfileOptions {
  /** A configured path (companion config or `--lockfile`). Tried first when set. */
  readonly overridePath?: string | undefined;
  /** Defaults to `process.platform`. Injected in tests. */
  readonly platform?: NodeJS.Platform;
  /** Replaces the platform defaults entirely. Injected in tests. */
  readonly candidates?: readonly string[];
  /** Injected in tests. */
  readonly readFile?: (path: string) => Promise<string>;
}

export interface LockfileAttempt {
  readonly path: string;
  /** `missing`, `malformed: <why>`, or the fs error code. */
  readonly reason: string;
}

export type DiscoverLockfileResult =
  | { readonly status: 'found'; readonly path: string; readonly credentials: LockfileCredentials }
  | { readonly status: 'not_found'; readonly tried: readonly LockfileAttempt[] };

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Finds and parses the first readable, well-formed lockfile among the override and the platform defaults.
 * A present-but-malformed file is reported and skipped, so a stale or partially written lockfile does not
 * stop discovery. Never throws.
 *
 * TODO(M2): Windows process-args fallback. `LeagueClientUx` is started with `--app-port=` and
 * `--remoting-auth-token=` on its command line (confirmed in this Mac's LeagueClientUx log as well), which
 * covers a non-default install directory. Needs `wmic`/PowerShell on Windows; out of scope for M0.1.
 */
export async function discoverLockfile(
  options: DiscoverLockfileOptions = {},
): Promise<DiscoverLockfileResult> {
  const readFile = options.readFile ?? ((path: string) => fsReadFile(path, 'utf8'));
  const defaults = options.candidates ?? defaultLockfileCandidates(options.platform);
  const paths = options.overridePath ? [options.overridePath, ...defaults] : [...defaults];
  const tried: LockfileAttempt[] = [];

  for (const path of paths) {
    let text: string;
    try {
      text = await readFile(path);
    } catch (error) {
      const code = errorCode(error);
      tried.push({ path, reason: code === 'ENOENT' ? 'missing' : code });
      continue;
    }
    const parsed = parseLockfile(text);
    if (!parsed.ok) {
      tried.push({ path, reason: `malformed: ${parsed.reason}` });
      continue;
    }
    return { status: 'found', path, credentials: parsed.credentials };
  }

  return { status: 'not_found', tried };
}
