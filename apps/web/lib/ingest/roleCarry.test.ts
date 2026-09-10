import { describe, expect, it } from 'vitest';
import { carryableOverrides } from './roleCarry';

/**
 * How long a role for tonight lasts (M3.6, decision 2026-09-09): the night, not the lobby row.
 *
 * This is the rule itself — what a new row inherits, and what a new night does not. The
 * database half is `roleCarry.integration.test.ts`, which drives real companion posts against
 * the local stack.
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
  it("carries every member's override onto the night's next cycle, grouped by role", () => {
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

  it("carries nothing for a party's first ever lobby", () => {
    expect(
      carryableOverrides({ previousLobby: null, overrides, memberIds: ['hana'], nightStart: NIGHT_START })
        .size,
    ).toBe(0);
  });

  it('prefers a row this same post deleted: a friend who dropped out and rejoined', () => {
    // The delete happened a moment ago, in this cycle. Whatever the previous cycle holds for
    // them is a game older, so the newer answer wins.
    const carried = carryableOverrides({
      previousLobby: { createdAt: DURING },
      overrides: [{ playerId: 'hana', role: 'top' }],
      departed: new Map([['hana', 'jungle']]),
      memberIds: ['hana'],
      nightStart: NIGHT_START,
    });

    expect([...carried.entries()]).toEqual([['jungle', ['hana']]]);
  });

  it("carries a deleted row's override even with no previous cycle at all", () => {
    const carried = carryableOverrides({
      previousLobby: null,
      overrides: [],
      departed: new Map([['iris', 'support']]),
      memberIds: ['iris'],
      nightStart: NIGHT_START,
    });

    expect([...carried.entries()]).toEqual([['support', ['iris']]]);
  });

  it('writes nothing for a row the post did not create', () => {
    // `memberIds` is what the post inserted, and it is the only thing written: re-applying an
    // old value over a tap that has just landed is the one thing this may not do.
    const carried = carryableOverrides({
      previousLobby: { createdAt: DURING },
      overrides,
      departed: new Map([['iris', 'support']]),
      memberIds: [],
      nightStart: NIGHT_START,
    });

    expect(carried.size).toBe(0);
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

  it("carries nothing when the previous cycle's timestamp cannot be read", () => {
    const carried = carryableOverrides({
      previousLobby: { createdAt: 'not a date' },
      overrides,
      memberIds: ['hana'],
      nightStart: NIGHT_START,
    });

    expect(carried.size).toBe(0);
  });
});
