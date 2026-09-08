/**
 * TLS policy for the loopback connection to the League client.
 *
 * The client presents a certificate issued by Riot's own "LoL Game Engineering Certificate Authority"
 * (vendored in `certs/riotgames.pem`, fetched from Riot's developer static host; see `certs/README.md`).
 *
 * Modes, from strict to loose:
 *  - `pinned`: verify the chain against Riot's root only (not the system store). Hostname checking is
 *    skipped for 127.0.0.1 only (the leaf's SAN is unknown until M0.2); any other host is checked normally.
 *    `legacyDigests` additionally allows a SHA-1 signed leaf (`DEFAULT@SECLEVEL=0`). Riot's root itself
 *    is SHA-1 self-signed; that alone is fine at Node's default security level (checked locally), only a
 *    SHA-1 signed *leaf* needs the flag.
 *  - `insecure`: `rejectUnauthorized: false`. The documented fallback; loopback only.
 *
 * Which mode the client on this patch actually needs is a question for M0.2; the smoke script probes all
 * three and prints the answer. See docs/04-decisions.md for the default.
 */

import { readFileSync } from 'node:fs';
import { checkServerIdentity as nodeCheckServerIdentity, type PeerCertificate } from 'node:tls';
import { fileURLToPath } from 'node:url';
import { LCU_HOST } from './auth.js';

export type TlsMode =
  | {
      readonly mode: 'pinned';
      /** Override the trust anchor. Tests pin to the fake server's own certificate. */
      readonly ca?: string | Buffer;
      /** Allow a SHA-1 signed leaf certificate. */
      readonly legacyDigests?: boolean;
    }
  | { readonly mode: 'insecure' };

/** Path of the vendored Riot root certificate. */
export const RIOT_ROOT_CA_PATH = fileURLToPath(new URL('../certs/riotgames.pem', import.meta.url));

/** The default policy: pin Riot's root, default OpenSSL security level. */
export const DEFAULT_TLS_MODE: TlsMode = { mode: 'pinned' };

let cachedRiotRoot: string | undefined;

export function loadRiotRootCa(): string {
  cachedRiotRoot ??= readFileSync(RIOT_ROOT_CA_PATH, 'utf8');
  return cachedRiotRoot;
}

/** Options accepted by both `https.Agent` and `ws`'s client options. */
export interface TlsConnectionOptions {
  readonly rejectUnauthorized: boolean;
  readonly ca?: string | Buffer;
  readonly checkServerIdentity?: (hostname: string, cert: PeerCertificate) => Error | undefined;
  readonly ciphers?: string;
}

/**
 * Skips hostname verification for the loopback address only; any other host gets Node's normal check.
 * Chain verification against `ca` applies in both cases.
 */
export function checkServerIdentity(hostname: string, cert: PeerCertificate): Error | undefined {
  return hostname === LCU_HOST ? undefined : nodeCheckServerIdentity(hostname, cert);
}

export function tlsConnectionOptions(mode: TlsMode = DEFAULT_TLS_MODE): TlsConnectionOptions {
  if (mode.mode === 'insecure') {
    return { rejectUnauthorized: false };
  }
  const options: { -readonly [K in keyof TlsConnectionOptions]: TlsConnectionOptions[K] } = {
    rejectUnauthorized: true,
    ca: mode.ca ?? loadRiotRootCa(),
    checkServerIdentity,
  };
  if (mode.legacyDigests) {
    options.ciphers = 'DEFAULT@SECLEVEL=0';
  }
  return options;
}

/** Human-readable label for logs and the smoke table. */
export function describeTlsMode(mode: TlsMode): string {
  if (mode.mode === 'insecure') {
    return 'insecure (rejectUnauthorized: false)';
  }
  const anchor = mode.ca ? 'custom CA' : 'riotgames.pem';
  return mode.legacyDigests ? `pinned to ${anchor}, legacy digests allowed` : `pinned to ${anchor}`;
}

/**
 * True when a network failure looks like a certificate or TLS handshake problem rather than the client
 * being down. Used by the smoke script to decide whether to try the next TLS mode.
 */
export function isTlsError(code: string | undefined, message: string): boolean {
  if (!code) {
    return /certificate|ssl|tls|handshake|signature|digest/i.test(message);
  }
  return (
    code.startsWith('ERR_TLS') ||
    code.startsWith('ERR_SSL') ||
    code.startsWith('ERR_OSSL') ||
    /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|EPROTO|HANDSHAKE|UNSPECIFIED/.test(code)
  );
}
