import { displayRating, seedFromRank } from '@customs/core';
import { SETTLING_GAMES } from '../board/copy';
import { sortBoardRows } from '../board/order';
import type { BoardRow, BoardView, PlayerSeasonView, RecentGame } from '../board/types';
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
        settling: games < SETTLING_GAMES,
      };
    }),
  );
}

export function workedBoard(overrides: Partial<BoardView> = {}): BoardView {
  return { season: { id: 'season-1', name: 'Season 1' }, rows: workedBoardRows(), ...overrides };
}

/** One player's page, built from the same roster. `Hana` by default: 37 games, no chip. */
export function workedPlayer(name = 'Hana', overrides: Partial<PlayerSeasonView> = {}): PlayerSeasonView {
  const player = WORKED_ROSTER.find((entry) => entry.name === name);
  if (player === undefined) throw new Error(`no worked player called ${name}`);

  const games = WORKED_GAMES[name] ?? 0;
  const wins = workedWins(games);
  const rating = displayRating(player.mu);
  const seed = displayRating(seedFromRank('SILVER', 'II').mu);

  return {
    kind: 'season',
    puuid: workedPuuid(name),
    name,
    season: { id: 'season-1', name: 'Season 1' },
    rating,
    proven: provenRating({ mu: player.mu, sigma: player.sigma }),
    games,
    wins,
    losses: games - wins,
    settling: games < SETTLING_GAMES,
    seed,
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
