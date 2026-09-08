/**
 * Shared pieces of the `smoke` and `record-ws` scripts: find the client, pick a TLS mode that works,
 * read the version. Scripts only; nothing here is exported from the package.
 */

import { LcuClient, type RawResponse } from '../client.js';
import { patchFromVersion } from '../fixtures.js';
import type { DiscoverLockfileResult, LockfileCredentials } from '../lockfile.js';
import { consoleLogger, type Logger, verboseConsoleLogger } from '../log.js';
import { GameVersionSchema, SystemBuildsSchema } from '../schemas.js';
import { describeTlsMode, isTlsError, type TlsMode } from '../tls.js';

export const VERSION_PATH = '/lol-patch/v1/game-version';
export const BUILDS_PATH = '/system/v1/builds';

export function makeLogger(verbose: boolean): Logger {
  return verbose ? verboseConsoleLogger : consoleLogger;
}

export function describeNotFound(result: Extract<DiscoverLockfileResult, { status: 'not_found' }>): string {
  const lines = ['League client not running: lockfile not found.'];
  for (const attempt of result.tried) {
    lines.push(`  ${attempt.path}  (${attempt.reason})`);
  }
  lines.push('Start the League client and log in, or pass --lockfile <path> for a non-default install.');
  return lines.join('\n');
}

/** The order the TLS modes are tried. Strictest first; `--insecure` skips straight to the last. */
export function tlsModesToTry(insecure: boolean): TlsMode[] {
  if (insecure) {
    return [{ mode: 'insecure' }];
  }
  return [{ mode: 'pinned' }, { mode: 'pinned', legacyDigests: true }, { mode: 'insecure' }];
}

export interface TlsAttempt {
  readonly mode: TlsMode;
  readonly outcome: string;
  readonly ok: boolean;
}

export interface TlsProbe {
  readonly client: LcuClient;
  readonly mode: TlsMode;
  readonly attempts: readonly TlsAttempt[];
  /** The response of the first successful `GET /lol-patch/v1/game-version`. */
  readonly versionResponse: Extract<RawResponse, { kind: 'response' }>;
}

/**
 * Tries each TLS mode against the version endpoint until one gets an HTTP response of any status.
 * Only a certificate/handshake failure moves to the next, looser mode: a refused or timed-out connection
 * means the client is not answering at all, and stepping down would record "insecure was needed" for a
 * client that was merely still starting. Returns null (with the attempts) when nothing answered.
 */
export async function probeTls(
  credentials: LockfileCredentials,
  options: { readonly insecure: boolean; readonly logger: Logger },
): Promise<TlsProbe | { readonly client: null; readonly attempts: readonly TlsAttempt[] }> {
  const attempts: TlsAttempt[] = [];
  for (const mode of tlsModesToTry(options.insecure)) {
    const client = LcuClient.fromCredentials(credentials, {
      tls: mode,
      logger: options.logger,
      timeoutMs: 5000,
    });
    const response = await client.raw('GET', VERSION_PATH);
    if (response.kind === 'response') {
      attempts.push({ mode, outcome: `HTTP ${response.status}`, ok: true });
      return { client, mode, attempts, versionResponse: response };
    }
    attempts.push({ mode, outcome: `${response.code ?? 'error'}: ${response.message}`, ok: false });
    client.close();
    if (!isTlsError(response.code, response.message)) {
      break;
    }
  }
  return { client: null, attempts };
}

export function describeAttempts(attempts: readonly TlsAttempt[]): string {
  return attempts.map((attempt) => `  ${describeTlsMode(attempt.mode)} -> ${attempt.outcome}`).join('\n');
}

export interface ResolvedVersion {
  readonly version: string | null;
  /** Which endpoint the version came from, for the reference doc. */
  readonly source: string;
  /** Fixture directory name. */
  readonly patch: string;
}

/** Reads the client version from `game-version`, falling back to `builds.version`, then to an `unknown-<date>` dir. */
export async function resolveVersion(
  client: LcuClient,
  versionResponse: Extract<RawResponse, { kind: 'response' }>,
  today: string,
): Promise<ResolvedVersion> {
  if (versionResponse.status === 200 && versionResponse.body.parsed) {
    const parsed = GameVersionSchema.safeParse(versionResponse.body.value);
    if (parsed.success) {
      const patch = patchFromVersion(parsed.data);
      if (patch) {
        return { version: parsed.data, source: VERSION_PATH, patch };
      }
    }
  }
  const builds = await client.get(BUILDS_PATH, SystemBuildsSchema);
  if (builds.ok) {
    const patch = patchFromVersion(builds.json.version);
    if (patch) {
      return { version: builds.json.version, source: BUILDS_PATH, patch };
    }
  }
  return { version: null, source: 'none', patch: `unknown-${today}` };
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function todayStamp(): string {
  return isoNow().slice(0, 10);
}
