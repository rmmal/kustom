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
 */
export function displayDelta(muBefore: number, muAfter: number): number {
  return displayRating(muAfter) - displayRating(muBefore);
}
