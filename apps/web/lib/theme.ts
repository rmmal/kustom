/**
 * Public-page themes. Day and Night are the same gaming look; Night is the default.
 *
 * A stored `current` from the short-lived third option is treated as Night.
 */

export const THEME_STORAGE_KEY = 'cn-theme';

export const THEME_DEFAULT = 'night';

export const THEME_ORDER = ['day', 'night'] as const;

export type ThemeKind = (typeof THEME_ORDER)[number];

/** The nav group, and the name of the control. */
export const THEME_PICKER_LABEL = 'Theme';

export const THEME_LABELS: Readonly<Record<ThemeKind, string>> = {
  day: 'Day',
  night: 'Night',
};

/** Phone chrome, one hex per theme. */
export const THEME_COLOR: Readonly<Record<ThemeKind, string>> = {
  day: '#e8eef6',
  night: '#05070c',
};

/**
 * Inline, before first paint. `beforeInteractive` in the root layout. A leftover
 * `current` becomes Night so a refresh cannot land on a theme the toggle no longer offers.
 */
export const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==='current')t='night';if(t==='day'||t==='night')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export function parseTheme(value: string | null | undefined): ThemeKind | null {
  if (value === 'day' || value === 'night') return value;
  if (value === 'current') return 'night';
  return null;
}

export function readTheme(): ThemeKind {
  if (typeof document === 'undefined') return THEME_DEFAULT;
  return parseTheme(document.documentElement.dataset.theme) ?? THEME_DEFAULT;
}

export function otherTheme(theme: ThemeKind): ThemeKind {
  return theme === 'night' ? 'day' : 'night';
}

export function applyTheme(theme: ThemeKind): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* private mode, first paint still has data-theme */
  }

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta === null) return;
  meta.setAttribute('content', THEME_COLOR[theme]);
}
