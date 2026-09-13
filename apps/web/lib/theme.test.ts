import { describe, expect, it } from 'vitest';
import {
  otherTheme,
  parseTheme,
  THEME_BOOTSTRAP,
  THEME_DEFAULT,
  THEME_ORDER,
  THEME_STORAGE_KEY,
} from './theme';

describe('parseTheme', () => {
  it('accepts Day and Night, and maps the old Current name to Night', () => {
    expect(parseTheme('day')).toBe('day');
    expect(parseTheme('night')).toBe('night');
    expect(parseTheme('current')).toBe('night');
    expect(parseTheme('light')).toBeNull();
    expect(parseTheme('')).toBeNull();
    expect(parseTheme(null)).toBeNull();
  });
});

describe('the default', () => {
  it('defaults to Night and offers only Day and Night', () => {
    expect(THEME_DEFAULT).toBe('night');
    expect(THEME_ORDER).toEqual(['day', 'night']);
    expect(otherTheme('night')).toBe('day');
    expect(otherTheme('day')).toBe('night');
  });

  it('writes the same names the bootstrap script reads, and migrates Current', () => {
    expect(THEME_BOOTSTRAP).toContain(THEME_STORAGE_KEY);
    expect(THEME_BOOTSTRAP).toContain("t==='day'");
    expect(THEME_BOOTSTRAP).toContain("t==='night'");
    expect(THEME_BOOTSTRAP).toContain("t==='current'");
    expect(THEME_BOOTSTRAP).toContain("t='night'");
  });
});
