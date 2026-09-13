import type { RoleValue } from '@customs/db';

/**
 * Daily Mystery (M5.32): one accountless guessing game per civil day.
 *
 * The League player on the scoreboard and the website visitor are different people.
 * Visitors are a random id in a cookie / localStorage. Nobody signs in to play.
 */

export const MYSTERY_CATEGORIES = ['disaster', 'monster', 'farming', 'raid_boss', 'ghost'] as const;

export type MysteryCategory = (typeof MYSTERY_CATEGORIES)[number];

export const MYSTERY_CLUE_TYPES = [
  'champion',
  'role',
  'damage',
  'cs',
  'gold',
  'damage_taken',
  'longest_life',
  'historical',
] as const;

export type MysteryClueType = (typeof MYSTERY_CLUE_TYPES)[number];

export interface MysterySuspect {
  playerId: string;
  name: string;
}

export interface MysteryHookLine {
  label: string;
  value: string;
}

export interface MysteryClueView {
  order: number;
  type: MysteryClueType;
  label: string;
  value: string;
}

export interface MysteryPublicHook {
  kills: number;
  deaths: number;
  assists: number;
  kda: string;
  durationS: number;
  durationLabel: string;
  lines: MysteryHookLine[];
}

export interface MysteryPerformance {
  kills: number;
  deaths: number;
  assists: number;
  kda: string;
  champion: string | null;
  role: RoleValue | null;
  damage: number;
  damageLabel: string;
  cs: number;
  gold: number;
  goldLabel: string;
  damageTaken: number | null;
  damageTakenLabel: string | null;
  durationS: number;
  durationLabel: string;
  won: boolean;
  startedLabel: string;
}

export interface MysteryGuessShare {
  playerId: string;
  name: string;
  count: number;
  percent: number;
}

export interface MysteryCommunity {
  attempts: number;
  correct: number;
  wrong: number;
  accuracyPercent: number;
  wrongPercent: number;
  averageCluesUsed: number | null;
  zeroClueCorrect: number;
  fastestCorrectMs: number | null;
  mostFalselyAccused: { playerId: string; name: string; count: number } | null;
  distribution: MysteryGuessShare[];
  firstDetectiveClaimed: boolean;
}

export type MysteryPercentileBucket = 'top-5' | 'top-10' | 'top-15' | 'top-25' | 'top-50';

export interface MysteryPersonal {
  guessedPlayerId: string;
  guessedName: string;
  actualPlayerId: string;
  actualName: string;
  correct: boolean;
  cluesUsed: number;
  completionTimeMs: number;
  firstDetective: boolean;
  percentile: MysteryPercentileBucket | null;
}

export interface MysteryPlayView {
  challengeId: string;
  challengeNumber: number;
  day: string;
  category: MysteryCategory;
  expiresAt: string;
  hook: MysteryPublicHook;
  suspects: MysterySuspect[];
  cluesRevealed: number;
  revealedClues: MysteryClueView[];
  clueCount: number;
  completed: boolean;
}

export interface MysteryResultView {
  challengeId: string;
  challengeNumber: number;
  day: string;
  category: MysteryCategory;
  expiresAt: string;
  hook: MysteryPublicHook;
  suspects: MysterySuspect[];
  revealedClues: MysteryClueView[];
  clueCount: number;
  performance: MysteryPerformance;
  personal: MysteryPersonal;
  community: MysteryCommunity;
}

export interface MysteryEmptyView {
  empty: true;
  expiresAt: string;
}
