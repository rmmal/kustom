import { describe, expect, it } from 'vitest';
import { config, displayRating, ordinal, predictWin, type Rating, rateGame, seedFromRank } from '../index.js';

const RANKED_SIGMA = 8.33;

function team(rating: Rating, n = 5): Rating[] {
  return Array.from({ length: n }, () => ({ ...rating }));
}

describe('seedFromRank', () => {
  // Every cell of the brief's table, spelled out so a wrong constant fails on its own row.
  it.each([
    ['IRON', 'IV', 14.0],
    ['IRON', 'III', 14.75],
    ['IRON', 'II', 15.5],
    ['IRON', 'I', 16.25],
    ['BRONZE', 'IV', 17.0],
    ['BRONZE', 'III', 17.75],
    ['BRONZE', 'II', 18.5],
    ['BRONZE', 'I', 19.25],
    ['SILVER', 'IV', 20.0],
    ['SILVER', 'III', 20.75],
    ['SILVER', 'II', 21.5],
    ['SILVER', 'I', 22.25],
    ['GOLD', 'IV', 23.0],
    ['GOLD', 'III', 23.75],
    ['GOLD', 'II', 24.5],
    ['GOLD', 'I', 25.25],
    ['PLATINUM', 'IV', 26.0],
    ['PLATINUM', 'III', 26.75],
    ['PLATINUM', 'II', 27.5],
    ['PLATINUM', 'I', 28.25],
    ['EMERALD', 'IV', 29.0],
    ['EMERALD', 'III', 29.75],
    ['EMERALD', 'II', 30.5],
    ['EMERALD', 'I', 31.25],
    ['DIAMOND', 'IV', 32.0],
    ['DIAMOND', 'III', 32.75],
    ['DIAMOND', 'II', 33.5],
    ['DIAMOND', 'I', 34.25],
  ] as const)('%s %s seeds mu %d with sigma 8.33', (tier, division, mu) => {
    expect(seedFromRank(tier, division)).toEqual({ mu, sigma: RANKED_SIGMA });
  });

  it.each(['MASTER', 'GRANDMASTER', 'CHALLENGER'] as const)(
    '%s is 35.00 and ignores any division',
    (tier) => {
      expect(seedFromRank(tier, 'I')).toEqual({ mu: 35, sigma: RANKED_SIGMA });
      expect(seedFromRank(tier, 'IV')).toEqual({ mu: 35, sigma: RANKED_SIGMA });
      expect(seedFromRank(tier, null)).toEqual({ mu: 35, sigma: RANKED_SIGMA });
    },
  );

  it('seeds unranked at 20.00 with sigma 10.00', () => {
    expect(seedFromRank('UNRANKED', null)).toEqual({ mu: 20, sigma: 10 });
    expect(seedFromRank('NONE', 'NA')).toEqual({ mu: 20, sigma: 10 });
    expect(seedFromRank(null, null)).toEqual({ mu: 20, sigma: 10 });
    expect(seedFromRank(undefined, undefined)).toEqual({ mu: 20, sigma: 10 });
    expect(seedFromRank('', '')).toEqual({ mu: 20, sigma: 10 });
  });

  it('treats a garbage tier string as unranked', () => {
    expect(seedFromRank('WOOD', 'II')).toEqual({ mu: 20, sigma: 10 });
    expect(seedFromRank('GOLDEN', 'I')).toEqual({ mu: 20, sigma: 10 });
  });

  it('matches tier and division case-insensitively', () => {
    expect(seedFromRank('gold', 'ii')).toEqual({ mu: 24.5, sigma: RANKED_SIGMA });
    expect(seedFromRank('Gold', 'Ii')).toEqual({ mu: 24.5, sigma: RANKED_SIGMA });
  });

  it('treats a missing or unrecognised division on a ranked tier as the tier base (IV)', () => {
    expect(seedFromRank('GOLD', null)).toEqual({ mu: 23, sigma: RANKED_SIGMA });
    expect(seedFromRank('GOLD', 'NA')).toEqual({ mu: 23, sigma: RANKED_SIGMA });
    expect(seedFromRank('GOLD', 'V')).toEqual({ mu: 23, sigma: RANKED_SIGMA });
  });

  it('returns a fresh object each call', () => {
    const a = seedFromRank('GOLD', 'IV');
    const b = seedFromRank('GOLD', 'IV');
    expect(a).not.toBe(b);
    a.mu = 0;
    expect(seedFromRank('GOLD', 'IV').mu).toBe(23);
  });

  it('is driven by the exported config so tuning is a one-line diff', () => {
    expect(config.rating.tierMu).toEqual({
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
    });
    expect(config.rating.divisionStep).toBe(0.75);
    expect(config.rating.rankedSigma).toBe(8.33);
    expect(config.rating.unrankedMu).toBe(20);
    expect(config.rating.unrankedSigma).toBe(10);
    expect(config.rating.ordinalSigmaWeight).toBe(2);
    expect(config.rating.displayMultiplier).toBe(60);
  });
});

