import type { RoleValue } from '@customs/db';
import { nightStart } from '../night';
import type { ServiceClient } from '../supabase';

/**
 * A role for tonight lasts the **night**, not the lobby row (M3.6; decision 2026-09-09,
 * migration `0009`).
 *
 * Since M2.14 a `lobbies` row is one *game cycle*, and the client keeps one `partyId` all
 * night. The original rule — "cleared when the lobby finishes" — would make every friend
 * re-tap between every game, four or five times a night, in a product whose whole claim is
 * that nobody does anything. So a row that ingest **creates** inherits whatever that player had
 * picked, from one of two places:
 *
 *   1. **a row this same post is deleting** — a friend who drops out of the client lobby and
 *      rejoins is a delete and then an insert, and the pre-delete read is the only memory of
 *      what they picked;
 *   2. **the party's previous cycle**, provided that cycle started inside the current night —
 *      the between-games case, and the reason nobody re-taps after a game.
 *
 * Rows that already existed are never touched: their `role_override` survives the upsert by
 * itself, and re-applying an old value over a tap that has just landed is the one thing this
 * must not do. Nothing is ever cleared, either: a closed row keeps its value as the record of
 * what the teams were built from, and the first lobby of the next night has nothing to copy.
 *
 * The rule is a pure function ({@link carryableOverrides}) and the I/O is two reads and at most
 * five grouped updates around it, so "what a new night carries" is a unit test rather than a
 * night of waiting.
 */

export interface CarryInput {
  /** The party's previous cycle, or `null` when this is the party's first lobby ever. */
  previousLobby: { createdAt: string } | null;
  /** Every non-null override on that previous cycle's rows. */
  overrides: readonly { playerId: string; role: RoleValue }[];
  /** Overrides read off the rows this post is deleting. They win: they are from tonight's own
   *  cycle, while the previous cycle's are older by a game. */
  departed?: ReadonlyMap<string, RoleValue>;
  /** Rows this post created. Nothing else is written, whatever the sources hold. */
  memberIds: readonly string[];
  /** 06:00 of the night the new cycle belongs to (`lib/night.ts`). */
  nightStart: Date;
}

/**
 * The overrides the new rows inherit, grouped by role so the write is at most five statements
 * whatever the size of the lobby.
 */
export function carryableOverrides(input: CarryInput): Map<RoleValue, string[]> {
  const carried = new Map<RoleValue, string[]>();
  const source = new Map<string, RoleValue>();

  const startedAt = input.previousLobby === null ? Number.NaN : Date.parse(input.previousLobby.createdAt);
  // A new night starts empty. Also the guard for a clock we cannot read: an unparseable
  // timestamp carries nothing rather than carrying everything forever.
  if (Number.isFinite(startedAt) && startedAt >= input.nightStart.getTime()) {
    for (const { playerId, role } of input.overrides) source.set(playerId, role);
  }

  // Second, so it overwrites: a row deleted a moment ago in this same cycle is newer than
  // anything the previous cycle holds.
  for (const [playerId, role] of input.departed ?? []) source.set(playerId, role);

  for (const playerId of input.memberIds) {
    const role = source.get(playerId);
    if (role === undefined) continue;
    const group = carried.get(role) ?? [];
    group.push(playerId);
    carried.set(role, group);
  }

  return carried;
}

export interface CarryOptions {
  lobbyId: string;
  partyId: string;
  /** The player ids whose rows this post created. */
  inserted: readonly string[];
  /** The overrides of the rows this post deleted, read before the delete. */
  departed: ReadonlyMap<string, RoleValue>;
  now: Date;
  timeZone: string;
}

/**
 * Put back the role each newly created member row had picked, if it had picked one.
 *
 * Called by `ingestLobby` after `replaceMembers`, and only when that post created a row —
 * there is nothing to write to before it, and nothing to do when it created none.
 */
export async function carryRoleOverrides(client: ServiceClient, options: CarryOptions): Promise<void> {
  if (options.inserted.length === 0) return;

  const previous = await selectPreviousCycle(client, options);
  const overrides = previous === null ? [] : await selectOverrides(client, previous.id);

  const carried = carryableOverrides({
    previousLobby: previous === null ? null : { createdAt: previous.created_at },
    overrides,
    departed: options.departed,
    memberIds: options.inserted,
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

async function selectPreviousCycle(
  client: ServiceClient,
  options: CarryOptions,
): Promise<{ id: string; created_at: string } | null> {
  const { data, error } = await client
    .from('lobbies')
    .select('id, created_at')
    .eq('lcu_party_id', options.partyId)
    .neq('id', options.lobbyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`ingestLobby: previous cycle lookup failed: ${error.message}`);
  return data ?? null;
}

async function selectOverrides(
  client: ServiceClient,
  lobbyId: string,
): Promise<{ playerId: string; role: RoleValue }[]> {
  const { data, error } = await client
    .from('lobby_members')
    .select('player_id, role_override')
    .eq('lobby_id', lobbyId)
    .not('role_override', 'is', null);
  if (error) throw new Error(`ingestLobby: override lookup failed: ${error.message}`);

  return (data ?? []).flatMap((row) =>
    row.role_override === null ? [] : [{ playerId: row.player_id, role: row.role_override }],
  );
}
