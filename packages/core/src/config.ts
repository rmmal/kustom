/**
 * Every tuning constant in `packages/core`, in one place, so a tuning change is a one-line
 * diff plus a test update. Values come from `docs/01-architecture.md` ("Rating model",
 * "Balancer") and the M1.3 / M1.4 briefs in `docs/02-milestones.md`.
 *
 * Do not change a number here without updating the tests and the architecture doc in the
 * same change.
 */

/** The ranked tiers the League client reports, uppercase as the client sends them. */
export type RankTier =
  | 'IRON'
  | 'BRONZE'
  | 'SILVER'
  | 'GOLD'
  | 'PLATINUM'
  | 'EMERALD'
  | 'DIAMOND'
  | 'MASTER'
  | 'GRANDMASTER'
  | 'CHALLENGER';

/** Division within a tier. IV is the tier base. Master and above have none. */
export type RankDivision = 'I' | 'II' | 'III' | 'IV';

export const config = {
  rating: {
    /** Seed `mu` for division IV of each tier. Master and above share 35 and ignore division. */
    tierMu: {
      IRON: 14,
      BRONZE: 17,
      SILVER: 20,
      GOLD: 23,
      PLATINUM: 26,
      EMERALD: 29,
      DIAMOND: 32,
      MASTER: 35,
      GRANDMASTER: 35,
      CHALLENGER: 35,
    } satisfies Record<RankTier, number>,
    /** Tiers whose divisions are ignored when seeding. */
    tiersWithoutDivisions: ['MASTER', 'GRANDMASTER', 'CHALLENGER'] satisfies RankTier[],
    /** Added to `tierMu` per division above IV: III +1, II +2, I +3 steps. */
    divisionStep: 0.75,
    /** Number of steps above the tier base for each division. */
    divisionSteps: { IV: 0, III: 1, II: 2, I: 3 } satisfies Record<RankDivision, number>,
    /** Seed `sigma` for any recognised ranked tier (OpenSkill's default 25/3, rounded). */
    rankedSigma: 8.33,
    /** Seed for unranked, or any tier string we do not recognise. */
    unrankedMu: 20,
    unrankedSigma: 10,
    /** Leaderboard ordinal is `mu - ordinalSigmaWeight * sigma`. */
    ordinalSigmaWeight: 2,
    /** Display rating is `round(mu * displayMultiplier)`. Also the unit the balancer scores in. */
    displayMultiplier: 60,
  },
  balance: {
    /**
     * Effective skill on a role is `mu * multiplier * rating.displayMultiplier`.
     * `main` is the player's main (or tonight's override, or any role for a flexible player),
     * `secondary` their backup, `fill` anything else.
     */
    roleMultiplier: { main: 1.0, secondary: 0.93, fill: 0.85 },
    /** Display points added to a split's score per player not on a main role. */
    offRolePenalty: 120,
    /** Display points added once when a split puts the same five together as `lastSplit`. */
    repeatSplitPenalty: 200,
    /** How many splits `balance` returns at most, best first. Reroll walks this list. */
    splitsReturned: 3,
  },
  roles: {
    /**
     * `inferRoles` (M5.16) reads a player's main and backup off their most recent games that
     * count: this many, newest first. Twenty is about two weeks for a regular and a month for
     * somebody who plays half the nights: one odd evening does not move a main, a real change
     * shows inside a fortnight.
     */
    inferenceWindow: 20,
    /** Fewer counted games than this and the player is flexible (`main: null`). Three is not one lucky fill. */
    minGames: 3,
  },
} as const;

export type Config = typeof config;
