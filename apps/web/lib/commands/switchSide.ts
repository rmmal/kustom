import type { Split } from '@customs/core';
import type { SideValue } from '@customs/db';
import type { CompanionCommandKind } from '@customs/db/schemas';
import type { LobbyBalancedEvent } from '../ingest/hooks';
import type { PoolMember } from '../ingest/selection';
import type { ServiceClient } from '../supabase';
import { type CommandGate, isCommandKindEnabled } from './gate';
import { type CommandToQueue, enqueueCommands, supersedeCommands, supersededError } from './queue';

/**
 * What the server queues on the `balanced` transition, and it is exactly one kind:
 * `switch_side`, for a member of the chosen ten whose client has them on the other side
 * (M4.3's rules, wired here because M4.1 owns the queue).
 *
 * **`create_lobby` is never queued from a transition.** Somebody presses a button and a lobby
 * opens; that is M4.2's route, and a lobby that opened itself because ten people happened to be
 * around is the opposite of what this product does. `invite` likewise rides on M4.2's fan-out.
 *
 * Who gets a row, from M4.3's brief, all three clauses:
 *
 * - **a.** an unrevoked companion token seen in the last ten minutes — `last_seen_at` means
 *   "at their PC with League open", which is exactly what the commands poll made it mean;
 * - **b.** a `lobby_members.side` that differs from the side the chosen split gives them;
 * - **c.** a `side` that is **not null**. The easy one to miss: a friend in the spectator slot
 *   who is among the chosen ten has no side, and a toggle cannot seat a spectator. They are
 *   never queued, and the line on the page is what tells them to move.
 *
 * Nobody outside the chosen ten is ever queued — a sitter is not moved by us.
 */

/** An unrevoked token seen this recently means the friend is at their PC with League open. */
export const COMPANION_AROUND_MS = 10 * 60_000;

/** The kinds a lobby transition may touch. `create_lobby` and `invite` are M4.2's, not a transition's. */
export const TRANSITION_COMMAND_KINDS: readonly CompanionCommandKind[] = ['switch_side'];

export interface SwitchSideMove {
  playerId: string;
  puuid: string;
  /** Where the client has them now. Never null: clause (c) drops those before this exists. */
  from: SideValue;
  /** Where the chosen split puts them. */
  to: SideValue;
}

/**
 * Clauses (b) and (c), as a pure function of the split and the ten: who is on the wrong side.
 *
 * Blue is 100 and red is 200, matching the client. The order is the split's own — blue in lane
 * order, then red — so two runs of the same balance queue the same rows in the same order.
 */
export function switchSideMoves(split: Split, playing: readonly PoolMember[]): SwitchSideMove[] {
  const byPuuid = new Map(playing.map((member) => [member.puuid, member]));
  const moves: SwitchSideMove[] = [];

  for (const [side, assignments] of [
    [100, split.blue],
    [200, split.red],
  ] as const) {
    for (const assignment of assignments) {
      const member = byPuuid.get(assignment.puuid);
      // Not one of the ten we know about (cannot happen: the split is built from them), or a
      // spectator / someone the client has not placed yet — clause (c).
      if (member === undefined || member.side === null) continue;
      if (member.side === side) continue;
      moves.push({ playerId: member.playerId, puuid: member.puuid, from: member.side, to: side });
    }
  }

  return moves;
}

export interface QueueSwitchSideResult {
  /** Rows from an earlier split that this write failed with `superseded`. */
  superseded: number;
  /** Rows written now. Zero while the verification gate is off, which is today. */
  queued: number;
  /** Everyone the split moves, before the token check. For the log and the tests. */
  moves: SwitchSideMove[];
}

export interface QueueSwitchSideOptions {
  now?: Date;
  gate?: CommandGate;
}

/**
 * The `balanced` transition's write, in one statement each way: supersede, then queue.
 *
 * **Supersede first, always.** A reroll (M3.2) promotes another split of the same ten without
 * leaving `balanced`, so the rows the old split asked for are still pending; failing them in
 * the same write that queues the new ones is what keeps "at most one pending `switch_side` per
 * player" true and stops anybody being dragged to a side the group rerolled away from.
 *
 * With the gate off — which is every day until the switch-side row in `docs/03-lcu-reference.md`
 * turns green — this writes nothing at all and does not read the database either.
 */
export async function queueSwitchSideForBalance(
  client: ServiceClient,
  event: Pick<LobbyBalancedEvent, 'lobbyId' | 'split' | 'playing'>,
  options: QueueSwitchSideOptions = {},
): Promise<QueueSwitchSideResult> {
  const moves = switchSideMoves(event.split, event.playing);
  if (!isCommandKindEnabled('switch_side', options.gate)) {
    return { superseded: 0, queued: 0, moves };
  }

  const now = options.now ?? new Date();
  const superseded = await supersedeCommands(client, {
    playerIds: event.playing.map((member) => member.playerId),
    kinds: ['switch_side'],
    error: supersededError('another split was chosen'),
    now,
  });

  const around = await playersWithALiveCompanion(
    client,
    moves.map((move) => move.playerId),
    now,
  );

  const commands: CommandToQueue[] = moves
    .filter((move) => around.has(move.playerId))
    .map((move) => ({
      targetPlayerId: move.playerId,
      kind: 'switch_side',
      payload: { targetSide: move.to },
    }));

  const { queued } = await enqueueCommands(client, commands, { now, gate: options.gate });
  if (queued.length > 0 || superseded > 0) {
    console.info(
      `lobby ${event.lobbyId}: queued ${queued.length} switch_side command(s), superseded ${superseded}`,
    );
  }
  return { superseded, queued: queued.length, moves };
}

/** Clause (a): an unrevoked token seen in the last ten minutes. One select, at most ten ids. */
export async function playersWithALiveCompanion(
  client: ServiceClient,
  playerIds: readonly string[],
  now: Date = new Date(),
): Promise<Set<string>> {
  if (playerIds.length === 0) return new Set();

  const seenSince = new Date(now.getTime() - COMPANION_AROUND_MS).toISOString();
  const { data, error } = await client
    .from('companion_tokens')
    .select('player_id')
    .in('player_id', [...playerIds])
    .is('revoked_at', null)
    .gte('last_seen_at', seenSince);
  if (error) throw new Error(`playersWithALiveCompanion: ${error.message}`);
  return new Set((data ?? []).map((row) => row.player_id));
}
