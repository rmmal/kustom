import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  NO_GAMES_YET,
  NO_SEASON_BOARD,
  PROVEN_LABEL,
  RATING_LABEL,
  SEED_LABEL,
  SETTLING_CHIP,
  SETTLING_SENTENCE,
} from '@/lib/board/copy';
import type { PlayerBoardView } from '@/lib/board/types';
import { workedPlayer, workedRecentGame } from '@/lib/testing/boardFixtures';
import { workedPuuid } from '@/lib/testing/workedExample';
import { NAMELESS_HINT } from '@/lib/tonight/copy';
import { PlayerView } from './PlayerView';

/**
 * `/p/[puuid]` (M3.5, M3.8, M3.10) from fixture data.
 *
 * The checks that matter here are the ones a page can get subtly wrong and nobody notices for
 * a week: both numbers under the two fixed labels, the chart plotting `Rating` and not Proven,
 * a delta that adds up, the five in lane order, and the chip and its sentence.
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

    expect(document.body.textContent).not.toMatch(/\bMMR\b|\bScore\b/);
  });

  it('prints the record directly under them, the way a board row does', () => {
    const { container } = draw();

    // Hana: 37 games in the fixture, half of them won.
    expect(container.querySelector('.cn-row-meta')?.textContent).toBe('37 games · 19W 18L');
    // Directly under: the two are one block, not two blocks a gap apart.
    const summary = container.querySelector('.cn-summary');
    expect([...(summary?.children ?? [])].map((child) => child.className)).toEqual([
      'cn-numbers',
      'cn-row-meta',
    ]);
  });

  it('says `1 game` for somebody with one, never `1 games`', () => {
    const { container } = draw(workedPlayer('Hana', { games: 1, wins: 1, losses: 0 }));

    expect(container.querySelector('.cn-row-meta')?.textContent).toBe('1 game · 1W 0L');
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

  /**
   * The line is about the **season**, not about the chart. It used to be gated on
   * `history.length === 0`, which is also true for a player whose games the season read did not
   * reach — so somebody with thirty-seven games could be told the season had none.
   */
  it('does not claim a season is empty for a player who has played it', () => {
    const { container } = draw(workedPlayer('Hana', { history: [] }));

    expect(screen.queryByText(NO_GAMES_YET)).not.toBeInTheDocument();
    // Nothing to plot, so nothing is plotted — and nothing is claimed either.
    expect(container.querySelector('svg')).not.toBeInTheDocument();
    expect(container.querySelector('.cn-row-meta')?.textContent).toContain('37 games');
  });
});

