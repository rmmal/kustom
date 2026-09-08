import { ensureBootstrapAdmin } from './bootstrapAdmin';
import type { ServiceClient } from './supabase';
import { type AuthClient, type CookieJar, createAuthClient } from './supabaseAuth';

/**
 * The admin gate (`CLAUDE.md` "Conventions": admin routes use the Supabase session and
 * `players.is_admin`).
 *
 * Two steps, both server-side, never a client claim:
 *
 *   1. The session cookies are exchanged for a **verified** user (`auth.getUser()` asks the
 *      auth server; `getSession()` would only decode a cookie).
 *   2. The Discord snowflake on that user's *identity* is matched against
 *      `players.discord_id` with the service-role client, and `players.is_admin` decides.
 *
 * No session is 401. A session that is not an admin — for any reason: no Discord identity, no
 * player linked to it, `is_admin` false — is 403. The reason string says which, because the
 * only people who see it are the five people in the group.
 *
 * The decision itself is a pure function over two injected lookups so it can be tested without
 * a database or an OAuth round trip; the Supabase-backed lookups are at the bottom.
 */

/** The Discord snowflake lives on the identity, not in user metadata. See {@link discordIdFromUser}. */
export interface SessionIdentityLike {
  /** The provider's own user id. For Discord this is the snowflake. */
  id: string;
  provider: string;
  identity_data?: Record<string, unknown> | undefined;
}

export interface SessionUserLike {
  id: string;
  email?: string | null | undefined;
  identities?: SessionIdentityLike[] | null | undefined;
  /** Display only, and never trusted: a signed-in user can write this with `auth.updateUser()`. */
  user_metadata?: Record<string, unknown> | undefined;
}

/** The player row behind an admin session. */
export interface AdminIdentity {
  userId: string;
  discordId: string;
  playerId: string;
  puuid: string;
  displayName: string | null;
  /** From the session, for the "signed in as" line only. */
  email: string | null;
  discordName: string | null;
}

export interface AdminPlayerRecord {
  playerId: string;
  puuid: string;
  displayName: string | null;
  isAdmin: boolean;
}

export type AdminAuthResult =
  | { ok: true; admin: AdminIdentity }
  | { ok: false; status: 401 | 403; error: string };

export type SessionUserResolver = () => Promise<SessionUserLike | null>;
export type AdminPlayerLookup = (discordId: string) => Promise<AdminPlayerRecord | null>;

export interface AuthorizeAdminOptions {
  resolveSessionUser: SessionUserResolver;
  lookupPlayerByDiscordId: AdminPlayerLookup;
}

/**
 * Session in, admin identity or 401/403 out. Pure apart from the two injected lookups.
 */
export async function authorizeAdmin(options: AuthorizeAdminOptions): Promise<AdminAuthResult> {
  const user = await options.resolveSessionUser();
  if (user === null) {
    return { ok: false, status: 401, error: 'sign in required' };
  }

  const discordId = discordIdFromUser(user);
  if (discordId === null) {
    return { ok: false, status: 403, error: 'this session has no Discord identity' };
  }

  const player = await options.lookupPlayerByDiscordId(discordId);
  if (player === null) {
    return { ok: false, status: 403, error: 'no player is linked to this Discord account' };
  }

  if (!player.isAdmin) {
    return { ok: false, status: 403, error: 'not an admin' };
  }

  return {
    ok: true,
    admin: {
      userId: user.id,
      discordId,
      playerId: player.playerId,
      puuid: player.puuid,
      displayName: player.displayName,
      email: user.email ?? null,
      discordName: discordNameFromUser(user),
    },
  };
}

/**
 * The Discord user id (snowflake) of a signed-in user, or null.
 *
 * Read from `user.identities[]` where `provider === 'discord'`: `UserIdentity.id` is
 * GoTrue's `auth.identities.provider_id`, i.e. the id the provider gave us, and nothing but
 * an OAuth round trip can write it. `user_metadata.provider_id` carries the same snowflake but
 * is **user-writable** through `auth.updateUser({ data })`, so trusting it would let any
 * Discord account claim an admin's snowflake. It is only ever read for display here.
 */
export function discordIdFromUser(user: SessionUserLike): string | null {
  for (const identity of user.identities ?? []) {
    if (identity.provider !== 'discord') continue;
    const fromIdentity = nonEmpty(identity.id);
    if (fromIdentity !== null) return fromIdentity;
    // Older GoTrue rows carry the snowflake only inside identity_data.
    const data = identity.identity_data ?? {};
    return nonEmpty(data.provider_id) ?? nonEmpty(data.sub);
  }
  return null;
}

/** Display only. Whatever Discord called them at sign-in; never used to identify anyone. */
export function discordNameFromUser(user: SessionUserLike): string | null {
  for (const identity of user.identities ?? []) {
    if (identity.provider !== 'discord') continue;
    const data = identity.identity_data ?? {};
    return nonEmpty(data.full_name) ?? nonEmpty(data.name) ?? nonEmpty(data.user_name);
  }
  const metadata = user.user_metadata ?? {};
  return nonEmpty(metadata.full_name) ?? nonEmpty(metadata.name) ?? nonEmpty(metadata.user_name);
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

// ---------------------------------------------------------------------------
// Supabase-backed lookups
// ---------------------------------------------------------------------------

/** `auth.getUser()`, which verifies the JWT with the auth server rather than trusting a cookie. */
export function supabaseSessionUser(client: AuthClient): SessionUserResolver {
  return async () => {
    const { data, error } = await client.auth.getUser();
    if (error !== null || data.user === null) return null;
    return data.user;
  };
}

/**
 * `players` by `discord_id`, read with the **service role**: anon and authenticated have no
 * select privilege on that table at all (`0001_init.sql`), which is exactly why `discord_id`
 * lives there and not in `players_public`.
 */
export function supabaseAdminLookup(client: ServiceClient): AdminPlayerLookup {
  return async (discordId) => {
    const { data, error } = await client
      .from('players')
      .select('id, puuid, display_name, is_admin')
      .eq('discord_id', discordId)
      .maybeSingle();

    if (error) throw new Error(`admin player lookup failed: ${error.message}`);
    if (!data) return null;

    return {
      playerId: data.id,
      puuid: data.puuid,
      displayName: data.display_name,
      isAdmin: data.is_admin,
    };
  };
}

/** Everything the gate needs, wired to Supabase. */
export async function resolveAdmin(jar: CookieJar, client: ServiceClient): Promise<AdminAuthResult> {
  await ensureBootstrapAdmin(client);

  return authorizeAdmin({
    resolveSessionUser: supabaseSessionUser(createAuthClient(jar)),
    lookupPlayerByDiscordId: supabaseAdminLookup(client),
  });
}
