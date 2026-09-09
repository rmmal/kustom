import type { Role } from '@customs/core';
import type { ServiceClient } from '../supabase';
import { type AdminWriteResult, writeFailed, writeOk } from './result';

/**
 * Reads and writes behind `/admin/players`.
 *
 * Every function takes the service-role client as its first argument: the pages and the route
 * handlers pass the one they were given, and the integration tests pass one built from the
 * local stack. Nothing here decides who may call it — `lib/adminAuth.ts` has already done that.
 *
 * These read `players`, not `players_public`, because `discord_id` is the whole point of the
 * page and only the service role can see it (`0001_init.sql`).
 */

export interface AdminRating {
  mu: number;
  sigma: number;
  games: number;
  wins: number;
}

export interface AdminPlayerRow {
  id: string;
  puuid: string;
  displayName: string | null;
  gameName: string | null;
  tagLine: string | null;
  discordId: string | null;
  isAdmin: boolean;
  mainRole: Role | null;
  secondaryRole: Role | null;
  rankTier: string | null;
  rankDivision: string | null;
  rankLp: number | null;
  /**
   * Backfill approval (M5.1). Three states, and the page renders them as three: both null is
   * `off`, a request with no approval is `asked <date>`, an approval is `on since <date>`.
   * Revoking clears `backfillApprovedAt` and leaves the request standing.
   */
  backfillRequestedAt: string | null;
  backfillApprovedAt: string | null;
  /** The active season's rating, or null when the player has never been rated. */
  rating: AdminRating | null;
}

/**
 * Every player, newest last name first. There are ten to twenty people in this group, so
 * there is no pagination and there does not need to be; the cap is PostgREST's `max_rows`
 * (1000) and a comment in `docs/02-milestones.md` will be needed long before we hit it.
 */
export async function listAdminPlayers(
  client: ServiceClient,
  seasonId: string | null,
): Promise<AdminPlayerRow[]> {
  const query = client
    .from('players')
    .select(
      'id, puuid, display_name, game_name, tag_line, discord_id, is_admin, main_role, secondary_role, rank_tier, rank_division, rank_lp, backfill_requested_at, backfill_approved_at, ratings(season_id, mu, sigma, games, wins)',
    )
    .order('display_name', { ascending: true, nullsFirst: false })
    .order('puuid', { ascending: true });

  const { data, error } = seasonId === null ? await query : await query.eq('ratings.season_id', seasonId);
  if (error) throw new Error(`listAdminPlayers failed: ${error.message}`);

  return (data ?? []).map((row) => {
    const rating = row.ratings.find((entry) => seasonId === null || entry.season_id === seasonId) ?? null;
    return {
      id: row.id,
      puuid: row.puuid,
      displayName: row.display_name,
      gameName: row.game_name,
      tagLine: row.tag_line,
      discordId: row.discord_id,
      isAdmin: row.is_admin,
      mainRole: row.main_role,
      secondaryRole: row.secondary_role,
      rankTier: row.rank_tier,
      rankDivision: row.rank_division,
      rankLp: row.rank_lp,
      backfillRequestedAt: row.backfill_requested_at,
      backfillApprovedAt: row.backfill_approved_at,
      rating:
        rating === null
          ? null
          : { mu: rating.mu, sigma: rating.sigma, games: rating.games, wins: rating.wins },
    };
  });
}

export interface SetPlayerRolesInput {
  playerId: string;
  /** `null` is "flexible" (M1.4). Clearing a role back to null is the point of this call. */
  mainRole: Role | null;
  secondaryRole: Role | null;
}

/**
 * Sets both roles at once, `null` included. Both columns are always written, so the form's
 * "none" option genuinely clears a role rather than being ignored as "no change".
 */
export async function setPlayerRoles(
  client: ServiceClient,
  input: SetPlayerRolesInput,
): Promise<AdminWriteResult<AdminPlayerRow['id']>> {
  if (input.mainRole !== null && input.mainRole === input.secondaryRole) {
    return writeFailed(400, 'main and secondary role must differ');
  }

  const { data, error } = await client
    .from('players')
    .update({ main_role: input.mainRole, secondary_role: input.secondaryRole })
    .eq('id', input.playerId)
    .select('id')
    .maybeSingle();

  if (error) throw new Error(`setPlayerRoles failed: ${error.message}`);
  if (data === null) return writeFailed(404, 'no such player');
  return writeOk(data.id);
}

export interface SetPlayerDisplayNameInput {
  playerId: string;
  /** `null` (the form posts `""`) puts the row back on automatic. */
  displayName: string | null;
}

