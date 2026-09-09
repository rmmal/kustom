import { describe, expect, it } from 'vitest';
import { provenRating } from '../ratingDisplay';
import { workedBoardRows } from '../testing/boardFixtures';
import { CHART_HEIGHT, CHART_WIDTH, chartGeometry } from './chart';
import { gamesLabel, NO_GAMES_YET, SETTLING_GAMES, SETTLING_SENTENCE_SHORT, winLossLabel } from './copy';
import { compareBoardRows, sortBoardRows } from './order';
import { currentStreak, formatStreak } from './streak';
import type { BoardRow } from './types';

/**
 * The pure half of the board (M3.5): the sort, the streak, the chart's geometry and the copy
 * product owns. Everything with a page around it is in `app/_board/*.test.tsx`; everything
 * with a database behind it is in `app/board.integration.test.ts`.
 */

function row(overrides: Partial<BoardRow>): BoardRow {
  return {
    puuid: 'puuid-a',
    name: 'A',
    proven: 900,
    rating: 1_400,
    games: 40,
    wins: 20,
    losses: 20,
    streak: null,
    ...overrides,
  };
}

describe('the copy product owns', () => {
  it('is the short form Discord gets as a footer', () => {
    expect(SETTLING_SENTENCE_SHORT).toBe(
      "Proven stays below a new player's rating until the board has seen about 30 games.",
    );
  });

  it('says the number the threshold is set to, rather than a typed one', () => {
    expect(SETTLING_GAMES).toBe(30);
    expect(SETTLING_SENTENCE_SHORT).toContain(`about ${SETTLING_GAMES} games`);
  });

  it('never prints `1 games` on the row of the newest player', () => {
    expect(gamesLabel(0)).toBe('0 games');
    expect(gamesLabel(1)).toBe('1 game');
    expect(gamesLabel(28)).toBe('28 games');
    expect(winLossLabel(13, 15)).toBe('13W 15L');
  });

  it('has one line for a season with no games and a player with none', () => {
    expect(NO_GAMES_YET).toBe('No games this season yet.');
  });
});

describe('the board is ordered by Proven, descending', () => {
  it('never lets the primary column go up as you read down it', () => {
    const rows = workedBoardRows();

    expect(rows.map((entry) => entry.name)).toEqual([
      'Lena',
      'Bilal',
      'Rami',
      'Iris',
      'Karim',
      'Omar',
      'Hana',
      'Theo',
      'Nadia',
      'Yuki',
    ]);
    // The design doc's own arithmetic: Lena `34.80 - 2 * 4.50 = 25.80`, `* 60 = 1548`.
    expect(rows.map((entry) => entry.proven)).toEqual([
      1_548, 1_137, 1_062, 990, 987, 917, 882, 831, 654, 534,
    ]);
    for (const [index, entry] of rows.entries()) {
      expect(entry.proven).toBeLessThanOrEqual(rows[index - 1]?.proven ?? entry.proven);
    }
  });

  it('compresses: Proven is not Rating with a constant taken off it', () => {
    const rows = workedBoardRows();
    const by = (name: string): BoardRow => rows.find((entry) => entry.name === name) as BoardRow;

    // `05-design.md`: Iris and Karim land 3 points apart on Proven against a 27-point Rating
    // gap, which is why the number is `t-md` mono tabular and never abbreviated — `990` above
    // `987` has to read as ordered rather than as equal.
    expect(by('Iris').rating - by('Karim').rating).toBe(27);
    expect(by('Iris').proven - by('Karim').proven).toBe(3);

    // And Yuki is last by a wider margin than her rating suggests: her sigma is the second
    // highest in the room. That is the whole point of the column.
    expect(rows.at(-1)?.name).toBe('Yuki');
    expect(by('Nadia').rating - by('Yuki').rating).toBe(132);
    expect(by('Nadia').proven - by('Yuki').proven).toBe(120);
  });

  it('breaks a tie on Rating, then on the name a reader sees, then on the puuid', () => {
    const tied = sortBoardRows([
      row({ puuid: 'puuid-c', name: 'Cara', proven: 900, rating: 1_400 }),
      row({ puuid: 'puuid-a', name: 'Ali', proven: 900, rating: 1_400 }),
      row({ puuid: 'puuid-b', name: 'Bea', proven: 900, rating: 1_450 }),
    ]);

    expect(tied.map((entry) => entry.name)).toEqual(['Bea', 'Ali', 'Cara']);
  });

  it('keeps two nameless players in the same order between renders', () => {
    const a = row({ puuid: 'puuid-a', name: null });
    const b = row({ puuid: 'puuid-b', name: null });

    expect(compareBoardRows(a, b)).toBeLessThan(0);
    expect(compareBoardRows(b, a)).toBeGreaterThan(0);
  });

  it('puts a seeded player with no games at the bottom rather than filtering them out', () => {
    const seeded = row({ puuid: 'puuid-new', name: 'New', proven: 0, rating: 1_200, games: 0 });
    const rows = sortBoardRows([seeded, ...workedBoardRows()]);

    expect(rows.at(-1)?.name).toBe('New');
    expect(rows).toHaveLength(11);
  });

  it('agrees with `provenRating`, which is the one place the number is computed', () => {
    expect(provenRating({ mu: 34.8, sigma: 4.5 })).toBe(1_548);
    expect(provenRating({ mu: 24.49, sigma: 4.6 })).toBe(917);
  });
});

