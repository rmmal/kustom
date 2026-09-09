import { describe, expect, it } from 'vitest';
import type { BoardView } from '../board/types';
import { workedBoardRows } from '../testing/boardFixtures';
import { nightlyLeaderboardSkip } from './post';

/**
 * When the nightly board is not worth posting (M3.5, product 2026-09-09).
 *
 * The rule is the result embed's: a message that says nothing is worse than silence. The third
 * case is the one that only shows up on the first morning of a season, which is exactly when
 * nobody is watching the channel for a bug.
 */

const SEASON = { id: 'season-1', name: 'Season 1' };

function board(overrides: Partial<BoardView> = {}): BoardView {
  return { season: SEASON, rows: workedBoardRows(), ...overrides };
}

describe('nightlyLeaderboardSkip', () => {
  it('posts a season that has been played', () => {
    expect(nightlyLeaderboardSkip(board())).toBeNull();
  });

  it('says nothing when no season is active', () => {
    expect(nightlyLeaderboardSkip(board({ season: null, rows: [] }))).toBe('no active season');
  });

  it('says nothing when nobody is on the board', () => {
    expect(nightlyLeaderboardSkip(board({ rows: [] }))).toBe('nobody on the board');
  });

  it('says nothing on the first morning of a season nobody has played yet', () => {
    // Every known player is seeded from their rank, so this board is ten real names with real
    // Proven numbers and `0 games` against every one of them — a ranking of a season that has
    // not happened, while `/leaderboard` says `No games this season yet.`
    const seeded = workedBoardRows().map((row) => ({
      ...row,
      games: 0,
      wins: 0,
      losses: 0,
      streak: null,
      settling: true,
    }));

    expect(nightlyLeaderboardSkip(board({ rows: seeded }))).toBe('no games this season');
  });

  it('posts again after one rated game', () => {
    const seeded = workedBoardRows().map((row) => ({
      ...row,
      games: 0,
      wins: 0,
      losses: 0,
      streak: null,
      settling: true,
    }));
    const first = seeded[0] as (typeof seeded)[number];
    const played = [{ ...first, games: 1, wins: 1, losses: 0 }, ...seeded.slice(1)];

    expect(nightlyLeaderboardSkip(board({ rows: played }))).toBeNull();
  });
});