/**
 * The name the group actually calls someone (M1.7).
 *
 * This is the only override there is: `ensurePlayers` fills `display_name` from the Riot
 * `gameName` and keeps following it *while it still equals the stored `game_name`*, so writing
 * anything else here freezes the name against every later rename, and writing null hands it
 * back to the client at the next report (`lib/ingest/players.ts`, `isDisplayNameAutomatic`).
 *
 * Nothing here compares the new name to `game_name`: setting the name to exactly the current
 * `gameName` is indistinguishable from automatic *by design* — that is the whole rule, and it
 * degrades to "you typed what it already says", not to a lost override.
 */
export async function setPlayerDisplayName(
  client: ServiceClient,
  input: SetPlayerDisplayNameInput,
): Promise<AdminWriteResult<string>> {
  if (input.displayName !== null && input.displayName.length > 40) {
    return writeFailed(400, 'that name is too long for a team sheet; keep it under 40 characters');
  }

  const { data, error } = await client
    .from('players')
    .update({ display_name: input.displayName })
    .eq('id', input.playerId)
    .select('id')
    .maybeSingle();

  if (error) throw new Error(`setPlayerDisplayName failed: ${error.message}`);
  if (data === null) return writeFailed(404, 'no such player');
  return writeOk(data.id);
}

export interface SetPlayerDiscordIdInput {
  playerId: string;
  /** `null` unlinks. */
  discordId: string | null;
}

/**
 * Links or unlinks a Discord id. `players.discord_id` is unique, so linking one that already
 * belongs to someone else is a 409 rather than a database error page: an admin who mistypes a
 * snowflake should be told, not shown a stack trace.
 */
export async function setPlayerDiscordId(
  client: ServiceClient,
  input: SetPlayerDiscordIdInput,
): Promise<AdminWriteResult<string>> {
  if (input.discordId !== null) {
    const { data: holder, error: holderError } = await client
      .from('players')
      .select('id, puuid')
      .eq('discord_id', input.discordId)
      .maybeSingle();
    if (holderError) throw new Error(`setPlayerDiscordId lookup failed: ${holderError.message}`);
    if (holder && holder.id !== input.playerId) {
      return writeFailed(409, `that Discord id is already linked to ${holder.puuid}`);
    }
  }

  const { data, error } = await client
    .from('players')
    .update({ discord_id: input.discordId })
    .eq('id', input.playerId)
    .select('id')
    .maybeSingle();

  if (error) throw new Error(`setPlayerDiscordId failed: ${error.message}`);
  if (data === null) return writeFailed(404, 'no such player');
  return writeOk(data.id);
}

export interface SetPlayerAdminInput {
  playerId: string;
  isAdmin: boolean;
  /** The admin making the change, from the session. Never from the request body. */
  actingPlayerId: string;
}

/**
 * An admin may promote or demote anyone except themselves.
 *
 * Pure, so the rule is a unit test rather than an integration test: the last admin demoting
 * themselves would lock everyone out of `/admin`, and the only way back would be redeploying
 * with `BOOTSTRAP_ADMIN_PUUID` set.
 */
export function isSelfDemotion(input: SetPlayerAdminInput): boolean {
  return !input.isAdmin && input.playerId === input.actingPlayerId;
}

export async function setPlayerAdmin(
  client: ServiceClient,
  input: SetPlayerAdminInput,
): Promise<AdminWriteResult<string>> {
  if (isSelfDemotion(input)) {
    return writeFailed(403, 'you cannot remove your own admin flag; ask another admin');
  }

  const { data, error } = await client
    .from('players')
    .update({ is_admin: input.isAdmin })
    .eq('id', input.playerId)
    .select('id')
    .maybeSingle();

  if (error) throw new Error(`setPlayerAdmin failed: ${error.message}`);
  if (data === null) return writeFailed(404, 'no such player');
  return writeOk(data.id);
}

export interface SetPlayerBackfillInput {
  playerId: string;
  /** The target state, not a toggle: two tabs cannot flip each other's answer. */
  approved: boolean;
  /** Injected so the integration tests can pin the timestamp. */
  now?: Date;
}

/**
 * Allow or revoke backfill for one player (M5.1).
 *
 * Approving stamps `backfill_approved_at`; revoking sets it back to null and the next
 * `POST /api/companion/backfill/scan` answers `approved: false`. The request timestamp is
 * never touched here — it is the record of when that friend's PC first asked, and an admin who
 * revokes has not un-asked anything.
 *
 * Re-approving an already-approved player moves the date. That is deliberate and harmless: the
 * column is a note for a human, and nothing reads it but "is it null".
 */
export async function setPlayerBackfill(
  client: ServiceClient,
  input: SetPlayerBackfillInput,
): Promise<AdminWriteResult<string>> {
  const { data, error } = await client
    .from('players')
    .update({ backfill_approved_at: input.approved ? (input.now ?? new Date()).toISOString() : null })
    .eq('id', input.playerId)
    .select('id')
    .maybeSingle();

  if (error) throw new Error(`setPlayerBackfill failed: ${error.message}`);
  if (data === null) return writeFailed(404, 'no such player');
  return writeOk(data.id);
}
