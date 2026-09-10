import type { RoleValue } from '@customs/db';
import { gamesLabel, RATING_LABEL, winLossLabel } from '../board/copy';

/**
 * Every word `/stats` says (M5.4), in one file, the way product spelled them in the brief and
 * in `05-design.md`'s copy table — the same arrangement `lib/board/copy.ts` has for the two
 * board pages, and for the same reason: the awards are printed on a page **and** in a Discord
 * post, and one of them saying `Cursed duo` while the other said `Worst duo` is a bug nobody
 * would find until somebody won it.
 *
 * **Every string here is product's**, including the seven the brief did not write: they were
 * written against the brief's "print a not-enough-yet line here", ruled on 2026-09-10 and are
 * now a table of their own in `05-design.md` ("Copy — `/stats`, the strings the brief did not
 * write"). Five were kept as written, two were replaced — `On a streak now` and `Nobody is on a
 * streak of 3 or more.` — and the page's own noun for a run is **streak**, everywhere.
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

/**
 * A streak worth naming on the page: three (product's brief, `/stats` section 6).
 *
 * **The sentence below interpolates it**, so a change here changes the line the page prints and
 * cannot leave the words and the filter saying two different numbers.
 */
export const ON_A_STREAK_GAMES = 3;

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
 * `12 players played.` (product, 2026-09-10) — the third fact the brief's page order asks the
 * header for, and the one the slot's pinned line has no room for.
 *
 * It sits with the two group statements rather than in the slot, because the slot is fixed byte
 * for byte by M5.10's post. The zero case never renders: an empty window prints its own sentence
 * and draws no card.
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
 * The count goes through `gamesLabel` and **the verb follows it** — `1 game is not in the role
 * numbers` — which product ruled on 2026-09-10: the brief wrote the plural only, and everything
 * after the dash is theirs, unchanged.
 */
export function noRoleFootnote(games: number): string {
  const verb = games === 1 ? 'is' : 'are';
  return `${gamesLabel(games)} ${verb} not in the role numbers — the client did not record who played where. Backfilled games never do.`;
}

/**
 * `Nobody has 5 games on jungle yet.` (product, 2026-09-10).
 *
 * The role in the app's own lower-case word, and the `5` from the constant the list filters on,
 * so the sentence and the bar cannot drift. `yet`, because it is a running count.
 */
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

/**
 * `No pair has 5 games together yet.` (product, 2026-09-10) — deliberately the award's own noun
 * with the browsing table's number in it, so a reader who meets both lines reads one rule at two
 * bars rather than two rules.
 */
export const NO_DUOS = `No pair has ${MIN_DUO_GAMES} games together yet.` as const;

/** How many of each list the page prints: the five best and the five worst (product). */
export const DUOS_SHOWN = 5;

/** `Yuki and Theo` — a pair, named. The same shape in the award line and in the two lists. */
export function pairLabel(a: string, b: string): string {
  return `${a} and ${b}`;
}

export const STREAKS_HEADING = 'Streaks';

/**
 * The two the window holds, with their holders (product, 2026-09-10): the brief's own words,
 * promoted to labels. `losing`, not `loss` — it is the streak a person is on, not a column head.
 */
export const LONGEST_WIN = 'Longest win streak';
export const LONGEST_LOSS = 'Longest losing streak';

/**
 * Anyone on three or more right now (product, 2026-09-10, replacing `On a run now`).
 *
 * **`streak`, not `run`**: the card above it is `Streaks`, the two labels above it end in
 * `streak`, and the leaderboard row prints `W3`. One thing, one name — the rule that turned
 * `standings` into `Leaderboard`.
 */
export const ON_A_STREAK = 'On a streak now';

/**
 * The quiet week's answer for that block (product, 2026-09-10, replacing `Nobody is on a run of
 * three or more.`). The digit is {@link ON_A_STREAK_GAMES}, interpolated: spelled out it can
 * drift from the list it is about, and the page's other two "not enough yet" lines already
 * print their minimum as a digit.
 */
export const NOBODY_ON_A_STREAK = `Nobody is on a streak of ${ON_A_STREAK_GAMES} or more.` as const;

/** `71%`. The one place a rate becomes words, so every list prints it the same way. */
export function percentLabel(percent: number): string {
  return `${percent}%`;
}

