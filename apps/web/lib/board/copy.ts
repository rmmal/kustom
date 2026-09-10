/**
 * Every word `/leaderboard` and `/p/[puuid]` say (M3.5, M3.8, M3.10), in one file, spelled the
 * way product and `docs/05-design.md` spell them.
 *
 * The two names are fixed on every surface — **Proven** (`round(ordinal * 60)`, the sort key
 * and the primary number) and **Rating** (`round(mu * 60)`, the number the embeds print) — and
 * no surface invents a third (M3.5 brief; the row in `04-decisions.md`). Capitalised as
 * labels, lower case inside a sentence.
 */

import type { WindowKind } from '../night';

/** The primary number: `round(ordinal * 60)`. Named once per page, in the legend. */
export const PROVEN_LABEL = 'Proven';

/** The secondary number: `round(mu * 60)`. Printed inline on every line 2. */
export const RATING_LABEL = 'Rating';

/**
 * The legend in the board card's header bar, right-aligned over the **one** unlabelled number
 * (`05-design.md`, "Leaderboard row", amended 2026-09-09). A legend, not a header row: it does
 * not stick, does not sort and is not tappable.
 *
 * **One word, and the word is `Proven`.** Right-aligned, `Proven · Rating` put `Rating`
 * directly over the Proven column and `Proven` over nothing, which reads as two side-by-side
 * columns when the two numbers are stacked one per line. `Rating` needs no legend: it names
 * itself on every line 2.
 */
export const BOARD_LEGEND = PROVEN_LABEL;

/**
 * The legend in the `Recent games` header, right-aligned over the column of ratings, and the
 * same lower-case mono micro-label the seat rack carries over its own rating column
 * (`05-design.md`, "The player page", the designer's M3.5 review). The bare number under it
 * carries visually-hidden `Rating`, exactly as the board row's bare Proven does.
 */
export const RECENT_RATING_LEGEND = RATING_LABEL.toLowerCase();

/**
 * The board's own word (designer, 2026-09-09). `Leaderboard` and not `standings`: it is what
 * `docs/01-architecture.md` and the milestones have called this page since M0, it is the word
 * the group uses, and a second name for a page is exactly the drift the two number names are
 * already policed against.
 *
 * Capitalised as a label — the page heading, the back link, the `<title>` — and lower case
 * inside the embed's title, where it follows the **window's** name in a sentence-shaped line
 * (`This week · leaderboard`, M5.12), the same rule `Proven` and `Rating` follow.
 */
export const LEADERBOARD_LABEL = 'Leaderboard';

/**
 * When the marker switches off. Product's round number for M1.3's finding that a mis-seeded
 * player's sigma first falls below 5.00 somewhere between game 26 and game 36 (M3.8 brief):
 * the sentence says "about 30 games" and the chip switches off at exactly 30.
 */
export const SETTLING_GAMES = 30;

/** The chip. A word, not a warning: no colour, no dot, no emoji, no asterisk. */
export const SETTLING_CHIP = 'settling';

/**
 * The sentence, once per page — under the leaderboard heading, under the rating chart on the
 * player page — and never once per row (product, **2026-09-10**, amending the 2026-09-08
 * wording; {@link SETTLING_SENTENCE_SHORT} was amended in the same pass and for the same
 * reason, so the page and the nightly post say one thing).
 *
 * The 2026-09-08 wording said new players `start low on purpose and climb as they play`, which
 * is false on a season's first board, where every row is a rank seed and nobody has climbed
 * anything. It also promised a gap that closes — `stays below your rating until…` — and the gap
 * never closes: σ shrinks, it does not reach zero. This one says what Proven **is**, in the
 * reader's own terms, and what happens to the difference: it shrinks and settles.
 *
 * The number is interpolated from {@link SETTLING_GAMES} rather than typed, because the M3.8
 * acceptance check is that the number in the sentence is the threshold the marker itself uses.
 * `board/copy.test.ts` pins the assembled string against product's words.
 */
export const SETTLING_SENTENCE =
  `The board sorts on ${PROVEN_LABEL}: your rating, minus how unsure the board still is about you. That gap shrinks as you play and settles after about ${SETTLING_GAMES} games.` as const;

/**
 * The short form, for the one-line Discord footer where two sentences will not fit. Amended
 * with the long one (product, 2026-09-10): **the gap settles, it never closes** — σ falls with
 * every game and does not reach zero, so neither sentence may say `until` or `catches up`.
 */
export const SETTLING_SENTENCE_SHORT =
  `${PROVEN_LABEL} is your rating minus how unsure the board still is about you, and it settles after about ${SETTLING_GAMES} games.` as const;

/**
 * The five windows the board is read through (M5.12, `05-design.md`'s board copy table,
 * product 2026-09-10). **The same five words are the option, the board heading and the post
 * title** — a picker that said `Week` over a heading that said `This week` would be two names
 * for one thing, which is the rule `Leaderboard` already won.
 *
 * The parameter is the `WindowKind` itself (`?window=this-week`), so the URL and the label
 * cannot drift: there is one map and it is this one.
 */
export const WINDOW_LABELS: Readonly<Record<WindowKind, string>> = {
  'this-week': 'This week',
  'last-week': 'Last week',
  'this-month': 'This month',
  'last-month': 'Last month',
  'all-time': 'All time',
};

