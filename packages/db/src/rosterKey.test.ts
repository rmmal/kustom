import { describe, expect, it } from 'vitest';
import { rosterKey } from './rosterKey.js';

describe('rosterKey', () => {
  it('is the same key whatever order the ten arrive in', () => {
    const ten = Array.from({ length: 10 }, (_, index) => `puuid-${index}`);
    const shuffled = [...ten].reverse();
    expect(rosterKey(shuffled)).toBe(rosterKey(ten));
  });

  it('does not depend on which side a player was on', () => {
    const blue = ['a', 'b', 'c', 'd', 'e'];
    const red = ['f', 'g', 'h', 'i', 'j'];
    expect(rosterKey([...blue, ...red])).toBe(rosterKey([...red, ...blue]));
  });

  it('differs when one player differs', () => {
    expect(rosterKey(['a', 'b'])).not.toBe(rosterKey(['a', 'c']));
  });

  it('throws on an empty roster or a duplicated player', () => {
    expect(() => rosterKey([])).toThrow(/at least one/);
    expect(() => rosterKey(['a', 'a'])).toThrow(/duplicate/);
  });
});
