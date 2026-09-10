import type { RoleValue } from '@customs/db';
import { gamesLabel, RATING_LABEL, winLossLabel } from '../board/copy';

/**
 * Every word `/stats` says (M5.4), in one file, the way product spelled them in the brief and
 * in `05-design.md`'s copy table — the same arrangement `lib/board/copy.ts` has for the two
 * board pages, and for the same reason: the awards are printed on a page **and** in a Discord
 * post, and one of them saying `Cursed duo` while the other said `Worst duo` is a bug nobody
 * would find until somebody won it.
 *
 * **Product's strings are quoted; the ones this file invented are marked `(engineer)`** and are
 * listed for product in the M5.4 report. Every one of them is a "not enough yet" line, which
 * the brief asks for by name and does not write out.
 *
 * The window's own words — the five labels, the empty sentences, the slot — are the board's and
 * are imported, never retyped: `/stats` mounts the same picker and prints the same slot.
 */

/**
 * The page's noun: the nav tab, the heading beside the window's name, the `<title>`.
 *
 * One word, and it is the word the milestone, the route and the nav list already use — the
 * `Leaderboard` rule (`05-design.md`: one thing, one name).
 */
export const STATS_LABEL = 'Stats';

/* ---------------------------------------------------------------------------
 * The minimums. Every one of them is five games or more, which is why this page
 * opens on `This month` and not on the board's `This week`.
 * ------------------------------------------------------------------------- */

/**
 * How many rows at a role before a percentage is printed, and — on this page — before a player
 * appears in that role's list at all.
 *
 * Product's number, and the same one for a side record: under five games a record prints
 * without a percentage, so nobody is "100% mid" off one game.
 */
export const MIN_RECORD_GAMES = 5;

/** How many games together before a pair is worth looking at. The award's bar is higher. */
export const MIN_DUO_GAMES = 5;

/** A run worth naming on the page: three (product's brief, `/stats` section 6). */
export const ON_A_RUN_GAMES = 3;

/* ---------------------------------------------------------------------------
 * The group's two numbers, and the cap.
 * ------------------------------------------------------------------------- */

/**
 * `Blue wins 53% of the time · 214 games` (product).
 *
 * **The group's side rate is the only group-wide rate on this page**, and it is meaningful
 * precisely because a group-wide *role* rate is not: every game has a blue top and a red top,
 * so any group-level role rate is 50.0% by construction.
 */
export function blueWinLine(percent: number, games: number): string {
  return `Blue wins ${percent}% of the time · ${gamesLabel(games)}`;
}

/** `Average game 32 min · 214 games` (product). Never `0 min` — zero games prints no line. */
export function averageGameLine(minutes: number, games: number): string {
  return `Average game ${minutes} min · ${gamesLabel(games)}`;
}

/**
 * `12 players played.` **(engineer)** — the third fact product's page order asks the header for
 * ("the window's name and the dates it covers, counted games, players who played") and the only
 * one the slot's pinned line has no room for.
 *
 * It sits with the two group statements rather than in the slot, because the slot is a fixed
 * string (`05-design.md`'s copy table) and this is a sentence about the same window.
 */
export function playersLine(players: number): string {
  return players === 1 ? '1 player played.' : `${players} players played.`;
}

/**
 * `Showing the most recent 2000 games.` (product, `05-design.md`'s copy table).
 *
 * The number is interpolated from the cap the read actually applied, so the line cannot promise
 * a number the page did not use.
 */
export function capLine(cap: number): string {
  return `Showing the most recent ${cap} games.`;
}

/* ---------------------------------------------------------------------------
 * By role.
 * ------------------------------------------------------------------------- */

/**
 * `12 games are not in the role numbers — the client did not record who played where.
 * Backfilled games never do.` (product), under the role section and **only above zero**.
 *
 * The count goes through `gamesLabel` and the verb follows it, so a single game reads
 * `1 game is not in the role numbers` rather than product's plural against a count of one —
 * the same rule every other count on these pages follows.
 */
export function noRoleFootnote(games: number): string {
  const verb = games === 1 ? 'is' : 'are';
  return `${gamesLabel(games)} ${verb} not in the role numbers — the client did not record who played where. Backfilled games never do.`;
}

/** `Nobody has 5 games on jungle yet.` **(engineer)** — the brief asks for the line, not the words. */
export function noRoleEntries(role: RoleValue): string {
  return `Nobody has ${MIN_RECORD_GAMES} games on ${role} yet.`;
}

/* ---------------------------------------------------------------------------
 * Duos and streaks.
 * ------------------------------------------------------------------------- */

/** The section, and its two lists. Product's brief names all three. */
export const DUOS_HEADING = 'Duos';
export const BEST_TOGETHER = 'Best together';
export const WORST_TOGETHER = 'Worst together';

/** `No pair has 5 games together yet.` **(engineer)** */
export const NO_DUOS = `No pair has ${MIN_DUO_GAMES} games together yet.` as const;

/** How many of each list the page prints: the five best and the five worst (product). */
export const DUOS_SHOWN = 5;

/** `Yuki and Theo` — a pair, named. The same shape in the award line and in the two lists. */
export function pairLabel(a: string, b: string): string {
  return `${a} and ${b}`;
}

export const STREAKS_HEADING = 'Streaks';

