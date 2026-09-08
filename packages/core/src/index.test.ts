import { describe, expect, it } from 'vitest';
import * as core from './index.js';
import { ROLES, type Side } from './index.js';

describe('core skeleton', () => {
  it('exposes the five roles in lane order', () => {
    expect(ROLES).toEqual(['top', 'jungle', 'mid', 'adc', 'support']);
  });

  it('types blue as 100 and red as 200', () => {
    const blue: Side = 100;
    const red: Side = 200;
    expect([blue, red]).toEqual([100, 200]);
  });

  it('exports the rating API and config from the single entry point', () => {
    // `packages/db` and the balancer import these; a rename here is a breaking change.
    expect(Object.keys(core).sort()).toEqual([
      'BalanceError',
      'ROLES',
      'balance',
      'config',
      'displayRating',
      'explain',
      'nextSplit',
      'ordinal',
      'predictWin',
      'rateGame',
      'seedFromRank',
    ]);
  });
});