/* ---------------------------------------------------------------------------
 * The per-player sections on `/p/[puuid]` (M5.20).
 *
 * **These eight strings are unwritten copy and are with product** (M5.20 acceptance 9;
 * `05-design.md`, "The per-player sections on `/p/[puuid]` (M5.20) are not in this table"). They
 * are here rather than in a component so that the table product writes has one code half, the
 * way the two above it do — nothing below may be re-typed into `PlayerStats.tsx`.
 *
 * Everything these sections say that product **has** already written is imported and not
 * re-worded: the window's five labels and five empty sentences, `By role`, `Streaks`,
 * `Best together`, `Worst together`, `Longest win streak`, `Longest losing streak`, the no-role
 * footnote, the cap line, `13W 15L`, `71%` and `W3`. One page, one vocabulary.
 * ------------------------------------------------------------------------- */

/**
 * `By side` — the card under `By role` on a person's page (**engineer, for product**).
 *
 * The group's blue rate is `/stats`'s headline and is not repeated here, so this card is the
 * one place in the product where a side is a record rather than a colour on a team, and it
 * takes the same two words as the card above it: a preposition and the thing.
 */
export const SIDE_RECORD_HEADING = 'By side';

/**
 * `blue` and `red` as the two rows of that card (**engineer, for product**).
 *
 * Lower case, and the register roles are printed in everywhere on this page (`top`, `jungle`):
 * they are the subject of a data row, not a heading, and the product's own nouns for `100` and
 * `200`. The colour is not the mark — a row tinted blue in a list of two would be the tonight
 * page's team card meaning something else.
 */
export const SIDE_LABELS: Readonly<Record<100 | 200, string>> = { 100: 'blue', 200: 'red' };

/**
 * `Partners` — the card of the three best and three worst (**engineer, for product**).
 *
 * `/stats` calls its own section `Duos` because every row there is a pair of other people; each
 * row here is **one** other person, read from the page owner's side of it, and `Duos` over a
 * list of single names would be the page asking the reader to do the subtraction.
 */
export const PARTNERS_HEADING = 'Partners';

/**
 * Nobody has reached the five (**engineer, for product**).
 *
 * The shape of the page's other two "not enough yet" lines, with the minimum as a digit and
 * `yet` because it is a running count. `them`, third person, is this page's own pronoun
 * (M3.26): the page is about somebody who is usually not the reader.
 */
export const NO_PARTNERS = `Nobody has ${MIN_DUO_GAMES} games with them yet.` as const;

/**
 * The first row of `Streaks` on a person's page (**engineer, for product**): the run ending at
 * their most recent counted game, product's own name for it in the M5.4 brief ("**Current
 * streak**: the run ending at their most recent counted game, printed `W3` / `L2`"), promoted
 * to a label beside {@link LONGEST_WIN} and {@link LONGEST_LOSS}, which are already labels.
 */
export const CURRENT_STREAK = 'Current streak';

/**
 * `Average game 32 min.` (**engineer, for product**) — the mean over **their** counted games.
 *
 * The group's line carries the count it is over (`· 214 games`) because nothing else on
 * `/stats` says it. On this page M5.15's seed line already ends `, 37 games since.`, and no
 * page says one number twice — so this is the same sentence with that half dropped and a stop
 * in its place. **Never `0 min` and never `NaN`**: a player with no counted game in the window
 * has no line at all, because the whole band is undrawn there.
 */
export function playerAverageGameLine(minutes: number): string {
  return `Average game ${minutes} min.`;
}

/**
 * `Most improved, September.` / `Most improved, week of 1 Sep.` — one line for a player who won
 * an award in a closed window (product, `05-design.md`'s copy table, 2026-09-10).
 *
 * **No badge and no icon**, and no rule, no delta and no percentage: the award's own line, with
 * all of that in it, is on `/stats` and in the Monday post. This says which award and which
 * calendar, and the reader taps through for the rest.
 *
 * The label is the award's own (`MOST_IMPROVED`, `BEST_OFF_ROLE`, `CURSED_DUO`), so the three
 * cannot drift from the block they were won in.
 */
export function awardWonLine(label: string, period: string): string {
  return `${label}, ${period}.`;
}

/**
 * `week of 1 Sep` — the second half of that line on the two week windows (product's `week of 1
 * Sep`, from the copy table; the month form is `formatMonthName`'s `September`, unwrapped).
 *
 * The day is the window's own Monday, formatted on the server in the fixed locale and the
 * configured zone like every other date on a public page.
 */
export function weekOfLabel(day: string): string {
  return `week of ${day}`;
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
 * **`their`, and product's copy table supersedes the brief's `his`** (2026-09-10): the database
 * holds a PUUID, a name that can change between two page loads, and no pronoun. It is the same
 * pronoun the board pages settled on for the same reason (M3.26).
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
