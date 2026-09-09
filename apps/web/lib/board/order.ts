import { renderWebName } from '../tonight/copy';
import type { BoardRow } from './types';

/**
 * The board's order (M3.5): **descending Proven**, and nothing else decides it.
 *
 * "The sort order and the primary number are the same number, on every surface, with no
 * exception" is product's rule, and it is enforced here rather than in a query: `ratings` has
 * a generated `ordinal` column and an index on it, but the integer the page prints comes
 * through `provenRating`, and a row is where its printed number puts it. Reading the primary
 * column top to bottom then never goes up, which is the whole complaint M3.8 exists to
 * prevent.
 *
 * Pure and separate from the loader so the tie rules are a unit test rather than a night.
 */

/**
 * Proven, then Rating, then the name a reader sees, then the puuid.
 *
 * The brief fixes the first three; the puuid is what makes the order stable between renders
 * when even the names are equal — two players the database has no name for both render
 * `Someone`, which `localeCompare` cannot separate, and a board that reshuffles them between
 * two page loads is a board people stop trusting.
 */
export function compareBoardRows(a: BoardRow, b: BoardRow): number {
  return (
    b.proven - a.proven ||
    b.rating - a.rating ||
    renderWebName(a.name).localeCompare(renderWebName(b.name)) ||
    (a.puuid < b.puuid ? -1 : a.puuid > b.puuid ? 1 : 0)
  );
}

/** A new array; the caller's is never sorted in place. */
export function sortBoardRows(rows: readonly BoardRow[]): BoardRow[] {
  return [...rows].sort(compareBoardRows);
}
