import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  NO_GAMES_YET,
  NO_SEASON_BOARD,
  NOT_RATED,
  NOT_RATED_HINT,
  PROVEN_LABEL,
  RATING_LABEL,
  RECENT_GAMES_HEADING,
  RECENT_RATING_LEGEND,
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

function draw(player: PlayerBoardView = workedPlayer()) {
  return render(<PlayerView player={player} />);
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
    // The chart's own `<svg>`: the role icons beside a lane word are `<svg>` too (M3.19).
    expect(container.querySelector('.cn-chart-svg')).not.toBeInTheDocument();
    // And no `0 games · 0W 0L`: the sentence under it is the record (the designer, 2026-09-10).
    expect(container.querySelector('.cn-row-meta')).not.toBeInTheDocument();
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
    expect(container.querySelector('.cn-chart-svg')).not.toBeInTheDocument();
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
    // two numbers on the line agree. The bare number carries its noun for a screen reader, the
    // same rule the board row's bare Proven follows (the designer's M3.5 review).
    const cell = container.querySelector('.cn-game-rating');
    expect(cell?.firstChild?.textContent).toBe('1392');
    expect(cell?.querySelector('.cn-sr')?.textContent).toBe(` ${RATING_LABEL}`);
    expect(cell?.querySelector('.cn-delta')?.textContent).toBe(' (−42)');
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

  /**
   * **One marked row, whoever is looking** (the designer, 2026-09-10). The page is about one
   * person; marking the signed-in viewer as well put the `brand` rule on two of five rows on
   * every night the two of them played together, which is two answers to "which one is mine".
   */
  it('marks the page own player and nobody else, on a night the viewer also played', () => {
    const { container } = draw();

    const marked = [...container.querySelectorAll('.cn-lineup-row.cn-you')];
    expect(marked).toHaveLength(1);
    // Iris is in this lineup and could be the viewer; her row is a plain link like the rest.
    expect(within(marked[0] as HTMLElement).queryByText('Iris')).not.toBeInTheDocument();
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
  /**
   * The back link is **deleted with the shell** (`05-design.md`, "The player page"): the
   * `Leaderboard` tab in the top bar is the same destination, and a page does not carry two
   * ways to one place. The tab is `Shell.test.tsx`'s; this only asserts the second one is gone.
   */
  it('carries no back link of its own', () => {
    draw();

    expect(screen.queryByRole('link', { name: '← Leaderboard' })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('←');
  });
});

describe('the Floodlit rank order down the page (M3.19)', () => {
  /**
   * v1 set the name and both section headings at the same `t-lg` 600 and put the numbers below
   * all three, which made the largest type on a page about a person the words `By role`.
   */
  it('is the name in the display cut, the two numbers above it, the headings as micro-labels', () => {
    const { container } = draw();

    expect(screen.getByRole('heading', { level: 1 })).toHaveClass('cn-display');
    expect(container.querySelector('.cn-number-primary .cn-number-value')?.textContent).toBe('882');
    expect([...container.querySelectorAll('h2')].map((node) => node.className)).toEqual([
      'cn-num cn-list-title',
      'cn-num cn-list-title',
    ]);
  });

  it('puts each list in a card with a `raise` header bar', () => {
    const { container } = draw();

    for (const head of container.querySelectorAll('.cn-list-head')) {
      expect(head).toHaveClass('cn-card-head');
      expect(head.parentElement).toHaveClass('cn-card');
    }
  });

  /** The same legend rule the board row's bare Proven and the seat rack's rating column follow. */
  it('names the `Recent games` rating column once, in the header, right-aligned', () => {
    const { container } = draw();

    const heads = [...container.querySelectorAll('.cn-list-head')];
    const recent = heads.find((head) => head.textContent?.includes(RECENT_GAMES_HEADING));
    expect(recent?.querySelector('.cn-legend')?.textContent).toBe(RECENT_RATING_LEGEND);
  });

  it('names a role with its icon and its word, never the icon alone', () => {
    const { container } = draw();

    for (const role of container.querySelectorAll('.cn-lineup-role')) {
      // The word carries the meaning; the mark is `aria-hidden` and never on its own.
      expect(role.textContent?.trim().length ?? 0).toBeGreaterThan(0);
      expect(role.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    }
  });
});

describe('the four teammates', () => {
  /**
   * This is the one screen in the product that lists other people by name, and hopping between
   * friends is what the board is for (the designer's M3.5 review). The viewed player's own row
   * is plain text: a link back to the page you are already on is not a destination.
   */
  it('link to their own pages, while the viewed player row stays plain text', () => {
    const { container } = draw();

    const lineup = [...container.querySelectorAll('.cn-lineup-row')];
    const links = lineup.map((row) => row.querySelector('a')?.getAttribute('href') ?? null);
    expect(links).toEqual([
      null,
      `/p/${workedPuuid('Iris')}`,
      `/p/${workedPuuid('Karim')}`,
      `/p/${workedPuuid('Bilal')}`,
      `/p/${workedPuuid('Theo')}`,
    ]);
    expect(within(lineup[0] as HTMLElement).getByText('Hana').tagName).toBe('SPAN');
  });

  /** A phone has no hover, so the affordance cannot live only in one (the designer, 2026-09-10). */
  it('are dressed as links at rest, and the viewed player is not', () => {
    const { container } = draw();

    for (const link of container.querySelectorAll('.cn-lineup-name')) {
      expect(link.classList.contains('cn-lineup-link')).toBe(link.tagName === 'A');
    }
  });
});

describe('a game that moved nothing (M3.23)', () => {
  /**
   * Product, 2026-09-10: the five are the player's last five games, **rated or not**. A
   * backfilled game that `rebuild-ratings` has not folded yet, and a game the fold refused for
   * being too short or a player short, both read `not rated` — one vocabulary, because the
   * reader's question is the same one.
   */
  it('is listed, reads `not rated`, and carries no delta', () => {
    const { container } = draw(
      workedPlayer('Hana', {
        recent: [workedRecentGame({ gameId: 'game-unrated', muBefore: null, muAfter: null })],
      }),
    );

    const cell = container.querySelector('.cn-game-rating');
    expect(cell?.textContent).toBe(NOT_RATED);
    expect(container.querySelector('.cn-delta')).not.toBeInTheDocument();
    // No visually-hidden `Rating` either: there is no rating on this row to name.
    expect(cell?.querySelector('.cn-sr')).not.toBeInTheDocument();
    // Everything else about the row prints as normal.
    expect(container.querySelector('.cn-game-head')?.textContent).toContain('Lost');
    expect(container.querySelector('.cn-game-head')?.textContent).toContain('34:12');
  });

  it('says why once, under the list, and only while a row reads `not rated`', () => {
    const { unmount } = draw(
      workedPlayer('Hana', {
        recent: [
          workedRecentGame({ gameId: 'game-unrated', muBefore: null, muAfter: null }),
          workedRecentGame({ gameId: 'game-2' }),
        ],
      }),
    );

    expect(screen.getAllByText(NOT_RATED_HINT)).toHaveLength(1);
    unmount();

    draw();
    expect(screen.queryByText(NOT_RATED_HINT)).not.toBeInTheDocument();
  });
});
