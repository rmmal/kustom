import type { RoleValue } from '@customs/db';
import { nightStart } from '../night';
import type { ServiceClient } from '../supabase';

/**
 * A role for tonight lasts the **night**, not the lobby row (M3.6; decision 2026-09-09,
 * migration `0007`).
 *
 * Since M2.14 a `lobbies` row is one *game cycle*, and the client keeps one `partyId` all
 * night. The original rule — "cleared when the lobby finishes" — would therefore make every
 * friend re-tap between every game, four or five times a night, in a product whose whole claim
 * is that nobody does anything. So when ingest opens the night's next cycle for a party, it
 * copies each member's `role_override` forward from that party's previous cycle, provided that
 * cycle started inside the current night.
 *
 * Nothing is ever cleared: the closed row keeps its value as the record of what the teams were
 * built from, and the first lobby of the next night simply has nothing to copy from.
 *
 * The rule is a pure function ({@link carryableOverrides}) and the I/O is one call around it,
 * so "what a new night carries" is a unit test rather than a night of waiting.
 */

export interface CarryInput {
  /** The party's previous cycle, or `null` when this is the party's first lobby ever. */
  previousLobby: { createdAt: string } | null;
  /** Every non-null override on that previous cycle's rows. */
  overrides: readonly { playerId: string; role: RoleValue }[];
  /** Who is in the new cycle: somebody who has gone home carries nothing. */
  memberIds: readonly string[];
  /** 06:00 of the night the new cycle belongs to (`lib/night.ts`). */
  nightStart: Date;
}

/**
 * The overrides the new cycle inherits, grouped by role so the write is at most five
 * statements whatever the size of the lobby.
 */
export function carryableOverrides(input: CarryInput): Map<RoleValue, string[]> {
  const carried = new Map<RoleValue, string[]>();
  if (input.previousLobby === null) return carried;

  const startedAt = Date.parse(input.previousLobby.createdAt);
  // A new night starts empty. Also the guard for a clock we cannot read: an unparseable
  // timestamp carries nothing rather than carrying everything forever.
  if (!Number.isFinite(startedAt) || startedAt < input.nightStart.getTime()) return carried;

  const members = new Set(input.memberIds);
  for (const { playerId, role } of input.overrides) {
    if (!members.has(playerId)) continue;
    const group = carried.get(role) ?? [];
    group.push(playerId);
    carried.set(role, group);
  }

  return carried;
}

export interface CarryOptions {
  lobbyId: string;
  partyId: string;
  now: Date;
  timeZone: string;
}

/**
 * Copy the party's previous cycle's role overrides onto the cycle that has just been opened.
 *
 * Called by `ingestLobby` **only for a lobby row it created**, after the members are in place:
 * a re-post of an existing cycle must not re-apply an old value over a tap that has landed
 * since, and there would be no row to write to before `replaceMembers` runs.
 */
export async function carryRoleOverrides(client: ServiceClient, options: CarryOptions): Promise<void> {
  const { data: previous, error: lobbyError } = await client
    .from('lobbies')
    .select('id, created_at')
    .eq('lcu_party_id', options.partyId)
    .neq('id', options.lobbyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lobbyError) throw new Error(`ingestLobby: previous cycle lookup failed: ${lobbyError.message}`);
  if (!previous) return;

  const { data: overrides, error: overrideError } = await client
    .from('lobby_members')
    .select('player_id, role_override')
    .eq('lobby_id', previous.id)
    .not('role_override', 'is', null);
  if (overrideError) throw new Error(`ingestLobby: override lookup failed: ${overrideError.message}`);
  if ((overrides ?? []).length === 0) return;

  const { data: members, error: memberError } = await client
    .from('lobby_members')
    .select('player_id')
    .eq('lobby_id', options.lobbyId);
  if (memberError) throw new Error(`ingestLobby: member lookup failed: ${memberError.message}`);

  const carried = carryableOverrides({
    previousLobby: { createdAt: previous.created_at },
    overrides: (overrides ?? []).flatMap((row) =>
      row.role_override === null ? [] : [{ playerId: row.player_id, role: row.role_override }],
    ),
    memberIds: (members ?? []).map((row) => row.player_id),
    nightStart: nightStart(options.now, options.timeZone),
  });

  for (const [role, playerIds] of carried) {
    const { error } = await client
      .from('lobby_members')
      .update({ role_override: role })
      .eq('lobby_id', options.lobbyId)
      .in('player_id', playerIds);
    if (error) throw new Error(`ingestLobby: carrying ${role} forward failed: ${error.message}`);
  }
}
