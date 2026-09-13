import { describe, expect, it } from 'vitest';
import { MYSTERY_MIN_DURATION_S, scorePerformance } from './score';

const long = { durationS: 31 * 60, assists: 4, cs: 140, damage: 12_000, damageTaken: 20_000 };

describe('scorePerformance', () => {
  it('drops a remake-length game', () => {
    expect(
      scorePerformance({ ...long, durationS: MYSTERY_MIN_DURATION_S - 1, kills: 0, deaths: 14 }),
    ).toBeNull();
  });

  it('crowns a disaster class', () => {
    const scored = scorePerformance({ ...long, kills: 0, deaths: 14, assists: 3, damage: 8_000 });
    expect(scored?.category).toBe('disaster');
    expect(scored?.score).toBeGreaterThan(100);
  });

  it('crowns a monster game', () => {
    const scored = scorePerformance({ ...long, kills: 21, deaths: 2, assists: 9, damage: 40_000 });
    expect(scored?.category).toBe('monster');
    expect(scored?.score).toBeGreaterThan(100);
  });

  it('crowns a farming simulator', () => {
    const scored = scorePerformance({
      ...long,
      kills: 4,
      deaths: 3,
      cs: 347,
      damage: 18_000,
    });
    expect(scored?.category).toBe('farming');
  });

  it('crowns a raid boss from damage taken', () => {
    const scored = scorePerformance({
      ...long,
      kills: 2,
      deaths: 6,
      damage: 10_000,
      damageTaken: 61_000,
    });
    expect(scored?.category).toBe('raid_boss');
  });

  it('crowns a ghost in a long low-damage game', () => {
    const scored = scorePerformance({
      ...long,
      durationS: 38 * 60,
      kills: 1,
      deaths: 4,
      assists: 2,
      cs: 80,
      damage: 2_400,
      damageTaken: 12_000,
    });
    expect(scored?.category).toBe('ghost');
  });

  it('does not invent a raid boss when damage taken is missing', () => {
    const scored = scorePerformance({
      ...long,
      kills: 2,
      deaths: 4,
      damageTaken: null,
    });
    expect(scored?.category).not.toBe('raid_boss');
  });
});
