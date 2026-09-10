import type { SideValue } from '@customs/db';
import { displayDelta, formatWebDelta } from '../ratingDisplay';
import { gameExplanation, seededLine, startedLine } from './copy';
import type { PlayerBoardView, RecentGame } from './types';

/**
 * "How you got here" (M5.15): the two sentences that say why a rating is where it is.
 *
 * Somebody is sure the bot is wrong about them. They open their own page and read, in order,
 * where they started and then every game since — what the balancer thought their side's chances
 * were, what happened, and what it cost or paid. **A number you can retrace is a number you stop
 * arguing with**, which is the same reason the split posts its win chance (`00-product.md`,
 * principle 3).
 *
 * Nothing here computes a rating. Both functions take numbers the loader already read and hand
 * them to `lib/ratingDisplay.ts` and to `lib/board/copy.ts` — the delta in the sentence is the
 * *same call* the column beside it makes, so the two can never disagree by a point.
 *
 * Pure, and separate from the component, because these are the lines M5.15 is judged on and a
 * ternary inside a `<p>` is not something a test can hold.
 */

/**
 * The chance the balancer gave **this player's own side**, as a whole number of percent, or
 * `null` when the game has no stored split.
 *
 * `splits.blue_win_prob` is blue's; red's is its complement. `Math.round(p × 100)`, which is
 * the same rounding `favoredClause` prints in the result card and in the Discord embed, so the
 * page and the message name the same percentage for the same game.
 */
export function sideWinChance(blueWinProb: number | null, side: SideValue): number | null {
  if (blueWinProb === null) return null;
  return Math.round((side === 100 ? blueWinProb : 1 - blueWinProb) * 100);
}

/**
 * One row of `Recent games`, in a sentence: `Won as the 42% side, +43`.
 *
 * `null` for a row the fold did not rate — M3.23's `not rated` is the whole row, with no
 * chance, no change and now no sentence either — and the win-chance clause is dropped for
 * every game with no stored split: a backfilled game, a game whose lobby row was cleared, a
 * game the group played without the bot. **No row invents a chance and no row is hidden**
 * (product, 2026-09-10).
 */
export function explainGame(game: RecentGame): string | null {
  if (game.muBefore === null || game.muAfter === null) return null;

  return gameExplanation(
    game.won,
    sideWinChance(game.blueWinProb, game.side),
    formatWebDelta(displayDelta(game.muBefore, game.muAfter)),
  );
}

/**
 * The line above the chart: `Seeded from Gold II at 1469, 37 games since.` on `All time`, and
 * `Started the week at 1469, 6 games since.` in a window (M5.12's four).
 *
 * The number is `player.reference` — **the value the chart's reference line is drawn from** —
 * read once so the hairline and the sentence cannot disagree, exactly as the chart's `seed` /
 * `start` labels already switch on the window.
 *
 * `null` in a window this player has no counted game in: `reference` falls back to their seed
 * there, and `Started the week at <their seed>` would name a number the week never saw. The
 * window's own empty sentence is already on the page and says the true thing.
 */
export function explainRatingStart(player: PlayerBoardView): string | null {
  if (player.window === 'all-time') return seededLine(player.seedRank, player.reference, player.games);
  return player.games === 0 ? null : startedLine(player.window, player.reference, player.games);
}
