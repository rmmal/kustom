import type { MysteryCategory } from './types';

/**
 * How unusual a single-game performance is. Pure. The daily picker ranks on this and
 * then picks from the top slice with the civil-day key, so two visitors never get two
 * different crimes on the same date.
 */

export const MYSTERY_MIN_DURATION_S = 12 * 60;

export interface ScoreInput {
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  damage: number;
  damageTaken: number | null;
  durationS: number;
}

export interface ScoredPerformance {
  score: number;
  category: MysteryCategory;
  parts: Record<MysteryCategory, number>;
}

export function scorePerformance(input: ScoreInput): ScoredPerformance | null {
  if (input.durationS < MYSTERY_MIN_DURATION_S) return null;

  const minutes = Math.max(input.durationS / 60, 1);
  const cspm = input.cs / minutes;
  const dpm = input.damage / minutes;

  const disaster =
    input.deaths * 10 +
    (input.deaths >= 10 ? 40 : 0) +
    (input.kills === 0 && input.deaths >= 6 ? 35 : 0) +
    (input.kills + input.assists <= 3 && input.deaths >= 8 ? 20 : 0) -
    input.kills * 2;

  const monster =
    input.kills * 8 -
    input.deaths * 5 +
    (input.kills >= 15 ? 40 : 0) +
    (input.deaths <= 2 && input.kills >= 10 ? 30 : 0);

  const farming = (cspm >= 8 ? cspm * 12 : 0) + (input.cs >= 300 ? 40 : 0);

  const raid_boss = input.damageTaken !== null && input.damageTaken >= 40_000 ? input.damageTaken / 700 : 0;

  const ghost = input.durationS >= 25 * 60 && dpm < 250 ? 80 + (250 - dpm) : 0;

  const parts: Record<MysteryCategory, number> = {
    disaster: Math.max(0, disaster),
    monster: Math.max(0, monster),
    farming: Math.max(0, farming),
    raid_boss: Math.max(0, raid_boss),
    ghost: Math.max(0, ghost),
  };

  let category: MysteryCategory = 'disaster';
  let score = -1;
  for (const key of Object.keys(parts) as MysteryCategory[]) {
    const value = parts[key];
    if (value > score) {
      score = value;
      category = key;
    }
  }

  if (score <= 0) return null;
  return { score, category, parts };
}
