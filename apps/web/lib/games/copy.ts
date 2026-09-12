import { SIDE_LABELS } from '../stats/copy';
import { kdaLine, kpLine } from '../stats/funCopy';

/**
 * Every word `/games` says. The tab, the heading, the result line and the scoreboard
 * labels live here so the page cannot invent a second sentence for the same fact.
 */

/** The nav tab, the heading beside the window's name, the `<title>`. */
export const GAMES_LABEL = 'Games';

/** The player page's link out of `Recent games` and onto this list. */
export const ALL_GAMES_LABEL = 'All games';

/** The group list, when `?p=` is naming one person. */
export const EVERYONE_LABEL = 'Everyone';

/** The two maps this page lists. The picker's accessible name is the noun, not a label on screen. */
export const QUEUE_PICKER_LABEL = 'Queue';

export const QUEUE_LABELS: Readonly<Record<'sr' | 'aram', string>> = {
  sr: "Summoner's Rift",
  aram: 'ARAM',
};

export const SCOREBOARD_LABEL = 'Scoreboard';

export const COL_KDA = 'KDA';
export const COL_DAMAGE = 'Damage';
export const COL_GOLD = 'Gold';
export const COL_CS = 'CS';

export function blueWon(): string {
  return `${SIDE_LABELS[100]} won`;
}

export function redWon(): string {
  return `${SIDE_LABELS[200]} won`;
}

export function resultForWinner(side: 100 | 200): string {
  return side === 100 ? blueWon() : redWon();
}

/** `39–25`: blue kills first, then red. An en dash, the same mark the scoreboards use. */
export function scoreLine(blueKills: number, redKills: number): string {
  return `${blueKills}–${redKills}`;
}

export function teamHeading(side: 100 | 200, kills: number): string {
  return `${SIDE_LABELS[side]} · ${kills}`;
}

export function showingFocus(name: string): string {
  return `Showing ${name}'s games.`;
}

export function focusMetaLine(
  kills: number,
  deaths: number,
  assists: number,
  kp: number | null,
  cs: number,
): string {
  const kda = kdaLine(kills, deaths, assists);
  const farm = `${cs} CS`;
  return kp === null ? `${kda} · ${farm}` : `${kda} · ${kpLine(kp)} · ${farm}`;
}
