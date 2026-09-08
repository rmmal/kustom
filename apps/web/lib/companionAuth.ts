import { createHash, randomBytes } from 'node:crypto';
import type { ServiceClient } from './supabase';

/**
 * Companion token authentication (`docs/01-architecture.md` "Security").
 *
 * Tokens are random 32 bytes, handed out once and stored only as a SHA-256 hash, so a dump of
 * `companion_tokens` does not let anyone post games. The token, not the payload, decides who
 * the caller is: nothing in this file ever reads a PUUID out of a request body.
 *
 * The decision logic is a pure function over an injected lookup so it can be tested without a
 * database; the Supabase-backed lookup is at the bottom.
 */

/** Bytes of entropy in a companion token. */
export const COMPANION_TOKEN_BYTES = 32;

/**
 * `last_seen_at` is only written when it is this stale, so the common case (a companion
 * polling every few seconds) is one read and no write.
 */
export const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;

/** A newly minted token: the raw value is shown once, the hash is what we store. */
export interface MintedCompanionToken {
  token: string;
  tokenHash: string;
}

export function mintCompanionToken(): MintedCompanionToken {
  const token = randomBytes(COMPANION_TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashCompanionToken(token) };
}

/** SHA-256, hex. The only thing that ever goes into `companion_tokens.token_hash`. */
export function hashCompanionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Pulls the token out of an `Authorization: Bearer <token>` header. Returns null for a missing,
 * empty or non-bearer header; the caller answers 401 either way.
 */
export function readBearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer[ \t]+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

/** What a token row says, before we decide whether to accept it. */
export interface CompanionTokenRecord {
  tokenId: string;
  playerId: string;
  puuid: string;
  isAdmin: boolean;
  /** Set means revoked: the token is refused however valid the hash is. */
  revokedAt: string | null;
  lastSeenAt: string | null;
}

/** The caller, as the token defines them. Route handlers get this and nothing else. */
export interface CompanionIdentity {
  tokenId: string;
  playerId: string;
  puuid: string;
  isAdmin: boolean;
}

export type CompanionTokenLookup = (tokenHash: string) => Promise<CompanionTokenRecord | null>;
export type CompanionTokenTouch = (tokenId: string) => Promise<void>;

export type CompanionAuthResult =
  | { ok: true; identity: CompanionIdentity }
  | { ok: false; status: 401; error: string };

export interface AuthenticateCompanionOptions {
  authorization: string | null | undefined;
  lookup: CompanionTokenLookup;
  /** Called when `last_seen_at` is older than {@link LAST_SEEN_THROTTLE_MS}. Optional. */
  touch?: CompanionTokenTouch;
  now?: Date;
}

/**
 * Bearer header in, identity or 401 out. Pure apart from the injected lookup and touch.
 */
export async function authenticateCompanion(
  options: AuthenticateCompanionOptions,
): Promise<CompanionAuthResult> {
  const token = readBearerToken(options.authorization);
  if (token === null) {
    return { ok: false, status: 401, error: 'missing bearer token' };
  }

  const record = await options.lookup(hashCompanionToken(token));
  if (record === null) {
    return { ok: false, status: 401, error: 'unknown companion token' };
  }

  if (record.revokedAt !== null) {
    return { ok: false, status: 401, error: 'companion token has been revoked' };
  }

  const now = options.now ?? new Date();
  if (options.touch && isLastSeenStale(record.lastSeenAt, now)) {
    await options.touch(record.tokenId);
  }

  return {
    ok: true,
    identity: {
      tokenId: record.tokenId,
      playerId: record.playerId,
      puuid: record.puuid,
      isAdmin: record.isAdmin,
    },
  };
}

/** Never seen, unparseable, or older than the throttle window. */
export function isLastSeenStale(lastSeenAt: string | null, now: Date): boolean {
  if (lastSeenAt === null) return true;
  const seen = Date.parse(lastSeenAt);
  if (Number.isNaN(seen)) return true;
  return now.getTime() - seen >= LAST_SEEN_THROTTLE_MS;
}

// ---------------------------------------------------------------------------
// Supabase-backed lookup
// ---------------------------------------------------------------------------

/**
 * `companion_tokens` joined to its player. Service role only: anon has no grant on this table
 * at all (`0001_init.sql`).
 */
export function supabaseTokenLookup(client: ServiceClient): CompanionTokenLookup {
  return async (tokenHash) => {
    const { data, error } = await client
      .from('companion_tokens')
      .select('id, player_id, revoked_at, last_seen_at, players!inner(puuid, is_admin)')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (error) throw new Error(`companion token lookup failed: ${error.message}`);
    if (!data) return null;

    return {
      tokenId: data.id,
      playerId: data.player_id,
      puuid: data.players.puuid,
      isAdmin: data.players.is_admin,
      revokedAt: data.revoked_at,
      lastSeenAt: data.last_seen_at,
    };
  };
}

/** Best effort: a failed `last_seen_at` write must never fail the request it belongs to. */
export function supabaseTokenTouch(
  client: ServiceClient,
  now: () => Date = () => new Date(),
): CompanionTokenTouch {
  return async (tokenId) => {
    const { error } = await client
      .from('companion_tokens')
      .update({ last_seen_at: now().toISOString() })
      .eq('id', tokenId);

    if (error) {
      console.warn(`companion token ${tokenId}: last_seen_at update failed: ${error.message}`);
    }
  };
}
