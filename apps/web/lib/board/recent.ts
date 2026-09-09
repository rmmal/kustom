/**
 * Which games `Recent games` on `/p/[puuid]` lists (M3.23, product 2026-09-10).
 *
 * **The last five games this player played, rated or not.** The loader used to filter
 * `mu_after !== null` before it took the five, so a game that landed unrated — every backfilled
 * game until `rebuild-ratings` runs, and every game the fold refused for being too short or a
 * player short — was simply missing from the list with nothing saying why, while it sat in the
 * database and on `/admin/games`. A gap in a list of five is a page that disagrees with the
 * night the reader remembers.
 *
 * Everything a rating is folded from stays rated-only and is **not** this function: the two
 * numbers, the chart series, the seed line, the by-role record and the `37 games · 20W 17L`
 * line all count the games `ratings.games` counted. This decides one list.
 */

/** The shape both the loader's rows and the tests need: when it was, and whether it counted. */
export interface DatedGame {
  /** ISO 8601, from `games.started_at`. */
  startedAt: string;
  /** `null` for a game no rating was folded from: the row prints `not rated`. */
  muAfter: number | null;
}

/**
 * The newest `limit` games, newest first, unrated ones among them.
 *
 * The input may be in any order — `game_players` comes back in whatever order Postgres feels
 * like — so the sort is here rather than assumed. Ties on `started_at` keep the order they
 * arrived in, which is `Array.prototype.sort`'s guarantee, so two games of the same night do
 * not swap between two renders of the same page.
 */
export function recentGames<T extends DatedGame>(games: readonly T[], limit: number): T[] {
  return [...games]
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .slice(0, Math.max(0, limit));
}

/** Whether a listed game moved this player's rating. The row's `not rated` label hangs off it. */
export function isRated(game: DatedGame): boolean {
  return game.muAfter !== null;
}