describe('the streak column', () => {
  it('counts the run at the front of the list, newest first', () => {
    expect(currentStreak([false, false, true, false])).toEqual({ kind: 'L', length: 2 });
    expect(currentStreak([true, true, true])).toEqual({ kind: 'W', length: 3 });
    expect(currentStreak([true, false])).toEqual({ kind: 'W', length: 1 });
  });

  it('is nothing at all for a player who has not played', () => {
    expect(currentStreak([])).toBeNull();
  });

  it('prints as `L2`', () => {
    expect(formatStreak({ kind: 'L', length: 2 })).toBe('L2');
    expect(formatStreak({ kind: 'W', length: 11 })).toBe('W11');
  });
});

describe('the rating chart', () => {
  it('draws nothing for a player with no history', () => {
    expect(chartGeometry([], 1_200)).toBeNull();
  });

  it('plots the series across the full width, oldest at the left', () => {
    const geometry = chartGeometry([1_200, 1_300, 1_250], 1_200);

    expect(geometry?.path.startsWith('M0,')).toBe(true);
    expect(geometry?.path).toContain(`L${CHART_WIDTH},`);
    expect(geometry?.path.split(' ')).toHaveLength(3);
    expect(geometry?.width).toBe(CHART_WIDTH);
    expect(geometry?.height).toBe(CHART_HEIGHT);
  });

  it('pads the range by 5% so the highest and lowest points are not on the edge', () => {
    const geometry = chartGeometry([1_000, 1_100], 1_050);

    expect(geometry?.low).toBeCloseTo(995, 5);
    expect(geometry?.high).toBeCloseTo(1_105, 5);
  });

  it('keeps the seed line inside the range even when that widens it', () => {
    const below = chartGeometry([1_400, 1_500], 1_200);
    expect(below?.low).toBeLessThan(1_200);
    expect(below?.seedY).toBeLessThan(CHART_HEIGHT);
    expect(below?.seedY).toBeGreaterThan(0);

    const above = chartGeometry([1_000, 1_050], 1_400);
    expect(above?.high).toBeGreaterThan(1_400);
    expect(above?.seedY).toBeGreaterThan(0);
    expect(above?.seedPercent).toBeGreaterThan(0);
    expect(above?.seedPercent).toBeLessThan(100);
  });

  it('draws a flat rating as a line rather than dividing by zero', () => {
    const geometry = chartGeometry([1_200, 1_200, 1_200], 1_200);

    expect(geometry?.path).toBe('M0,70 L160,70 L320,70');
    expect(geometry?.seedY).toBe(70);
  });

  it('puts a higher rating higher up the box', () => {
    const geometry = chartGeometry([1_000, 1_500], 1_200);
    const [first, last] = (geometry?.path ?? '').split(' ');

    const y = (point: string | undefined): number => Number((point ?? '').split(',')[1]);
    expect(y(last)).toBeLessThan(y(first));
  });
});
