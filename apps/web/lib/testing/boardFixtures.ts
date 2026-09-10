import { displayRating, seedFromRank } from '@customs/core';
import { rankLabel, SETTLING_GAMES } from '../board/copy';
import { sortBoardRows } from '../board/order';
import type { BoardRow, BoardView, PlayerBoardView, RecentGame } from '../board/types';
import type { WindowKind } from '../night';
import { provenRating, provenSortKey } from '../ratingDisplay';
import { WORKED_ROSTER, workedPuuid } from './workedExample';

/**
 * The worked example as `/leaderboard` and `/p/[puuid]` see it (M3.5).
 *
 * The same ten friends and the same `mu`/`sigma` as every other fixture in this repo, so the
 * Proven numbers here are the ones printed in `docs/05-design.md`'s nightly embed — Lena
 * `1548`, Nadia `654`, Yuki `534` — and a snapshot of the embed is comparable with the design
 * doc line for line. Nothing is hand-computed: `provenRating` and `displayRating` do it.
 *
 * The game counts are the design doc's illustrative ones (the docs pin none), which is what
 * puts Nadia and Yuki under thirty and therefore under the `settling` chip.
 */

export const WORKED_GAMES: Readonly<Record<string, number>> = {
  Lena: 41,
  Bilal: 44,
  Rami: 39,
  Iris: 38,
  Karim: 40,
  Omar: 42,
  Hana: 37,
  Theo: 38,
  Nadia: 28,
  Yuki: 24,
};

/** Half their games, rounded: illustrative, like the counts. Nothing in the docs pins wins. */
function workedWins(games: number): number {
  return Math.round(games / 2);
}

/** The rank every fixture player is seeded from: Silver II, the roster's own middle. */
const SEED_TIER = 'SILVER';
const SEED_DIVISION = 'II';

export function workedBoardRows(): BoardRow[] {
  return sortBoardRows(
    WORKED_ROSTER.map((player) => {
      const games = WORKED_GAMES[player.name] ?? 0;
      const wins = workedWins(games);
      return {
        puuid: workedPuuid(player.name),
        name: player.name,
        proven: provenRating({ mu: player.mu, sigma: player.sigma }),
        sortKey: provenSortKey({ mu: player.mu, sigma: player.sigma }),
        rating: displayRating(player.mu),
        games,
        wins,
        losses: games - wins,
        streak: games === 0 ? null : ({ kind: 'L', length: 2 } as const),
        climb: null,
        settling: games < SETTLING_GAMES,
      };
    }),
  );
}

export function workedBoard(overrides: Partial<BoardView> = {}): BoardView {
  const rows = overrides.rows ?? workedBoardRows();
  return {
    window: 'all-time',
    rows,
    // The group's first night, and the fold's own count of what it has played since.
    range: 'Since 8 Sep 2025',
    games: 312,
    ...overrides,
  };
}

/**
 * The same ten as one **window's** board (M5.12): six games each, a 4W 2L record, and a climb
 * that is a real pair of mu values rather than a formatted number — the row computes the delta
 * at render, like every other delta in this product.
 *
 * The two numbers are untouched: a window changes who is on the board and what their week was,
 * never the sort or the numbers' meaning.
 */
export function workedWindowRows(): BoardRow[] {
  return workedBoardRows().map((row) => ({
    ...row,
    games: 6,
    wins: 4,
    losses: 2,
    streak: null,
    // +58 at the display multiplier of 60: `mu` 23.9 to 24.87 is 1434 to 1492.
    climb: { muBefore: 23.9, muAfter: 24.87 },
  }));
}

export function workedWindowBoard(window: WindowKind = 'this-week'): BoardView {
  return {
    window,
    rows: workedWindowRows(),
    // The week `05-design.md`'s copy table prints, and the count the ten rows add up to.
    range: window === 'this-month' || window === 'last-month' ? 'September' : 'Monday 1 Sep to Sunday 7 Sep',
    games: 6,
  };
}

/** The same board with nothing in the window: the slot prints the sentence and no card. */
export function emptyWindowBoard(window: WindowKind = 'last-week'): BoardView {
  return { window, rows: [], range: null, games: 0 };
}

/** One player's page, built from the same roster. `Hana` by default: 37 games, no chip. */
export function workedPlayer(name = 'Hana', overrides: Partial<PlayerBoardView> = {}): PlayerBoardView {
  const player = WORKED_ROSTER.find((entry) => entry.name === name);
  if (player === undefined) throw new Error(`no worked player called ${name}`);

  const games = WORKED_GAMES[name] ?? 0;
  const wins = workedWins(games);
  const rating = displayRating(player.mu);
  // One rank, read twice: the number the chart's hairline is drawn at and the words M5.15's
  // seed line names it with come from the same pair, exactly as the loader reads them.
  const seed = displayRating(seedFromRank(SEED_TIER, SEED_DIVISION).mu);

  return {
    puuid: workedPuuid(name),
    name,
    window: 'all-time',
    rating,
    proven: provenRating({ mu: player.mu, sigma: player.sigma }),
    games,
    wins,
    losses: games - wins,
    settling: games < SETTLING_GAMES,
    range: 'Since 8 Sep 2025',
    seedRank: rankLabel(SEED_TIER, SEED_DIVISION),
    reference: seed,
    // A short walk that ends where the roster says they are, so the chart's last point and the
    // `Rating` beside it are the same number — and that starts above the seed, so the
    // reference line is outside the series and the range has to widen to keep it on screen.
    history: [seed + 60, seed + 90, rating - 42, rating],
    roles: [
      { role: 'top', games: 20, wins: 11, losses: 9 },
      { role: 'mid', games: 17, wins: 7, losses: 10 },
    ],
    recent: [workedRecentGame()],
    ...overrides,
  };
}

export function workedRecentGame(overrides: Partial<RecentGame> = {}): RecentGame {
  return {
    gameId: 'game-1',
    startedAt: '2026-09-08T20:12:00.000Z',
    durationS: 2_052,
    won: false,
    side: 100,
    role: 'top',
    muBefore: 23.9,
    muAfter: 23.2,
    // The split the group played gave blue 58%: Hana was on 100 and lost as the favourite,
    // which is the second of product's two worked sentences (M5.15).
    blueWinProb: 0.58,
    team: [
      { puuid: workedPuuid('Hana'), name: 'Hana', role: 'top' },
      { puuid: workedPuuid('Iris'), name: 'Iris', role: 'jungle' },
      { puuid: workedPuuid('Karim'), name: 'Karim', role: 'mid' },
      { puuid: workedPuuid('Bilal'), name: 'Bilal', role: 'adc' },
      { puuid: workedPuuid('Theo'), name: 'Theo', role: 'support' },
    ],
    ...overrides,
  };
}
