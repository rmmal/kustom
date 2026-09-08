import { type Assignment, displayRating, isOffRole, type Role } from '@customs/core';
import type { PoolMember, SeatMove } from '../ingest/selection';
import type { ServiceClient } from '../supabase';
import type { PlayerName, SeatLine, TeamsEmbedInput, TeamsPlayer } from './embeds';

/**
 * Rows and events in, embed inputs out (M3.1).
 *
 * The `build*` function is pure and are where every rule about what the embeds show
 * lives; the `load*` functions are the queries that feed them. Names are read here rather
 * than taken from the event, because a name can arrive between the balance and the post
 * (M2.4's rank sweep, or the first end-of-game block) and the embed should print the newest
 * one we have. Nothing is written back: `Someone` is a rendering fallback (M3.10), not a row.
 */

/** Everything the teams embed needs that is not a name. `LobbyBalancedEvent` satisfies it. */
export interface TeamsSource {
  /** The chosen split's two sides. A `Split` from core satisfies it, and so does a stored row. */
  split: { blue: readonly Assignment[]; red: readonly Assignment[] };
  explanation: string;
  lobbyName: string | null;
  lobbyPassword: string | null;
  playing: readonly PoolMember[];
  sitters: readonly PoolMember[];
  seatMoves: readonly SeatMove[];
  tiedOnGames: boolean;
}

export interface EmbedContext {
  /** The tonight page, or `undefined` when there is no honest URL to post (M3.1). */
  url?: string | undefined;
  timestamp: string;
}

export type NameLookup = ReadonlyMap<string, PlayerName>;

/**
 * The teams embed input. Pure: the same source and the same names give the same object.
 *
 * Throws when the chosen split names a player who is not in `playing` — that cannot happen
 * (both come out of one balance) and a lobby hook that throws is one log line, which is a
 * better answer than an embed with a made-up rating in it.
 */
export function buildTeamsInput(
  source: TeamsSource,
  names: NameLookup,
  context: EmbedContext,
): TeamsEmbedInput {
  const byPuuid = new Map(source.playing.map((member) => [member.puuid, member]));

  const side = (assignments: readonly { puuid: string; role: Role }[]): TeamsPlayer[] =>
    assignments.map(({ puuid, role }) => {
      const member = byPuuid.get(puuid);
      if (member === undefined) {
        throw new Error(`teams embed: the chosen split names ${puuid}, who is not among the ten`);
      }
      return {
        puuid,
        name: names.get(puuid) ?? null,
        role,
        rating: displayRating(member.mu),
        // Core's rule, not a copy of it: the scorer, the explanation and this line agree
        // about who is off-role because all three ask the same function.
        offRole: isOffRole(member, role),
      };
    });

  return {
    blue: side(source.split.blue),
    red: side(source.split.red),
    explanation: source.explanation,
    sitOut:
      source.sitters.length === 0
        ? null
        : {
            names: source.sitters.map((member) => names.get(member.puuid) ?? null),
            reason: source.tiedOnGames ? 'longest-since' : 'most-games',
          },
    seats: source.seatMoves.map((move) => toSeatLine(move, names)),
    lobby: { name: source.lobbyName, password: source.lobbyPassword },
    url: context.url,
    timestamp: context.timestamp,
  };
}

function toSeatLine(move: SeatMove, names: NameLookup): SeatLine {
  const mover = names.get(move.mover.puuid) ?? null;
  if (move.sitter === null) return { kind: 'open-slot', mover };
  return { kind: 'swap', sitter: names.get(move.sitter.puuid) ?? null, mover };
}

/**
 * The newest display name we have for each puuid, `null` for the ones we have none for.
 *
 * Reads `players` with the service client. `players_public` is the same rows minus
 * `discord_id` and exists for the anon key; from inside the API the base table is the
 * shorter path and neither name column is a secret.
 */
export async function loadNames(client: ServiceClient, puuids: readonly string[]): Promise<NameLookup> {
  const unique = [...new Set(puuids)];
  const names = new Map<string, PlayerName>();
  if (unique.length === 0) return names;

  const { data, error } = await client
    .from('players')
    .select('puuid, display_name, game_name')
    .in('puuid', unique);
  if (error) throw new Error(`discord: name lookup failed: ${error.message}`);

  for (const row of data ?? []) {
    names.set(row.puuid, row.display_name ?? row.game_name ?? null);
  }
  return names;
}

/** Everyone the teams embed prints: the ten, plus the sitters and the movers. */
export function teamsPuuids(source: TeamsSource): string[] {
  return [
    ...source.playing.map((member) => member.puuid),
    ...source.sitters.map((member) => member.puuid),
    ...source.seatMoves.flatMap((move) => (move.sitter === null ? [] : [move.sitter.puuid])),
    ...source.seatMoves.map((move) => move.mover.puuid),
  ];
}

const ROLE_VALUES: readonly string[] = ['top', 'jungle', 'mid', 'adc', 'support'];

/** `splits.blue` is jsonb. Read what we recognise and drop the rest; never throw on a row. */
export function readAssignments(value: unknown): { puuid: string; role: Role }[] {
  if (!Array.isArray(value)) return [];
  const assignments: { puuid: string; role: Role }[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { puuid, role } = entry as { puuid?: unknown; role?: unknown };
    if (typeof puuid !== 'string' || puuid.length === 0) continue;
    if (typeof role !== 'string' || !ROLE_VALUES.includes(role)) continue;
    assignments.push({ puuid, role: role as Role });
  }
  return assignments;
}