/** The two the window holds, with their holders. **(engineer)** */
export const LONGEST_WIN = 'Longest win streak';
export const LONGEST_LOSS = 'Longest losing streak';

/** Anyone on three or more right now. **(engineer)** */
export const ON_A_RUN = 'On a run now';

/** **(engineer)** — the quiet week's answer for the third block of the streaks section. */
export const NOBODY_ON_A_RUN = 'Nobody is on a run of three or more.';

/** `71%`. The one place a rate becomes words, so every list prints it the same way. */
export function percentLabel(percent: number): string {
  return `${percent}%`;
}

/* ---------------------------------------------------------------------------
 * The awards (product's words, brief 2026-09-09, amended for windows 2026-09-10).
 *
 * `week` and `month` are the only difference between a weekly and a monthly award: one noun and
 * three numbers, both interpolated, so there is one set of strings and not two.
 * ------------------------------------------------------------------------- */

/** Which calendar an award is about. `All time` has none and is not one of these. */
export type AwardPeriod = 'week' | 'month';

/**
 * The section's name on the page **and** the field name in the Discord post (`AWARDS_FIELD` in
 * `lib/discord/embeds.ts`, which shipped with M5.10). One word for one thing.
 */
export const AWARDS_HEADING = 'Awards';

/** `Three awards for the week. Nobody votes; the numbers pick.` */
export function awardsIntro(period: AwardPeriod): string {
  return `Three awards for the ${period}. Nobody votes; the numbers pick.`;
}

/**
 * `Awards are handed out when the week ends.` — the whole of the block on a window that is
 * still running, because an award that changes every night is a statistic, not an award.
 */
export function awardsPending(period: AwardPeriod): string {
  return `Awards are handed out when the ${period} ends.`;
}

export const MOST_IMPROVED = 'Most improved';
export const BEST_OFF_ROLE = 'Best off-role';
export const CURSED_DUO = 'Cursed duo';

/**
 * The three minimums, **two numbers per award in one table keyed by window kind** (product):
 * not a formula and not a fraction of the window's games, because a threshold nobody can recite
 * is a threshold the group will argue with.
 *
 * A regular plays five to fifteen games a week, so six crowns somebody who was actually there
 * all week and never the friend who showed up once and won. `All time` has no row because it
 * has no awards.
 */
export const AWARD_MINIMUMS: Readonly<
  Record<AwardPeriod, { mostImproved: number; bestOffRole: number; cursedDuo: number }>
> = {
  week: { mostImproved: 6, bestOffRole: 4, cursedDuo: 4 },
  month: { mostImproved: 15, bestOffRole: 10, cursedDuo: 8 },
};

/** `Biggest climb in Rating from a first game to a last one, over at least 15 games.` */
export function mostImprovedRule(minimum: number): string {
  return `Biggest climb in ${RATING_LABEL} from a first game to a last one, over at least ${minimum} games.`;
}

/** `Nadia · +212 · 1266 → 1478`. The delta is formatted by the surface: `−` on the web, `-` in Discord. */
export function mostImprovedLine(name: string, delta: string, from: number, to: number): string {
  return `${name} · ${delta} · ${from} → ${to}`;
}

/** `Nobody played 6 games this week.` */
export function mostImprovedNobody(minimum: number, period: AwardPeriod): string {
  return `Nobody played ${minimum} games this ${period}.`;
}

/** `Best record away from their main role, over at least 10 of those games.` */
export function bestOffRoleRule(minimum: number): string {
  return `Best record away from their main role, over at least ${minimum} of those games.`;
}

/**
 * `Omar · 9W 3L · 75% · their main is top`.
 *
 * **`their`, where product wrote `his`** (engineer): the database knows a PUUID and a display
 * name and nothing else, so a possessive per player is a fact this product does not have. Every
 * other word of the line is product's. Listed for product with the invented strings.
 */
export function bestOffRoleLine(
  name: string,
  wins: number,
  losses: number,
  percent: number,
  mainRole: RoleValue,
): string {
  return `${name} · ${winLossLabel(wins, losses)} · ${percentLabel(percent)} · their main is ${mainRole}`;
}

/** `Nobody spent 4 games off their main. That is the balancer doing its job.` */
export function bestOffRoleNobody(minimum: number): string {
  return `Nobody spent ${minimum} games off their main. That is the balancer doing its job.`;
}

/**
 * Under the off-role award whenever anybody in the window has no main role — which since M5.17
 * means anybody the inference calls *flexible*.
 */
export const NO_MAIN_ROLE_NOTE = 'Players with no main role are not in this one — every role is theirs.';

/** `The pair with the worst record on the same team, over at least 8 games together.` */
export function cursedDuoRule(minimum: number): string {
  return `The pair with the worst record on the same team, over at least ${minimum} games together.`;
}

/** `Yuki and Theo · 2W 9L · 18%` */
export function cursedDuoLine(pair: string, wins: number, losses: number, percent: number): string {
  return `${pair} · ${winLossLabel(wins, losses)} · ${percentLabel(percent)}`;
}

/** `No pair played 4 games together this week.` */
export function cursedDuoNobody(minimum: number, period: AwardPeriod): string {
  return `No pair played ${minimum} games together this ${period}.`;
}
