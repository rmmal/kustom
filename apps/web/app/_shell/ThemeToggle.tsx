'use client';

import { useEffect, useState } from 'react';
import {
  applyTheme,
  otherTheme,
  readTheme,
  THEME_DEFAULT,
  THEME_LABELS,
  THEME_ORDER,
  THEME_PICKER_LABEL,
  type ThemeKind,
} from '@/lib/theme';

/**
 * One switch, dressed like the nav tabs. Night is the default. After mount it
 * reads `data-theme` so a refresh cannot disagree with the page.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeKind>(THEME_DEFAULT);

  useEffect(() => {
    setTheme(readTheme());
  }, []);

  function flip() {
    const next = otherTheme(theme);
    setTheme(next);
    applyTheme(next);
  }

  return (
    <button
      type="button"
      className="cn-theme-toggle"
      role="switch"
      aria-checked={theme === 'night'}
      aria-label={THEME_PICKER_LABEL}
      onClick={flip}
    >
      {THEME_ORDER.map((kind) => (
        <span key={kind} className={kind === theme ? 'cn-theme-opt cn-theme-opt-on' : 'cn-theme-opt'}>
          {THEME_LABELS[kind]}
        </span>
      ))}
    </button>
  );
}
