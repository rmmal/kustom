import { readServerEnv } from './env';
import type { ServiceClient } from './supabase';

/**
 * The first admin (`docs/04-decisions.md`, 2026-09-08): a migration cannot read the deployment
 * environment, so `public.bootstrap_admin(puuid)` does the insert-or-promote and the API calls
 * it with `BOOTSTRAP_ADMIN_PUUID`. The function is idempotent, so calling it again is a no-op.
 *
 * Run lazily on the first companion or admin request of a process rather than from
 * `instrumentation.ts`: a build-time or cold-start hook would have to cope with the database
 * being unreachable, and nothing needs the admin to exist before the first request does.
 *
 * The chicken and egg (M1.6): the first admin is seeded by PUUID, but the admin gate matches a
 * session to a player by `players.discord_id`, so that first admin cannot sign in until someone
 * links their Discord id — and only an admin can do the linking. `BOOTSTRAP_ADMIN_DISCORD_ID`
 * breaks the loop: set both variables once, deploy, sign in. Linking is idempotent and never
 * steals a Discord id that already belongs to another player.
 */

let inFlight: Promise<void> | null = null;

/** Runs `bootstrap_admin` at most once per process. Never throws: a failure only logs. */
export function ensureBootstrapAdmin(client: ServiceClient): Promise<void> {
  inFlight ??= runBootstrapAdmin(client);
  return inFlight;
}

/** Tests only: forget that this process has already bootstrapped. */
export function resetBootstrapAdmin(): void {
  inFlight = null;
}

async function runBootstrapAdmin(client: ServiceClient): Promise<void> {
  let puuid: string | undefined;
  try {
    puuid = readServerEnv().BOOTSTRAP_ADMIN_PUUID;
  } catch {
    // Not configured at all. The caller is about to fail on the client anyway.
    return;
  }

  if (!puuid) return;

  const { data, error } = await client.rpc('bootstrap_admin', { p_puuid: puuid });
  if (error) {
    console.warn(`bootstrap_admin failed for ${puuid}: ${error.message}`);
    return;
  }

  let discordId: string | undefined;
  try {
    discordId = readServerEnv().BOOTSTRAP_ADMIN_DISCORD_ID;
  } catch {
    return;
  }
  if (!discordId || data === null) return;

  await linkBootstrapDiscordId(client, { puuid, playerId: data.id, discordId });
}

interface LinkBootstrapInput {
  puuid: string;
  playerId: string;
  discordId: string;
}

/**
 * Links `BOOTSTRAP_ADMIN_DISCORD_ID` to the bootstrap player, once. A no-op when the link is
 * already there, and a warning (never a write) when that Discord id belongs to someone else or
 * the bootstrap player is already linked to a different one — an env variable must not be able
 * to move an existing link out from under a player.
 */
async function linkBootstrapDiscordId(client: ServiceClient, input: LinkBootstrapInput): Promise<void> {
  // Two reads rather than one `or(...)`: PostgREST's or-filter is a string grammar, and the
  // Discord id comes from the environment, so it is not something to interpolate into one.
  const { data: self, error: selfError } = await client
    .from('players')
    .select('id, puuid, discord_id')
    .eq('id', input.playerId)
    .maybeSingle();
  const { data: holder, error: holderError } = await client
    .from('players')
    .select('id, puuid')
    .eq('discord_id', input.discordId)
    .maybeSingle();

  const readError = selfError ?? holderError;
  if (readError) {
    console.warn(`bootstrap discord link: lookup failed: ${readError.message}`);
    return;
  }

  if (holder && holder.id !== input.playerId) {
    console.warn(
      `bootstrap discord link: ${input.discordId} is already linked to player ${holder.puuid}; not moving it`,
    );
    return;
  }
  if (!self) return;
  if (self.discord_id === input.discordId) return;
  if (self.discord_id !== null) {
    console.warn(
      `bootstrap discord link: ${input.puuid} is already linked to another Discord id; leaving it alone`,
    );
    return;
  }

  const { error } = await client
    .from('players')
    .update({ discord_id: input.discordId })
    .eq('id', input.playerId)
    .is('discord_id', null);

  if (error) {
    console.warn(`bootstrap discord link failed for ${input.puuid}: ${error.message}`);
  }
}
