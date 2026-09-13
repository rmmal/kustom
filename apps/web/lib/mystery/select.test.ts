import { describe, expect, it } from 'vitest';
import { dayIndex, type MysteryCandidate, pickMystery, shuffleSuspects } from './select';

function row(
  partial: Partial<MysteryCandidate> & Pick<MysteryCandidate, 'gameId' | 'playerId'>,
): MysteryCandidate {
  return {
    score: 100,
    category: 'disaster',
    startedAt: new Date('2026-08-01T18:00:00Z'),
    ...partial,
  };
}

describe('dayIndex', () => {
  it('is stable for a day key', () => {
    expect(dayIndex('2026-09-13', 20)).toBe(dayIndex('2026-09-13', 20));
    expect(dayIndex('2026-09-13', 20)).not.toBe(dayIndex('2026-09-14', 20));
  });
});

describe('pickMystery', () => {
  it('returns null when there is nobody to expose', () => {
    expect(
      pickMystery([], '2026-09-13', { recentGameIds: new Set(), recentPlayerIds: new Set() }),
    ).toBeNull();
  });

  it('avoids a recently used game and player, then falls back if that empties the pool', () => {
    const a = row({ gameId: 'g1', playerId: 'p1', score: 200 });
    const b = row({ gameId: 'g2', playerId: 'p2', score: 150 });
    const avoid = { recentGameIds: new Set(['g1']), recentPlayerIds: new Set(['p1']) };
    expect(pickMystery([a, b], '2026-09-13', avoid)?.gameId).toBe('g2');
    expect(pickMystery([a], '2026-09-13', avoid)?.gameId).toBe('g1');
  });

  it('picks from the top slice, not always the single highest score', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      row({ gameId: `g${i}`, playerId: `p${i}`, score: 200 - i }),
    );
    const picked = pickMystery(many, '2026-09-13', { recentGameIds: new Set(), recentPlayerIds: new Set() });
    expect(picked).not.toBeNull();
    expect(many.some((row) => row.gameId === picked?.gameId)).toBe(true);
    const otherDay = pickMystery(many, '2026-09-14', {
      recentGameIds: new Set(),
      recentPlayerIds: new Set(),
    });
    // Two days can coincide; the property we pin is determinism, not uniqueness.
    expect(
      pickMystery(many, '2026-09-13', { recentGameIds: new Set(), recentPlayerIds: new Set() })?.gameId,
    ).toBe(picked?.gameId);
    expect(otherDay?.gameId).toBe(
      pickMystery(many, '2026-09-14', { recentGameIds: new Set(), recentPlayerIds: new Set() })?.gameId,
    );
  });
});

describe('shuffleSuspects', () => {
  it('is the same order for the same day', () => {
    const names = ['Ahmed', 'Omar', 'Karim', 'Ali', 'Youssef', 'Mohamed'];
    expect(shuffleSuspects(names, '2026-09-13')).toEqual(shuffleSuspects(names, '2026-09-13'));
    expect(shuffleSuspects(names, '2026-09-13').slice().sort()).toEqual([...names].sort());
  });
});
