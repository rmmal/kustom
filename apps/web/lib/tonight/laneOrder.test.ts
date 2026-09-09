import { describe, expect, it } from 'vitest';
import { readAssignments } from '../discord/assemble';
import { inLaneOrder } from '../laneOrder';

/**
 * The tonight page reads `splits.blue` / `splits.red` — jsonb, in whatever order the balancer
 * wrote them — and prints five rows. The promise those rows keep is that **"my row" is in the
 * same place** on the teams card, the result card and in both embeds, so the order is enforced
 * where the split is read rather than trusted from the column (`lib/tonight/load.ts`, the
 * designer 2026-09-10).
 *
 * This pins the pair that does it, on the shape the column actually holds.
 */

describe('a stored split, however it was written', () => {
  const shuffled = [
    { puuid: 'p-support', role: 'support' },
    { puuid: 'p-mid', role: 'mid' },
    { puuid: 'p-top', role: 'top' },
    { puuid: 'p-adc', role: 'adc' },
    { puuid: 'p-jungle', role: 'jungle' },
  ];

  it('comes out top, jungle, mid, adc, support', () => {
    expect(inLaneOrder(readAssignments(shuffled)).map((seat) => seat.role)).toEqual([
      'top',
      'jungle',
      'mid',
      'adc',
      'support',
    ]);
  });

  it('carries each seat’s own puuid with it, not just the roles', () => {
    expect(inLaneOrder(readAssignments(shuffled)).map((seat) => seat.puuid)).toEqual([
      'p-top',
      'p-jungle',
      'p-mid',
      'p-adc',
      'p-support',
    ]);
  });

  it('is the order the column already had when it was written in lane order', () => {
    const inOrder = [...shuffled].sort(
      (a, b) =>
        ['top', 'jungle', 'mid', 'adc', 'support'].indexOf(a.role) -
        ['top', 'jungle', 'mid', 'adc', 'support'].indexOf(b.role),
    );
    expect(inLaneOrder(readAssignments(inOrder))).toEqual(inLaneOrder(readAssignments(shuffled)));
  });

  it('drops an entry the column cannot be read as a seat, rather than printing a hole', () => {
    const damaged = [...shuffled, { puuid: 'p-nobody' }, { role: 'top' }, null];
    expect(inLaneOrder(readAssignments(damaged))).toHaveLength(5);
  });
});
