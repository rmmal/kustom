import { describe, expect, it } from 'vitest';
import { buildStoredClues, clueView, hookLines } from './clues';

describe('buildStoredClues', () => {
  it('starts with champion and role, and keeps the answer out of the values', () => {
    const clues = buildStoredClues({
      category: 'disaster',
      champion: 'Yasuo',
      role: 'mid',
      damage: 18_420,
      cs: 143,
      gold: 9_800,
      damageTaken: 22_000,
      longestLivedS: 197,
      championTimes: 17,
      gamesPlayed: 40,
    });

    expect(clues[0]).toMatchObject({ type: 'champion', value: 'Yasuo', revealOrder: 1 });
    expect(clues[1]).toMatchObject({ type: 'role', value: 'MID' });
    expect(clues.some((clue) => /Ahmed|Omar/.test(clue.value))).toBe(false);
    expect(clues.at(-1)?.value).toContain('Yasuo 17 times');
    expect(clues).toHaveLength(5);
  });

  it('skips a missing champion rather than inventing one', () => {
    const clues = buildStoredClues({
      category: 'monster',
      champion: null,
      role: 'adc',
      damage: 40_000,
      cs: 200,
      gold: 14_000,
      damageTaken: null,
      longestLivedS: null,
      championTimes: null,
      gamesPlayed: 12,
    });
    expect(clues[0]?.type).toBe('role');
    expect(clues.some((clue) => clue.type === 'historical')).toBe(true);
  });
});

describe('hookLines', () => {
  it('puts deaths on a disaster and CS on a farmer, never a name', () => {
    const disaster = hookLines({
      category: 'disaster',
      deaths: 11,
      kp: 40,
      cs: 80,
      damage: 6_000,
      damageTaken: null,
      durationS: 31 * 60 + 42,
    });
    expect(disaster.map((line) => line.label)).toEqual(['Deaths', 'Kill participation', 'Game']);
    expect(disaster[0]?.value).toBe('11');

    const farm = hookLines({
      category: 'farming',
      deaths: 2,
      kp: 50,
      cs: 347,
      damage: 12_000,
      damageTaken: null,
      durationS: 34 * 60,
    });
    expect(farm[0]).toEqual({ label: 'CS', value: '347' });
  });
});

describe('clueView', () => {
  it('carries the stored order and a label', () => {
    expect(clueView({ type: 'champion', value: 'Yasuo', revealOrder: 1 })).toEqual({
      order: 1,
      type: 'champion',
      label: 'Champion',
      value: 'Yasuo',
    });
  });
});
