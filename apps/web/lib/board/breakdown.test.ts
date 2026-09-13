import { describe, expect, it } from 'vitest';
import { displayDelta, formatWebDelta } from '../ratingDisplay';
import { boardBreakdown } from './breakdown';

const CAIRO = 'Africa/Cairo';

describe('boardBreakdown', () => {
  it('orders newest first and formats the night in the given zone', () => {
    const games = boardBreakdown(
      [
        {
          gameId: 'older',
          startedAt: '2026-09-08T20:12:00.000Z',
          durationS: 2_000,
          won: true,
          side: 100,
          muBefore: 23.2,
          muAfter: 23.9,
        },
        {
          gameId: 'newer',
          startedAt: '2026-09-09T23:30:00.000Z',
          durationS: 1_800,
          won: false,
          side: 200,
          muBefore: 23.9,
          muAfter: 23.2,
        },
      ],
      CAIRO,
    );

    expect(games.map((game) => game.gameId)).toEqual(['newer', 'older']);
    // 23:30 UTC on the 9th is 02:30 Cairo on the 10th — the night they played it.
    expect(games[0]?.startedLabel).toBe('10 Sep');
    expect(games[1]?.startedLabel).toBe('8 Sep');
  });

  it('keeps the two mu values so the printed delta is the difference of two ratings', () => {
    const [game] = boardBreakdown(
      [
        {
          gameId: 'climb',
          startedAt: '2026-09-08T20:12:00.000Z',
          durationS: 2_000,
          won: true,
          side: 100,
          muBefore: 23.9,
          muAfter: 24.87,
        },
      ],
      CAIRO,
    );

    expect(game).toMatchObject({ muBefore: 23.9, muAfter: 24.87 });
    expect(formatWebDelta(displayDelta(game?.muBefore ?? 0, game?.muAfter ?? 0))).toBe('+58');
  });
});
