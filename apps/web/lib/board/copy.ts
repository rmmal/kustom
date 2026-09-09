/**
 * Every word `/leaderboard` and `/p/[puuid]` say (M3.5, M3.8, M3.10), in one file, spelled the
 * way product and `docs/05-design.md` spell them.
 *
 * The two names are fixed on every surface — **Proven** (`round(ordinal * 60)`, the sort key
 * and the primary number) and **Rating** (`round(mu * 60)`, the number the embeds print) — and
 * no surface invents a third (M3.5 brief; the row in `04-decisions.md`). Capitalised as
 * labels, lower case inside a sentence.
 */

/** The primary number: `round(ordinal * 60)`. Named once per page, in the legend. */
export const PROVEN_LABEL = 'Proven';

/** The secondary number: `round(mu * 60)`. Printed inline on every line 2. */
export const RATING_LABEL = 'Rating';

/**
 * The legend above the list, right-aligned over the two numbers (`05-design.md`, "Leaderboard
 * row"). A legend, not a header row: it does not stick, does not sort, is not tappable, and
 * the words print per row underneath it as well.
 */
export const BOARD_LEGEND = `${PROVEN_LABEL} · ${RATING_LABEL}`;

/**
 * The board's own word (designer, 2026-09-09). `Leaderboard` and not `standings`: it is what
 * `docs/01-architecture.md` and the milestones have called this page since M0, it is the word
 * the group uses, and a second name for a page is exactly the drift the two number names are
 * already policed against.
 *
 * Capitalised as a label — the page heading, the back link, the `<title>` — and lower case
 * inside the embed's title, where it follows the season name in a sentence-shaped line
 * (`Season 1 · leaderboard`), the same rule `Proven` and `Rating` follow.
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
 * player page — and never once per row (product, 2026-09-08 — final, `05-design.md`).
 *
 * The number is interpolated from {@link SETTLING_GAMES} rather than typed, because the M3.8
 * acceptance check is that the number in the sentence is the threshold the marker itself uses.
 * `board/copy.test.ts` pins the assembled string against product's words.
 */
export const SETTLING_SENTENCE =
  `The board sorts on ${PROVEN_LABEL}, which stays below your rating until it has seen about ${SETTLING_GAMES} games. New players start low on purpose and climb as they play.` as const;

/** The short form, for the one-line Discord footer where two sentences will not fit. */
export const SETTLING_SENTENCE_SHORT =
  `${PROVEN_LABEL} stays below a new player's rating until the board has seen about ${SETTLING_GAMES} games.` as const;

/**
 * A season that has no games yet, and a player who has none (M3.5's edge cases: "not an empty
 * page, not a spinner").
 *
 * New copy, 2026-09-09, in the shape of the tonight page's `Nobody in the lobby yet.` —
 * `05-design.md` designs the empty states for that page and names none for this one. A row in
 * `04-decisions.md`; product may replace the sentence without anything else moving.
 */
export const NO_GAMES_YET = 'No games this season yet.';

/**
 * No season is active at all. Neither of `lib/season.ts`'s two sentences fits: the admin one
 * ends by naming a page most readers cannot open, and the tonight one is about tonight's games
 * not being saved, which is not what an empty board is about. Same construction as the tonight
 * page's (M3.17): the fact, then who can fix it, and nothing to tap. Recorded in
 * `04-decisions.md`; product owns the words.
 */
export const NO_SEASON_BOARD = 'No season is active, so there is no board yet. An admin can start one.';

/** `05-design.md`, "Rating history": the chart's title, the same word as line 2 of a row. */
export const CHART_TITLE = RATING_LABEL;

/** The label on the hairline reference line, in the same units as the series. */
export const SEED_LABEL = 'seed';

/** The player page's two sections under the chart. Plain nouns; the content is the vocabulary. */
export const ROLE_RECORD_HEADING = 'By role';
export const RECENT_GAMES_HEADING = 'Recent games';

/** `1 game`, `28 games`. A count of one never prints as `1 games` on the newest player's row. */
export function gamesLabel(games: number): string {
  return games === 1 ? '1 game' : `${games} games`;
}

/** `13W 15L`, the same shape on a row, on the player page and in a role record. */
export function winLossLabel(wins: number, losses: number): string {
  return `${wins}W ${losses}L`;
}
