import { displayRating } from '@customs/core';

/**
 * The display boundary for ratings (M3.3), in one place.
 *
 * `packages/core` keeps `displayRating` and gains no delta concept; this is where the two
 * stored numbers of a finished game become the pair a friend reads. Every surface that prints
 * a change — the result embed, the tonight page, `/p/[puuid]` — calls `displayDelta`, so the
 * Discord message and the web page can never disagree about the same game.
 */

/**
 * **The delta rule.** Round both ratings first, then subtract:
 * `displayRating(muAfter) - displayRating(muBefore)`. Never `round((muAfter - muBefore) * 60)`.
 *
 * The row on the screen has to add up — `1469 (+43)` next to a new rating of `1512` — and it
 * only does under this rule. Recorded in `04-decisions.md`.
 *
 * **A change too small to round to a point keeps its direction**, as `-0` when the rating went
 * down. `05-design.md`, "Rating delta": `(0)` never appears, because a column of ten signed
 * numbers with one unsigned entry reads as a bug. `-0` is the honest carrier for that — it is
 * a real number a caller can print, compare with `Object.is`, or ignore — and it costs no
 * extra field on every row that will never need one.
 */
export function displayDelta(muBefore: number, muAfter: number): number {
  const delta = displayRating(muAfter) - displayRating(muBefore);
  return delta === 0 && muAfter < muBefore ? -0 : delta;
}