describe('the still-settling marker (M3.8)', () => {
  it('chips a player under 30 games and says the sentence once', () => {
    draw(workedPlayer('Nadia'));

    expect(screen.getByText(SETTLING_CHIP)).toBeInTheDocument();
    expect(screen.getAllByText(SETTLING_SENTENCE)).toHaveLength(1);
  });

  it('is gone at 30 games, chip and sentence together', () => {
    draw(workedPlayer('Nadia', { games: 30, settling: false }));

    expect(screen.queryByText(SETTLING_CHIP)).not.toBeInTheDocument();
    expect(screen.queryByText(SETTLING_SENTENCE)).not.toBeInTheDocument();
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

  it('dates each game, in the configured timezone and a fixed locale', () => {
    const { container } = draw(
      workedPlayer('Hana', {
        recent: [workedRecentGame({ startedAt: '2026-09-09T20:12:00.000Z' })],
      }),
    );

    const head = container.querySelector('.cn-game-head');
    // `9 Sep`, not `Sept` and not the reader's own locale: the string is decided on the server.
    expect(head?.textContent).toContain('9 Sep');
    expect(head?.textContent).not.toContain('Sept');
    // Beside the duration, both mono and dim.
    expect([...(head?.querySelectorAll('.cn-duration') ?? [])].map((node) => node.textContent)).toEqual([
      '9 Sep',
      '34:12',
    ]);
  });

  it('dates a game by the night the group played it, not by UTC', () => {
    // 23:30 UTC is 01:30 the next morning in Africa/Cairo, which is the group's timezone.
    const { container } = draw(
      workedPlayer('Hana', {
        recent: [workedRecentGame({ startedAt: '2026-09-09T23:30:00.000Z' })],
      }),
    );

    expect(container.querySelector('.cn-game-head')?.textContent).toContain('10 Sep');
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

describe('a player with no name (M3.10)', () => {
  it('is `Someone` in the heading, with one line at the foot and never a puuid', () => {
    draw(workedPlayer('Hana', { name: null }));

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Someone');
    expect(screen.getAllByText(NAMELESS_HINT)).toHaveLength(1);
    expect(document.body.textContent).not.toContain(workedPuuid('Hana'));
  });

  it('is `Someone` for a nameless teammate too, and the line is still said once', () => {
    draw(
      workedPlayer('Hana', {
        recent: [
          workedRecentGame({
            team: [
              { puuid: workedPuuid('Hana'), name: 'Hana', role: 'top' },
              { puuid: 'puuid-x', name: null, role: 'jungle' },
              { puuid: 'puuid-y', name: null, role: 'mid' },
            ],
          }),
        ],
      }),
    );

    expect(screen.getAllByText('Someone')).toHaveLength(2);
    expect(screen.getAllByText(NAMELESS_HINT)).toHaveLength(1);
  });

  it('says nothing about names when everybody on the page has one', () => {
    draw();

    expect(screen.queryByText(NAMELESS_HINT)).not.toBeInTheDocument();
  });
});

describe('no season', () => {
  /**
   * **The name, the sentence, and nothing else** (product, 2026-09-09, after the M3.5 review).
   *
   * Ratings are per season. The first cut of this page filled the numbers with zeros for this
   * case and printed `Rating 0 · Proven 0 · settling` directly above the sentence saying there
   * was no board — zero being a number the model never produced. The loader now returns a shape
   * with no numbers on it, so what this asserts is that the page prints exactly two things.
   */
  const noSeason: PlayerBoardView = { kind: 'no-season', puuid: workedPuuid('Hana'), name: 'Hana' };

  it('is the name and the sentence', () => {
    draw(noSeason);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hana');
    expect(screen.getByText(NO_SEASON_BOARD)).toBeInTheDocument();
    // Never the admin sentence: it names a page most of the group cannot open.
    expect(document.body.textContent).not.toContain('Start a season on the Seasons page.');
  });

  it('prints no number at all — not a zero, not a label, not a chip', () => {
    const { container } = draw(noSeason);

    expect(container.querySelector('.cn-numbers')).not.toBeInTheDocument();
    expect(screen.queryByText(RATING_LABEL)).not.toBeInTheDocument();
    expect(screen.queryByText(PROVEN_LABEL)).not.toBeInTheDocument();
    expect(screen.queryByText(SETTLING_CHIP)).not.toBeInTheDocument();
    expect(screen.queryByText(SETTLING_SENTENCE)).not.toBeInTheDocument();
    // The one number a reader could be shown here would be a zero, and there is none.
    expect(container.textContent).not.toMatch(/\d/);
  });

  it('draws no chart, no record, no games and no empty-season line', () => {
    const { container } = draw(noSeason);

    expect(container.querySelector('svg')).not.toBeInTheDocument();
    expect(screen.queryByText(SEED_LABEL)).not.toBeInTheDocument();
    expect(screen.queryByText(NO_GAMES_YET)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
    expect(container.querySelectorAll('.cn-game')).toHaveLength(0);
    expect(container.querySelectorAll('.cn-record')).toHaveLength(0);
  });

  it('is the header, the sentence, and no other block', () => {
    const { container } = draw(noSeason);

    const page = container.querySelector('.cn-page');
    expect([...(page?.children ?? [])].map((child) => child.className)).toEqual(['cn-strip', 'cn-notice']);
  });

  it('says `Someone` for a nameless player without explaining a page that says nothing else', () => {
    draw({ kind: 'no-season', puuid: 'puuid-x', name: null });

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Someone');
    // The hint belongs under a block of rows, and this state has none.
    expect(screen.queryByText(NAMELESS_HINT)).not.toBeInTheDocument();
  });
});

describe('getting back to the board', () => {
  it('links to the leaderboard from the header', () => {
    draw();

    expect(screen.getByRole('link', { name: '← Leaderboard' })).toHaveAttribute('href', '/leaderboard');
  });
});
