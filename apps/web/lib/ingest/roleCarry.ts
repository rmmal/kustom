import type { RoleValue } from '@customs/db';
import type { ServiceClient } from '../supabase';

/**
 * A role for tonight lasts the **night**, and it lives on the player (M3.6; decision rows
 * 2026-09-09 and 2026-09-10, migration `0009`).
 *
 * Since M2.14 a `lobbies` row is one *game cycle*, and `lobby_members` rows are deleted and
 * recreated by every companion post that changes the roster. So the row is where the balancer
 * reads the choice, and `players.role_tonight` / `players.role_tonight_until` is where the
 * choice is **kept**: this puts it back onto every member row ingest creates, whether that row
 * is the night's next game, a friend rejoining after closing the client lobby for a moment, or
 * a roster the companion re-sent from scratch. One rule for all three.
 *
 * Rows that already exist are never touched: their `role_override` survives the upsert by
 * itself, and re-applying a value over a tap that has just landed is the one thing this must
 * not do. Nothing is ever cleared either — the preference expires by itself at 06:00, and a
 * closed `lobby_members` row keeps its value as the record of what the teams were built from.
 */

export interface CarryOptions {
  lobbyId: string;
  /** The player ids whose rows this post created. Nothing else is written. */
  inserted: readonly string[];
  now: Date;
}

/**
 * Give every newly created member row the role its player picked tonight, if it is still
 * tonight.
 *
 * Called by `ingestLobby` after `replaceMembers`, and only when that post created a row —
 * there is nothing to write to before it, and nothing to do when it created none.
 */
export async function carryRoleOverrides(client: ServiceClient, options: CarryOptions): Promise<void> {
  if (options.inserted.length === 0) return;

  const { data, error } = await client
    .from('players')
    .select('id, role_tonight, role_tonight_until')
    .in('id', [...options.inserted])
    .not('role_tonight', 'is', null)
    // The night's own expiry, compared in the database: a preference from a previous night is
    // simply not selected, and nothing has to sweep it.
    .gt('role_tonight_until', options.now.toISOString());
  if (error) throw new Error(`ingestLobby: role for tonight lookup failed: ${error.message}`);

  // Grouped by role, so the write is at most five statements whatever the size of the lobby.
  const byRole = new Map<RoleValue, string[]>();
  for (const row of data ?? []) {
    if (row.role_tonight === null) continue;
    const group = byRole.get(row.role_tonight) ?? [];
    group.push(row.id);
    byRole.set(row.role_tonight, group);
  }

  for (const [role, playerIds] of byRole) {
    const { error: writeError } = await client
      .from('lobby_members')
      .update({ role_override: role })
      .eq('lobby_id', options.lobbyId)
      .in('player_id', playerIds);
    if (writeError) throw new Error(`ingestLobby: carrying ${role} forward failed: ${writeError.message}`);
  }
}
