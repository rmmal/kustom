import { describe, expect, it } from 'vitest';
import { championLabel, championName, NO_BAN } from './names';

describe('championName', () => {
  it('names a stored id', () => {
    expect(championName(35)).toBe('Shaco');
    expect(championName(103)).toBe('Ahri');
  });

  it('prefers the fallback for a skipped ban or a missing id', () => {
    expect(championName(NO_BAN, 'Unknown')).toBe('Unknown');
    expect(championName(null)).toBe('Unknown');
  });

  it('prints the id when the roster table does not have it', () => {
    expect(championName(12_345)).toBe('Champion 12345');
    expect(championName(12_345, 'Mel')).toBe('Mel');
  });
});

describe('championLabel', () => {
  it('is null when the row named nothing', () => {
    expect(championLabel(null)).toBeNull();
    expect(championLabel(NO_BAN)).toBeNull();
  });

  it('prefers the stored end-of-game name, then the id table', () => {
    expect(championLabel(103, 'Ahri')).toBe('Ahri');
    expect(championLabel(35)).toBe('Shaco');
  });
});