describe('ordinal', () => {
  it('is mu - 2 * sigma', () => {
    expect(ordinal({ mu: 25, sigma: 8.33 })).toBeCloseTo(8.34, 10);
    expect(ordinal({ mu: 30, sigma: 3.5 })).toBe(23);
    expect(ordinal({ mu: 14, sigma: 10 })).toBe(-6);
  });
});

describe('displayRating', () => {
  it('is round(mu * 60)', () => {
    expect(displayRating(25)).toBe(1500);
    expect(displayRating(23.75)).toBe(1425);
    expect(displayRating(14)).toBe(840);
    expect(displayRating(35)).toBe(2100);
    expect(displayRating(20.004)).toBe(1200);
    expect(displayRating(20.009)).toBe(1201);
  });
});

describe('predictWin', () => {
  const settled = { mu: 25, sigma: 5 };

  it('returns 0.5 for two identical teams', () => {
    expect(predictWin(team(settled), team(settled))).toBe(0.5);
  });

  it('returns the blue side probability, not the red', () => {
    const strong = team({ mu: 30, sigma: 5 });
    const weak = team({ mu: 20, sigma: 5 });
    const blueStrong = predictWin(strong, weak);
    const blueWeak = predictWin(weak, strong);
    expect(blueStrong).toBeGreaterThan(0.5);
    expect(blueWeak).toBeLessThan(0.5);
    expect(blueStrong + blueWeak).toBeCloseTo(1, 12);
  });

  it('is pinned for a known matchup', () => {
    // Blue has one player 5 mu above the rest: a small, real edge.
    const blue = [...team(settled, 4), { mu: 30, sigma: 5 }];
    expect(predictWin(blue, team(settled))).toBeCloseTo(0.6165, 4);
  });

  it('stays in [0, 1] at the extremes', () => {
    const p = predictWin(team({ mu: 60, sigma: 1 }), team({ mu: 0, sigma: 1 }));
    expect(p).toBeGreaterThan(0.999);
    expect(p).toBeLessThanOrEqual(1);
  });
});

