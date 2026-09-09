import { describe, expect, it } from 'vitest';
import { isCurrentTab, NAV_ITEMS, RELEASE_EXE_URL, RELEASES_URL, WORDMARK } from './nav';

/**
 * The nav's two rules (05-design.md, "The app shell"), which are the ones a later engineer
 * breaks by adding a tab: **only routes that exist**, and **one destination is underlined**.
 */

describe('the nav list', () => {
  it('is the four product settled, minus the routes that do not exist yet', () => {
    // `Stats` is M5.4 and is deliberately absent: a tab that 404s is worse than a missing one.
    expect(NAV_ITEMS.map((item) => item.label)).toEqual(['Tonight', 'Leaderboard', 'Companion ↗']);
  });

  it('sends the companion tab at the releases page, never at the exe', () => {
    const companion = NAV_ITEMS.find((item) => item.external === true);
    expect(companion?.href).toBe(RELEASES_URL);
    expect(companion?.href).not.toContain('latest/download/Kustom.exe');
    // The direct download exists, for `/admin` only.
    expect(RELEASE_EXE_URL).toBe(
      'https://github.com/suyaser/kustom-releases/releases/latest/download/Kustom.exe',
    );
  });

  it('says Kustom, and nothing says the repo codename', () => {
    expect(WORDMARK).toBe('KUSTOM');
  });
});

describe('which tab is current', () => {
  const tab = (label: string) => {
    const found = NAV_ITEMS.find((item) => item.label === label);
    if (found === undefined) throw new Error(`no tab ${label}`);
    return found;
  };

  it('underlines Tonight on the root and nowhere else', () => {
    expect(isCurrentTab(tab('Tonight'), '/')).toBe(true);
    expect(isCurrentTab(tab('Tonight'), '/leaderboard')).toBe(false);
    expect(isCurrentTab(tab('Tonight'), '/p/abc')).toBe(false);
  });

  it('counts a player page as the leaderboard, because that is where the link came from', () => {
    expect(isCurrentTab(tab('Leaderboard'), '/leaderboard')).toBe(true);
    expect(isCurrentTab(tab('Leaderboard'), '/p/abc')).toBe(true);
    expect(isCurrentTab(tab('Leaderboard'), '/')).toBe(false);
  });

  it('never underlines an external destination', () => {
    expect(isCurrentTab(tab('Companion ↗'), '/')).toBe(false);
  });
});
