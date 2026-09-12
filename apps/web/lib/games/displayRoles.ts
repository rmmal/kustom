import type { RoleValue } from '@customs/db';
import { LANE_ORDER } from '../laneOrder';
import type { RawGameFacts, RawPlayerFacts } from '../stats/rawFacts';
import type { StatsGame, StatsRow } from '../stats/types';

/**
 * Display roles for a scoreboard (`/games`, `/fun` This game).
 *
 * Stored `game_players.role` wins. A backfilled row is null (M5.1), so this
 * fills from `games.raw` without writing anything back and without guessing
 * from the champion (M2.10). `/stats` and role inference never see this.
 *
 * Sources, in order: the stored role, EOG `detectedTeamPosition`, Smite,
 * the few `timeline.lane`/`role` pairs the 16.17 fixtures did not refute,
 * then a leftover unique lane on a five-seat Rift side.
 */

/**
 * Pairs that agreed with live `detectedTeamPosition` in the documented
 * 5v5 detail, or that name a role the old vocabulary actually meant.
 * `JUNGLE+NONE` and `TOP+SOLO` are left unmapped — those two lied.
 */
const SAFE_TIMELINE: Readonly<Record<string, RoleValue>> = {
  'MIDDLE+SOLO': 'mid',
  'BOTTOM+CARRY': 'adc',
  'BOTTOM+SUPPORT': 'support',
  'BOTTOM+DUO_SUPPORT': 'support',
};

const SUPPORT_CS = 50;
const LANE_CS = 80;

export function withDisplayRoles(game: StatsGame): StatsRow[] {
  const out: StatsRow[] = [];
  for (const side of [100, 200] as const) {
    const seats = game.rows.filter((row) => row.side === side);
    const roles = displayRolesForSide(seats, game.rawFacts, game.gameMode);
    for (const row of seats) {
      out.push({ ...row, role: roles.get(row.puuid) ?? row.role });
    }
  }
  return out;
}

export function displayRolesForSide(
  seats: readonly StatsRow[],
  facts: RawGameFacts | null | undefined,
  gameMode: string | null | undefined,
): Map<string, RoleValue | null> {
  const aram = gameMode === 'ARAM';
  const hints = seats.map((row) => ({
    puuid: row.puuid,
    role: aram ? row.role : hintRole(row.role, facts?.byPuuid[row.puuid]),
    cs: row.cs,
  }));

  if (!aram && seats.length === 5) {
    fillSupportFromCs(hints);
    fillLeftoverLane(hints);
  }

  return new Map(hints.map((seat) => [seat.puuid, seat.role]));
}

function hintRole(stored: RoleValue | null, extras: RawPlayerFacts | undefined): RoleValue | null {
  if (stored !== null) return stored;
  if (extras === undefined) return null;
  if (extras.role !== null) return extras.role;
  if (extras.smite) return 'jungle';
  const pair = `${(extras.timelineLane ?? '').trim().toUpperCase()}+${(extras.timelineRole ?? '').trim().toUpperCase()}`;
  return SAFE_TIMELINE[pair] ?? null;
}

function fillSupportFromCs(hints: { puuid: string; role: RoleValue | null; cs: number }[]): void {
  if (hints.some((seat) => seat.role === 'support')) return;
  const ranked = [...hints].sort((a, b) => a.cs - b.cs || a.puuid.localeCompare(b.puuid));
  const lowest = ranked[0];
  const next = ranked[1];
  if (lowest === undefined || next === undefined) return;
  if (lowest.role !== null) return;
  if (lowest.cs < SUPPORT_CS && next.cs >= LANE_CS) lowest.role = 'support';
}

function fillLeftoverLane(hints: { puuid: string; role: RoleValue | null; cs: number }[]): void {
  const taken = new Set(hints.map((seat) => seat.role).filter((role): role is RoleValue => role !== null));
  const missing = LANE_ORDER.filter((role) => !taken.has(role));
  const open = hints.filter((seat) => seat.role === null);
  if (missing.length === 1 && open.length === 1 && open[0] !== undefined && missing[0] !== undefined) {
    open[0].role = missing[0];
  }
}
