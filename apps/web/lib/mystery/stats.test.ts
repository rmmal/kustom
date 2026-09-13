import { describe, expect, it } from 'vitest';
import {
  type AttemptStat,
  buildCommunity,
  compareCorrect,
  MYSTERY_PERCENTILE_MIN_CORRECT,
  percentileBucket,
  rankAmongCorrect,
} from './stats';

function attempt(partial: Partial<AttemptStat> & Pick<AttemptStat, 'visitorId'>): AttemptStat {
  return {
    guessedPlayerId: 'p-ahmed',
    guessedName: 'Ahmed',
    correct: true,
    cluesUsed: 1,
    completionTimeMs: 8_000,
    ...partial,
  };
}

describe('compareCorrect', () => {
  it('ranks fewer clues above a faster worse guess', () => {
    const zero = attempt({ visitorId: 'a', cluesUsed: 0, completionTimeMs: 15_000 });
    const two = attempt({ visitorId: 'b', cluesUsed: 2, completionTimeMs: 5_000 });
    expect(compareCorrect(zero, two)).toBeLessThan(0);
  });
});

describe('percentileBucket', () => {
  it('stays quiet until there are enough correct guesses', () => {
    expect(percentileBucket(1, MYSTERY_PERCENTILE_MIN_CORRECT - 1)).toBeNull();
    expect(percentileBucket(1, 10)).toBe('top-10');
    expect(percentileBucket(1, 20)).toBe('top-5');
    expect(percentileBucket(3, 20)).toBe('top-15');
    expect(percentileBucket(12, 20)).toBeNull();
  });
});

describe('rankAmongCorrect', () => {
  it("places the current visitor among today's correct rows", () => {
    const rows = [
      attempt({ visitorId: 'slow', cluesUsed: 3, completionTimeMs: 40_000 }),
      attempt({ visitorId: 'you', cluesUsed: 0, completionTimeMs: 15_000 }),
      attempt({ visitorId: 'fast-clues', cluesUsed: 2, completionTimeMs: 4_000 }),
    ];
    expect(rankAmongCorrect(rows[1] as AttemptStat, rows)).toBe(1);
    expect(rankAmongCorrect(rows[2] as AttemptStat, rows)).toBe(2);
  });
});

describe('buildCommunity', () => {
  it('counts attempts, names the most falsely accused, and never needs a username', () => {
    const community = buildCommunity(
      [
        attempt({ visitorId: '1', correct: true, cluesUsed: 0 }),
        attempt({
          visitorId: '2',
          correct: false,
          guessedPlayerId: 'p-omar',
          guessedName: 'Omar',
          cluesUsed: 3,
        }),
        attempt({
          visitorId: '3',
          correct: false,
          guessedPlayerId: 'p-omar',
          guessedName: 'Omar',
          cluesUsed: 2,
        }),
        attempt({
          visitorId: '4',
          correct: false,
          guessedPlayerId: 'p-karim',
          guessedName: 'Karim',
          cluesUsed: 1,
        }),
      ],
      true,
    );

    expect(community.attempts).toBe(4);
    expect(community.correct).toBe(1);
    expect(community.wrong).toBe(3);
    expect(community.accuracyPercent).toBe(25);
    expect(community.zeroClueCorrect).toBe(1);
    expect(community.mostFalselyAccused).toEqual({ playerId: 'p-omar', name: 'Omar', count: 2 });
    expect(community.firstDetectiveClaimed).toBe(true);
    expect(community.distribution[0]?.name).toBe('Omar');
  });
});
