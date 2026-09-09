import { describe, expect, it } from 'vitest';
import { carryableOverrides } from './roleCarry';

/**
 * How long a role for tonight lasts (M3.6, decision 2026-09-09): the night, not the lobby row.
 *
 * The database half — the two reads and the grouped update — runs against the local stack with
 * the rest of lobby ingest. This is the rule itself: what a new cycle inherits, and what a new
 * night does not.
 */

const NIGHT_START = new Date('2026-09-08T03:00:00.000Z'); // 06:00 in Africa/Cairo
const DURING = '2026-09-08T21:30:00.000Z';
const AFTER_MIDNIGHT = '2026-09-09T00:40:00.000Z';
const LAST_NIGHT = '2026-09-07T22:00:00.000Z';

const overrides = [
  { playerId: 'hana', role: 'jungle' as const },
  { playerId: 'iris', role: 'top' as const },
  { playerId: 'omar', role: 'jungle' as const },
];

describe('carryableOverrides', () => {
  it('carries every member’s override onto the night’s next cycle, grouped by role', () => {
    const carried = carryableOverrides({
      previousLobby: { createdAt: DURING },
      overrides,
      memberIds: ['hana', 'iris', 'omar', 'theo'],
      nightStart: NIGHT_START,
    });

    // Grouped so the write is at most five statements however big the lobby is.
    expect([...carried.entries()].sort()).toEqual([
      ['jungle', ['hana', 'omar']],
      ['top', ['iris']],
    ]);
  });

  it('carries a 01:00 cycle forward: the night runs 06:00 to 06:00, not midnight to midnight', () => {
    const carried = carryableOverrides({
      previousLobby: { createdAt: AFTER_MIDNIGHT },
      overrides: [{ playerId: 'hana', role: 'jungle' }],
      memberIds: ['hana'],
      nightStart: NIGHT_START,
    });

    expect(carried.get('jungle')).toEqual(['hana']);
  });

  it('carries nothing from last night: the first lobby of a night starts flexible', () => {
    const carried = carryableOverrides({
      previousLobby: { createdAt: LAST_NIGHT },
      overrides,
      memberIds: ['hana', 'iris'],
      nightStart: NIGHT_START,
    });

    expect(carried.size).toBe(0);
  });

  it('carries nothing for a party’s first ever lobby', () => {
    expect(
      carryableOverrides({ previousLobby: null, overrides, memberIds: ['hana'], nightStart: NIGHT_START })
        .size,
    ).toBe(0);
  });

  it('skips somebody who has gone home', () => {
    const carried = carryableOverrides({
      previousLobby: { createdAt: DURING },
      overrides,
      memberIds: ['iris'],
      nightStart: NIGHT_START,
    });

    expect([...carried.keys()]).toEqual(['top']);
  });

  it('carries nothing when the previous cycle’s timestamp cannot be read', () => {
    const carried = carryableOverrides({
      previousLobby: { createdAt: 'not a date' },
      overrides,
      memberIds: ['hana'],
      nightStart: NIGHT_START,
    });

    expect(carried.size).toBe(0);
  });
});
