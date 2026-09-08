import { describe, expect, it } from 'vitest';
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
});
