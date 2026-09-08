import { displayRating } from '@customs/core';
import { describe, expect, it } from 'vitest';
import { displayDelta } from './ratingDisplay';

/**
 * The one delta rule (M3.3), which every surface that prints a rating change depends on.
 */

describe('displayDelta', () => {
  it('rounds both ratings first, so the row on the screen adds up', () => {
    // 24.49 -> 1469, 25.20 -> 1512. The naive rule would print +43 here too, but it does not
    // hold in general and this one does: the delta is always the difference of what is shown.
    expect(displayDelta(24.49, 25.2)).toBe(43);
    expect(displayRating(24.49) + displayDelta(24.49, 25.2)).toBe(displayRating(25.2));
  });

  it('is never `round((muAfter - muBefore) * 60)`', () => {
    // 1200.4 displays as 1200 and 1201.6 as 1202, so the screen moved by two points while the
    // raw difference is 1.2. The naive rule prints `+1` beside a row that went 1200 -> 1202.
    const before = 1200.4 / 60;
    const after = 1201.6 / 60;
    expect([displayRating(before), displayRating(after)]).toEqual([1200, 1202]);
    expect(displayDelta(before, after)).toBe(2);
    expect(Math.round((after - before) * 60)).toBe(1);
  });

  it('keeps the direction of a change too small to round to a point', () => {
    const down = displayDelta(25.0, 24.999);
    // It is zero — the two display ratings are the same number...
    expect(down === 0).toBe(true);
    // ...and it is a negative zero, so the renderer prints `-0` rather than `(0)`.
    expect(Object.is(down, -0)).toBe(true);
    expect(Object.is(displayDelta(25.0, 25.001), -0)).toBe(false);
    expect(Object.is(displayDelta(25.0, 25.0), -0)).toBe(false);
  });

  it('leaves a real change alone', () => {
    expect(Object.is(displayDelta(25.0, 24.0), -0)).toBe(false);
    expect(displayDelta(25.0, 24.0)).toBe(-60);
  });
});