describe('rateGame', () => {
  const settled = { mu: 25, sigma: 5 };

  it('moves the winners up and the losers down, for either winning side', () => {
    const blue = team(settled);
    const red = team(settled);

    const blueWins = rateGame(blue, red, 100);
    for (const r of blueWins.blue) expect(r.mu).toBeGreaterThan(25);
    for (const r of blueWins.red) expect(r.mu).toBeLessThan(25);

    const redWins = rateGame(blue, red, 200);
    for (const r of redWins.blue) expect(r.mu).toBeLessThan(25);
    for (const r of redWins.red) expect(r.mu).toBeGreaterThan(25);
  });

  it('is symmetric in side colour', () => {
    const a = [...team(settled, 4), { mu: 18.5, sigma: 8.33 }];
    const b = [...team(settled, 3), { mu: 35, sigma: 3.5 }, { mu: 22, sigma: 6 }];
    const aOnBlue = rateGame(a, b, 100);
    const aOnRed = rateGame(b, a, 200);
    expect(aOnBlue.blue).toEqual(aOnRed.red);
    expect(aOnBlue.red).toEqual(aOnRed.blue);
  });

  it('keeps input order and returns plain { mu, sigma } objects', () => {
    const blue = [
      { mu: 20, sigma: 8.33 },
      { mu: 22, sigma: 7 },
      { mu: 24, sigma: 6 },
      { mu: 26, sigma: 5 },
      { mu: 28, sigma: 4 },
    ];
    const red = team(settled);
    const { blue: after } = rateGame(blue, red, 100);
    expect(after).toHaveLength(5);
    // Every winner's mu rises by an amount proportional to their own sigma^2, so the
    // deltas shrink down the list exactly when order is preserved.
    const deltas = after.map((r, i) => r.mu - (blue[i]?.mu ?? Number.NaN));
    for (let i = 1; i < deltas.length; i += 1) {
      expect(deltas[i]).toBeLessThan(deltas[i - 1] ?? Number.NaN);
    }
    for (const r of after) expect(Object.keys(r).sort()).toEqual(['mu', 'sigma']);
  });

  it('does not mutate its inputs and is deterministic', () => {
    const blue = team({ mu: 18.5, sigma: 8.33 });
    const red = team(settled);
    const snapshotBlue = structuredClone(blue);
    const snapshotRed = structuredClone(red);
    const first = rateGame(blue, red, 100);
    const second = rateGame(blue, red, 100);
    expect(blue).toEqual(snapshotBlue);
    expect(red).toEqual(snapshotRed);
    expect(first).toEqual(second);
  });

  it('throws unless both teams have exactly five ratings', () => {
    expect(() => rateGame(team(settled, 4), team(settled), 100)).toThrow(/five/);
    expect(() => rateGame(team(settled), team(settled, 6), 100)).toThrow(/five/);
    expect(() => rateGame([], [], 100)).toThrow(/five/);
  });

  it('a Bronze on the winning side gains more than a Master beside them', () => {
    // Pinned per the M1.3 brief: OpenSkill moves mu by sigma^2, so the fresh Bronze must
    // out-gain the settled Master. Equal sigmas would gain identically; do not "fix" that.
    const bronze = { mu: 18.5, sigma: 8.33 };
    const master = { mu: 35, sigma: 3.5 };
    const blue = [bronze, master, ...team(settled, 3)];
    const red = team(settled);

    const after = rateGame(blue, red, 100);
    const bronzeAfter = after.blue[0];
    const masterAfter = after.blue[1];
    if (bronzeAfter === undefined || masterAfter === undefined) throw new Error('missing rating');

    const bronzeGain = bronzeAfter.mu - bronze.mu;
    const masterGain = masterAfter.mu - master.mu;
    expect(bronzeGain).toBeGreaterThan(0);
    expect(masterGain).toBeGreaterThan(0);
    expect(bronzeGain).toBeGreaterThan(masterGain);

    // Exact values, so an openskill upgrade that changes the maths fails loudly.
    expect(bronzeAfter.mu).toBeCloseTo(20.2593, 4);
    expect(bronzeAfter.sigma).toBeCloseTo(8.1697, 4);
    expect(masterAfter.mu).toBeCloseTo(35.3107, 4);
    expect(masterAfter.sigma).toBeCloseTo(3.4892, 4);
  });

  it('a sequence of wins keeps moving the same way (rank direction is not inverted)', () => {
    let a = team(settled);
    let b = team(settled);
    let lastProb = 0.5;
    for (let i = 0; i < 3; i += 1) {
      ({ blue: a, red: b } = rateGame(a, b, 100));
      const p = predictWin(a, b);
      expect(p).toBeGreaterThan(lastProb);
      lastProb = p;
    }
    // Now let the same team win from the red side; the trend must continue.
    ({ blue: b, red: a } = rateGame(b, a, 200));
    expect(predictWin(a, b)).toBeGreaterThan(lastProb);
  });

  /**
   * The M1.3 brief's convergence setup: P0 seeded Iron IV (mu 14, sigma 8.33), ten settled
   * Gold IVs (mu 23, sigma 3.5). In game k (0-indexed) P0's team is P0 plus players
   * 1 + (k % 10) .. 1 + ((k + 3) % 10). The brief says "the remaining five are the opponents",
   * but P0 plus ten others is eleven people, so the opponents are the next five in the same
   * rotation and the tenth sits that game. P0's side wins every time.
   *
   * Returns P0's rating after each game, index 0 being after game 1.
   */
  function convergeMisSeeded(games: number): Rating[] {
    const ratings: Rating[] = [
      { mu: 14, sigma: 8.33 },
      ...Array.from({ length: 10 }, () => ({ mu: 23, sigma: 3.5 })),
    ];
    const at = (i: number): Rating => {
      const r = ratings[i];
      if (r === undefined) throw new Error(`missing player ${i}`);
      return r;
    };
    const history: Rating[] = [];
    for (let k = 0; k < games; k += 1) {
      const ownIds = [0, ...[0, 1, 2, 3].map((o) => 1 + ((k + o) % 10))];
      const oppIds = [4, 5, 6, 7, 8].map((o) => 1 + ((k + o) % 10));
      const { blue, red } = rateGame(ownIds.map(at), oppIds.map(at), 100);
      ownIds.forEach((id, i) => {
        ratings[id] = blue[i] ?? at(id);
      });
      oppIds.forEach((id, i) => {
        ratings[id] = red[i] ?? at(id);
      });
      history.push(at(0));
    }
    return history;
  }

  it('ten games converge a mis-seeded player: mu rises and sigma falls every game', () => {
    const history = convergeMisSeeded(10);
    let prev: Rating = { mu: 14, sigma: 8.33 };
    for (const r of history) {
      expect(r.mu).toBeGreaterThan(prev.mu);
      expect(r.sigma).toBeLessThan(prev.sigma);
      prev = r;
    }
  });

  it('ten games converge a mis-seeded player: mu is above the Gold IV seed after game 10', () => {
    const history = convergeMisSeeded(10);
    const last = history[9];
    if (last === undefined) throw new Error('missing game 10');
    expect(last.mu).toBeGreaterThan(23);
    // Pinned: mu first passes 23.00 in game 4 (23.6639) and reaches 34.0930 after game 10.
    expect(history[3]?.mu).toBeCloseTo(23.6639, 4);
    expect(last.mu).toBeCloseTo(34.093, 3);
    expect(last.sigma).toBeCloseTo(6.4704, 4);
  });

  // The brief asked for sigma below 5.00 after ten games; the real model (openskill 5.0.1, default tau) is at 6.47 then, because team games shrink sigma slowly, so the lead pinned the true number: game 36.
  it('sigma of the mis-seeded player drops below 5.00 in game 36', () => {
    const history = convergeMisSeeded(36);
    expect(history[34]?.sigma).toBeGreaterThanOrEqual(5);
    expect(history[35]?.sigma).toBeLessThan(5);
  });
});
