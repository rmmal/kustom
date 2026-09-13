'use client';

import { useEffect, useState } from 'react';
import {
  applyTheme,
  readTheme,
  THEME_DEFAULT,
  THEME_LABELS,
  THEME_ORDER,
  THEME_PICKER_LABEL,
  type ThemeKind,
} from '@/lib/theme';

/**
 * Day / Night. Night is the default. The first paint is already the stored theme — the
 * root layout's beforeInteractive script writes `data-theme` — and this control syncs
 * to that attribute after mount so a refresh cannot show Day selected on a Night page.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeKind>(THEME_DEFAULT);

  useEffect(() => {
    setTheme(readTheme());
  }, []);

  function pick(next: ThemeKind) {
    setTheme(next);
    applyTheme(next);
  }

  return (
    <fieldset className="cn-themes">
      <legend className="cn-sr">{THEME_PICKER_LABEL}</legend>
      {THEME_ORDER.map((kind) => (
        <label key={kind} className={kind === theme ? 'cn-theme cn-theme-on' : 'cn-theme'}>
          <input
            type="radio"
            name="cn-theme"
            className="cn-sr"
            checked={kind === theme}
            onChange={() => pick(kind)}
          />
          {THEME_LABELS[kind]}
        </label>
      ))}
    </fieldset>
  );
}
