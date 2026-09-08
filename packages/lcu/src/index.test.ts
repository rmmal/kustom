import { describe, expect, it } from 'vitest';
import { LCU_PACKAGE } from './index.js';

describe('lcu stub', () => {
  it('is a placeholder until M0.1', () => {
    expect(LCU_PACKAGE).toBe('@customs/lcu');
  });
});
