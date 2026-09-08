/**
 * Rating model: OpenSkill, default Plackett-Luce, two teams of five.
 * Spec: docs/01-architecture.md "Rating model" and the M1.3 brief in docs/02-milestones.md.
 *
 * Pure. No clock, no I/O. `rateGame` is a function of its arguments only.
 */

import { predictWin as openskillPredictWin, rate as openskillRate } from 'openskill';
import { config, type RankDivision, type RankTier } from '../config';
import type { Rating, Side } from '../types';

const { rating: cfg } = config;

const TIER_MU: Readonly<Record<string, number>> = cfg.tierMu;
const DIVISION_STEPS: Readonly<Record<string, number>> = cfg.divisionSteps;
const TIERS_WITHOUT_DIVISIONS: readonly string[] = cfg.tiersWithoutDivisions;

/** Players per side. A League custom is 5v5; anything else is not a game we rate. */
const TEAM_SIZE = 5;

/**
 * Seed a rating from the ranked tier and division the client reports.
 *
 * - Division IV is the tier base; each division above adds `config.rating.divisionStep`.
 * - Master, Grandmaster and Challenger are all 35 and ignore any division.
 * - Unranked, or any tier string we do not recognise, is 20 with sigma 10.
 * - Matching is case-insensitive. A missing or unrecognised division on a ranked tier
 *   counts as IV, the tier base.
 *
 * Accepts loose strings because the client and the database are the callers and both can
 * hand us `null`, `'NONE'`, `'NA'` or something new after a patch. Typed callers can pass
 * `RankTier` / `RankDivision` directly.
 */
export function seedFromRank(
  tier: RankTier | string | null | undefined,
  division: RankDivision | string | null | undefined,
): Rating {
  const tierKey = (tier ?? '').trim().toUpperCase();
  const base = TIER_MU[tierKey];
  if (base === undefined) {
    return { mu: cfg.unrankedMu, sigma: cfg.unrankedSigma };
  }
  if (TIERS_WITHOUT_DIVISIONS.includes(tierKey)) {
    return { mu: base, sigma: cfg.rankedSigma };
  }
  const steps = DIVISION_STEPS[(division ?? '').trim().toUpperCase()] ?? 0;
  return { mu: base + steps * cfg.divisionStep, sigma: cfg.rankedSigma };
}

/** Leaderboard sort key: `mu - 2 * sigma`. Conservative, so uncertain players rank lower. */
export function ordinal({ mu, sigma }: Rating): number {
  return mu - cfg.ordinalSigmaWeight * sigma;
}

/** What a player sees: `round(mu * 60)`, so a seed reads like a familiar MMR number. */
export function displayRating(mu: number): number {
  return Math.round(mu * cfg.displayMultiplier);
}

function assertTeam(team: readonly Rating[], side: 'blue' | 'red'): void {
  if (team.length !== TEAM_SIZE) {
    throw new Error(`rateGame: ${side} must have exactly five ratings, got ${team.length}`);
  }
}

function clean({ mu, sigma }: Rating): Rating {
  return { mu, sigma };
}

/**
 * Rate one finished game. Returns new ratings for both sides, in the same order as given.
 * `winningSide` is `100` (blue) or `200` (red). There is no draw path: a League custom
 * cannot draw, and a remake is not a game (the API drops it before this call).
 *
 * OpenSkill's `rank` is a placing, so the winner gets 1 and the loser 2.
 */
export function rateGame(
  blue: readonly Rating[],
  red: readonly Rating[],
  winningSide: Side,
): { blue: Rating[]; red: Rating[] } {
  assertTeam(blue, 'blue');
  assertTeam(red, 'red');
  const rank = winningSide === 100 ? [1, 2] : [2, 1];
  const [newBlue, newRed] = openskillRate([blue.map(clean), red.map(clean)], { rank });
  return { blue: newBlue.map(clean), red: newRed.map(clean) };
}

/**
 * Blue's probability of beating red, in `[0, 1]`. Red's is `1 - it`.
 * Takes real `{ mu, sigma }` values, never role-adjusted effective skill.
 */
export function predictWin(blue: readonly Rating[], red: readonly Rating[]): number {
  const [blueProb] = openskillPredictWin([blue.map(clean), red.map(clean)]);
  if (blueProb === undefined) {
    throw new Error('predictWin: openskill returned no probability for blue');
  }
  return blueProb;
}
