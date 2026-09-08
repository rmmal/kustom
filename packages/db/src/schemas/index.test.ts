import { describe, expect, it } from 'vitest';
import { puuidSchema } from './index.js';

describe('puuidSchema', () => {
  it('accepts a client-shaped puuid', () => {
    const puuid = 'f1a2b3c4-d5e6-7890-abcd-ef1234567890';
    expect(puuidSchema.parse(puuid)).toBe(puuid);
  });

  it('rejects an empty string', () => {
    expect(puuidSchema.safeParse('').success).toBe(false);
  });
});
