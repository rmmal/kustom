import { displayRating, seedFromRank } from '@customs/core';
import { describe, expect, it } from 'vitest';
import { displayDelta, formatWebDelta } from '../ratingDisplay';
import { workedPlayer, workedRecentGame } from '../testing/boardFixtures';
import { rankLabel, UNRANKED_LABEL } from './copy';
import { explainGame, explainRatingStart, sideWinChance } from './explain';

/**
 * "How you got here" (M5.15): the two sentences that let somebody retrace their own rating.
 *
 * The rule this file exists to hold is acceptance check 6: **every number printed is
 * byte-identical to what `lib/ratingDisplay.ts` produces**, asserted by calling it rather than
 * by re-rounding here. A test that hard-codes `+43` passes on the day somebody changes the
 * delta rule and the page starts disagreeing with the Discord message about the same game.
 */

describe('the win chance, for the side the player was on', () => {
  it("is blue's own number on 100 and its complement on 200", () => {
    expect(sideWinChance(0.58, 100)).toBe(58);
    expect(sideWinChance(0.58, 200)).toBe(42);
  });

  it('rounds to whole percent, the same way the result card and the embed do', () => {
    expect(sideWinChance(0.4249, 100)).toBe(42);
    expect(sideWinChance(0.425, 100)).toBe(43);
  });

  it('is nothing at all when no split was stored, rather than 50', () => {
    expect(sideWinChance(null, 100)).toBeNull();
    expect(sideWinChance(null, 200)).toBeNull();
  });
});

describe('one row of Recent games', () => {
  it("names the chance their side was given and the change, in product's shape", () => {
    // Won on red, where the split gave blue 58%: their own side was the 42% one.
    const game = workedRecentGame({ won: true, side: 200, blueWinProb: 0.58, muBefore: 23.2, muAfter: 23.9 });

    expect(explainGame(game)).toBe(`Won as the 42% side, ${formatWebDelta(displayDelta(23.2, 23.9))}`);
    // And the number in it is the column's own, not a second rounding of the same two mus.
    expect(explainGame(game)).toContain(formatWebDelta(displayDelta(23.2, 23.9)));
  });

  it('says `Lost as the 58% side` for the favourite that lost', () => {
    const game = workedRecentGame({ won: false, side: 100, blueWinProb: 0.58 });

    expect(explainGame(game)).toBe(`Lost as the 58% side, ${formatWebDelta(displayDelta(23.9, 23.2))}`);
  });

  it('drops the clause for a backfilled game and keeps the result and the change', () => {
    const game = workedRecentGame({ won: true, blueWinProb: null, muBefore: 23.2, muAfter: 23.9 });

    // No chance, no placeholder, no `50%` invented for a game nobody balanced.
    expect(explainGame(game)).toBe(`Won, ${formatWebDelta(displayDelta(23.2, 23.9))}`);
    expect(explainGame(game)).not.toContain('%');
  });

  it('says nothing at all about an unrated game: M3.23 owns that row whole', () => {
    expect(explainGame(workedRecentGame({ muBefore: null, muAfter: null, blueWinProb: 0.6 }))).toBeNull();
    // A half-folded row is not a rating either.
    expect(explainGame(workedRecentGame({ muBefore: 23.9, muAfter: null }))).toBeNull();
  });
});

describe('the seed line', () => {
  it('names the rank as words and the displayed seed, with the games since', () => {
    const player = workedPlayer();

    expect(explainRatingStart(player)).toBe(`Seeded from Silver II at ${player.reference}, 37 games since.`);
  });

  it('is drawn from the same number the chart draws its hairline at', () => {
    const player = workedPlayer();

    expect(player.reference).toBe(displayRating(seedFromRank('SILVER', 'II').mu));
    expect(explainRatingStart(player)).toContain(String(player.reference));
  });

  it('is the whole page for a player with no games, and never says `0 games`', () => {
    const player = workedPlayer('Hana', { games: 0, wins: 0, losses: 0, history: [], recent: [] });

    expect(explainRatingStart(player)).toBe(`Seeded from Silver II at ${player.reference}.`);
    expect(explainRatingStart(player)).not.toMatch(/\b0\b games/);
    expect(explainRatingStart(player)).not.toContain('NaN');
  });

  it('says one game, not `1 games`, for somebody one night in', () => {
    const player = workedPlayer('Hana', { games: 1 });

    expect(explainRatingStart(player)).toBe(`Seeded from Silver II at ${player.reference}, 1 game since.`);
  });

  it('becomes `Started the week` in a week window and `the month` in a month one', () => {
    const week = workedPlayer('Hana', { window: 'this-week', games: 6, reference: 1469 });
    const month = workedPlayer('Hana', { window: 'last-month', games: 14, reference: 1469 });

    expect(explainRatingStart(week)).toBe('Started the week at 1469, 6 games since.');
    expect(explainRatingStart(month)).toBe('Started the month at 1469, 14 games since.');
    // A window never borrows the word `seed`: that hairline is a seed only on `All time`.
    expect(explainRatingStart(week)).not.toContain('Seeded');
  });

  it('says nothing in a window the player did not play: `reference` is only their seed there', () => {
    expect(
      explainRatingStart(workedPlayer('Hana', { window: 'last-week', games: 0, range: null })),
    ).toBeNull();
  });
});

describe('the rank, as words', () => {
  it('title-cases the tier and keeps the division numeral', () => {
    expect(rankLabel('GOLD', 'II')).toBe('Gold II');
    expect(rankLabel('emerald', 'iv')).toBe('Emerald IV');
  });

  it('drops the division for the three tiers that have none', () => {
    expect(rankLabel('MASTER', 'I')).toBe('Master');
    expect(rankLabel('GRANDMASTER', null)).toBe('Grandmaster');
    expect(rankLabel('CHALLENGER', 'I')).toBe('Challenger');
  });

  it('says `Unranked` for a rank the client never reported, and for one core cannot read', () => {
    expect(rankLabel(null, null)).toBe(UNRANKED_LABEL);
    expect(rankLabel('', '')).toBe(UNRANKED_LABEL);
    // The seed for this string is the unranked seed, so the words must be too.
    expect(rankLabel('WOOD', 'IX')).toBe(UNRANKED_LABEL);
  });
});