/**
 * `Monday 1 Sep to Sunday 7 Sep · 14 games`: the line under the picker (M5.12, the designer's
 * slot; `05-design.md`'s copy table, product 2026-09-10).
 *
 * The range half is `lib/night.ts`'s — **and the week form is M5.10's post description byte for
 * byte**, so the Monday post and the page a tap later say the same words. The count is the
 * window's counted games and goes through {@link gamesLabel}, so a one-game week never reads
 * `1 games`.
 *
 * Sentence case here; the stylesheet upper-cases it, exactly as the tonight page's slug line is
 * a readable date in the DOM and a `SLUG` on the screen.
 */
export function windowSlotLine(range: string, games: number): string {
  return `${range} · ${gamesLabel(games)}`;
}

/**
 * `Since 8 Sep 2025`: `All time`'s range half, from the group's first counted game — or, on a
 * person's page, from theirs. The only window form that carries a year, because it is the only
 * one that can reach one.
 */
export function sinceLabel(day: string): string {
  return `Since ${day}`;
}

/**
 * The picker's accessible name — the noun product uses for the control in `00-product.md`
 * ("time windows the same board is read through"), because a `<nav>` landmark with five links
 * in it and no name is announced as "navigation" beside the one that says `Leaderboard`.
 *
 * It is on screen nowhere: the five options name themselves. **M5.8 owns the visible control**
 * and may give it a visible heading, in which case this string becomes that heading.
 */
export const WINDOW_PICKER_LABEL = 'Time window';

/**
 * A window with nothing in it — on the board and on a player page, the same sentence in both
 * places, exactly as the deleted `No games this season yet.` was used in both.
 *
 * **A running window says `yet`; a closed one does not**, because nothing more is coming to
 * `Last week`. Five constants and not one interpolation, so product can move any one of the
 * five without touching the other four.
 *
 * The two strings that stood here until 2026-09-10 are gone with the word they carried:
 * `NO_GAMES_YET` (`No games this season yet.`) is replaced by these five, and
 * `NO_SEASON_BOARD` (`No season is active…`) is deleted with the button it pointed at
 * (**M5.14**) — a deployment with no season row has no games either, so the empty-window line
 * is both true and enough.
 */
export const WINDOW_EMPTY: Readonly<Record<WindowKind, string>> = {
  'this-week': 'No games this week yet.',
  'last-week': 'No games last week.',
  'this-month': 'No games this month yet.',
  'last-month': 'No games last month.',
  'all-time': 'No games yet.',
};

/**
 * A game that moved nobody's rating, in the rating column of `Recent games` (M3.23, product
 * 2026-09-10).
 *
 * **One vocabulary for every reason.** A game the fold refused (too short, nine players, the
 * same player twice) and a backfilled game that `rebuild-ratings` has not folded yet both read
 * the same three syllables: the reader's question is "why did this not move my number", and
 * the answer is one sentence under the list, not five words per row.
 */
export const NOT_RATED = 'not rated';

/**
 * The sentence under the list, once per page, printed only while a row reads {@link NOT_RATED}
 * — the same placement rule as M3.10's nameless hint (product, 2026-09-10).
 */
export const NOT_RATED_HINT =
  "Some games don't move ratings: too short, short a player, or added from match history and not counted yet.";

/** `05-design.md`, "Rating history": the chart's title, the same word as line 2 of a row. */
export const CHART_TITLE = RATING_LABEL;

/** The label on the hairline reference line, in the same units as the series. */
export const SEED_LABEL = 'seed';

/**
 * The same hairline, in a window: the rating the player carried **into** it (M5.12).
 *
 * `seed` is where the board started them from their rank and it is a fact about their whole
 * history; the line on `This week`'s chart is where Monday found them, which is not a seed and
 * may not borrow the word. `All time` keeps {@link SEED_LABEL}, unchanged.
 */
export const START_LABEL = 'start';

/** The player page's two sections under the chart. Plain nouns; the content is the vocabulary. */
export const ROLE_RECORD_HEADING = 'By role';
export const RECENT_GAMES_HEADING = 'Recent games';

/**
 * A recent game's result on `/p/[puuid]`: **this player's own**, not the winning side's
 * (product, 2026-09-09).
 *
 * The page is about them, and `Red wins` beside their own delta would make a reader work out
 * which side they were on before they could read their own row. Past tense rather than the
 * `13W 15L` letters, because the line is one game that happened and not a tally.
 *
 * They lived in `app/_board/PlayerView.tsx` until M3.19; the copy table in `05-design.md` has
 * one code half, and this is it.
 */
export const WON = 'Won';
export const LOST = 'Lost';

/**
 * The tonight page's rail card at ≥1080px (`05-design.md`, "Breakpoints and the desktop grid").
 * The board's first five rows, under the doc's own name for them — not a fourth word for the
 * destination the nav tab, the heading and the embed all call `Leaderboard`, because this card
 * is a slice of that page and not a second one.
 */
export const TOP_OF_BOARD_TITLE = 'Top of the board';

/** `1 game`, `28 games`. A count of one never prints as `1 games` on the newest player's row. */
export function gamesLabel(games: number): string {
  return games === 1 ? '1 game' : `${games} games`;
}

/** `13W 15L`, the same shape on a row, on the player page and in a role record. */
export function winLossLabel(wins: number, losses: number): string {
  return `${wins}W ${losses}L`;
}
