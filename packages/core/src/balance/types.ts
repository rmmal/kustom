import type { Role } from '../types.js';

/** One of the ten. `name` is only used in the explanation; identity is the puuid. */
export interface BalancePlayer {
  puuid: string;
  name: string;
  mu: number;
  sigma: number;
  /** `null` means flexible: every role is a main and the player is never off-role. */
  mainRole: Role | null;
  secondaryRole: Role | null;
  /** Tonight only. Becomes the main; the usual main becomes the backup. */
  roleOverride?: Role | null;
}

/** Two puuids that must land on the same team. Order does not matter. */
export type Duo = readonly [string, string];

export interface BalanceInput {
  /** Exactly ten, in any order. */
  players: readonly BalancePlayer[];
  duos?: readonly Duo[];
  /** The five puuids on one side of the last chosen split for these ten, or `null`. */
  lastSplit?: readonly string[] | null;
}

export interface Assignment {
  puuid: string;
  role: Role;
}

export interface Split {
  /** Five, in lane order (top, jungle, mid, adc, support). */
  blue: Assignment[];
  /** Five, in lane order. */
  red: Assignment[];
  /** `Math.round(rawGap)`, display-rating units. */
  gap: number;
  /** Blue's chance to win, in `[0, 1]`, from OpenSkill on the real ratings. */
  blueWinProb: number;
  /** Unrounded: `rawGap + 120 * offRoleCount + 200 * isRepeat`. This ordered the list. */
  score: number;
  /** Players not on a main role, 0 to 10. */
  offRoleCount: number;
}

export interface BalanceResult {
  /** One to three, best first. */
  splits: Split[];
  /** `explanations[i]` is the sentence for `splits[i]`. */
  explanations: string[];
}
