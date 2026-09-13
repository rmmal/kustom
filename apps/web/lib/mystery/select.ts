import type { MysteryCategory } from './types';

/**
 * Pick one performance from a scored list. Deterministic for a civil-day key so the
 * cron and the first GET agree, and so two simultaneous first visitors cannot fork
 * the day.
 */

export const MYSTERY_RECENT_GAME_DAYS = 21;
export const MYSTERY_RECENT_PLAYER_DAYS = 7;
export const MYSTERY_TOP_SLICE = 20;

export interface MysteryCandidate {
  gameId: string;
  playerId: string;
  score: number;
  category: MysteryCategory;
  startedAt: Date;
}

export interface SelectAvoid {
  recentGameIds: ReadonlySet<string>;
  recentPlayerIds: ReadonlySet<string>;
}

export function dayIndex(dayKey: string, modulo: number): number {
  if (modulo <= 0) return 0;
  let hash = 0;
  for (let i = 0; i < dayKey.length; i += 1) {
    hash = (hash * 31 + dayKey.charCodeAt(i)) >>> 0;
  }
  return hash % modulo;
}

export function pickMystery(
  candidates: readonly MysteryCandidate[],
  dayKey: string,
  avoid: SelectAvoid,
): MysteryCandidate | null {
  const filtered = candidates.filter(
    (row) => !avoid.recentGameIds.has(row.gameId) && !avoid.recentPlayerIds.has(row.playerId),
  );
  const pool = filtered.length > 0 ? filtered : [...candidates];
  if (pool.length === 0) return null;

  const ranked = [...pool].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.gameId !== b.gameId) return a.gameId < b.gameId ? -1 : 1;
    return a.playerId < b.playerId ? -1 : 1;
  });
  const slice = ranked.slice(0, Math.min(MYSTERY_TOP_SLICE, ranked.length));
  return slice[dayIndex(dayKey, slice.length)] ?? null;
}

/** Stable shuffle so every visitor sees the same six names in the same order. */
export function shuffleSuspects<T>(items: readonly T[], dayKey: string): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = dayIndex(`${dayKey}:${i}`, i + 1);
    const current = copy[i];
    const swap = copy[j];
    if (current === undefined || swap === undefined) continue;
    copy[i] = swap;
    copy[j] = current;
  }
  return copy;
}
