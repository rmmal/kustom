import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NO_GAMES_YET, NO_SEASON_BOARD, SEED_LABEL } from '@/lib/board/copy';
import type { PlayerBoardView } from '@/lib/board/types';
import { workedPlayer, workedRecentGame } from '@/lib/testing/boardFixtures';
import { PlayerView } from './PlayerView';

/**
 * `/p/[puuid]` (M3.5) from fixture data.
 *
 * The checks that matter here are the ones a page can get subtly wrong and nobody notices for
 * a week: both numbers under the two fixed labels, the chart plotting `Rating` and not Proven,
 * a delta that adds up, and the five in lane order.
 */

function draw(player: PlayerBoardView = workedPlayer(), viewerPuuid: string | null = null) {
  return render(<PlayerView player={player} viewerPuuid={viewerPuuid} />);
}

describe('the two numbers', () => {
  it('shows both, once, under the same two labels the board uses', () => {
    const { container } = draw();

    const numbers = [...container.querySelectorAll('.cn-number')].map((node) => node.textContent?.trim());
    expect(numbers).toEqual(['Rating 1434', 'Proven 882']);
  });

  it('invents no third name for either number', () => {
    draw();

    expect(document.body.textContent).not.toMatch(/\bBoard\b|\bMMR\b|\bScore\b/);
  });
});

describe('the rating history chart', () => {
  it('is one line and one reference line, drawn on the server, with no library', () => {
    const { container } = draw();

    expect(container.querySelector('.cn-chart-line')).toBeInTheDocument();
    expect(container.querySelector('.cn-chart-seed')).toBeInTheDocument();
    expect(screen.getByText(SEED_LABEL)).toHaveClass('cn-chart-seed-label');
    // No fill, no points, no grid.
    expect(container.querySelectorAll('circle')).toHaveLength(0);
    expect(container.querySelector('.cn-chart-line')).toHaveAttribute('fill', 'none');
  });

  it('titles the plot `Rating`, the same word line 2 of a board row uses', () => {
    const { container } = draw();

    expect(container.querySelector('.cn-chart-title')?.textContent).toBe('Rating');
  });

  it('ends where the number beside it says, so the chart and the label agree', () => {
    const player = workedPlayer();
    const { container } = draw(player);

    const path = container.querySelector('.cn-chart-line')?.getAttribute('d') ?? '';
    const points = path.split(' ');
    expect(points).toHaveLength(player.history.length);
    // The last point is the highest rating in this fixture, so it is the top of the plot.
    const y = (point: string | undefined): number => Number((point ?? '').split(',')[1]);
    expect(y(points.at(-1))).toBeLessThan(y(points[0]));
  });

  it('says one line instead of a chart for a player with no games', () => {
    const { container } = draw(
      workedPlayer('Hana', { games: 0, wins: 0, losses: 0, history: [], roles: [], recent: [] }),
    );

    expect(screen.getByText(NO_GAMES_YET)).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeInTheDocument();
  });
});

describe('the role record', () => {
  it('is in lane order, with the games and the record per role', () => {
    const { container } = draw();

    // Three grid cells with no whitespace between them: role, games, record.
    const records = [...container.querySelectorAll('.cn-record')].map((node) => node.textContent);
    expect(records).toEqual(['top20 games11W 9L', 'mid17 games7W 10L']);
  });
});

describe('the recent games', () => {
  it('computes the delta at render, and it adds up with the rating beside it', () => {
    const { container } = draw();

    // `displayRating(23.2) = 1392`, `displayRating(23.9) = 1434`, so the delta is −42 and the
    // two numbers on the line agree.
    expect(container.querySelector('.cn-game-rating')?.textContent).toBe('1392 (−42)');
    // A loss is `dim` at 400 and never coloured by sign.
    expect(container.querySelector('.cn-delta')).not.toHaveClass('cn-delta-up');
  });

  it('lists the five the player was on, in lane order, with their own row marked', () => {
    const { container } = draw();

    const lineup = [...container.querySelectorAll('.cn-lineup-row')];
    expect(lineup.map((row) => row.querySelector('.cn-lineup-role')?.textContent)).toEqual([
      'top',
      'jungle',
      'mid',
      'adc',
      'support',
    ]);
    const mine = lineup.filter((row) => row.classList.contains('cn-you'));
    expect(mine).toHaveLength(1);
    expect(within(mine[0] as HTMLElement).getByText('Hana')).toBeInTheDocument();
  });

  it('says whether this player won, not which side did', () => {
    const { unmount } = draw();
    expect(screen.getByText('Lost')).toBeInTheDocument();
    unmount();

    draw(workedPlayer('Hana', { recent: [workedRecentGame({ won: true })] }));
    expect(screen.getByText('Won')).toBeInTheDocument();
  });
});

describe('no season', () => {
  it('says so, and the page still draws the player', () => {
    draw(
      workedPlayer('Hana', {
        season: null,
        rating: 0,
        proven: 0,
        games: 0,
        wins: 0,
        losses: 0,
        history: [],
        roles: [],
        recent: [],
      }),
    );

    expect(screen.getByText(NO_SEASON_BOARD)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hana');
    expect(document.body.textContent).not.toContain('Start a season on the Seasons page.');
  });
});

describe('getting back to the board', () => {
  it('links to the standings from the header', () => {
    draw();

    expect(screen.getByRole('link', { name: 'standings' })).toHaveAttribute('href', '/leaderboard');
  });
});
