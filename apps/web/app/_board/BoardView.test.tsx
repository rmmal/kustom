import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  BOARD_LEGEND,
  NO_GAMES_YET,
  NO_SEASON_BOARD,
  PROVEN_LABEL,
  SETTLING_CHIP,
  SETTLING_SENTENCE,
} from '@/lib/board/copy';
import type { BoardView as BoardViewModel } from '@/lib/board/types';
import { workedBoard, workedBoardRows } from '@/lib/testing/boardFixtures';
import { workedPuuid } from '@/lib/testing/workedExample';
import { NAMELESS_HINT } from '@/lib/tonight/copy';
import { BoardView } from './BoardView';

/**
 * `/leaderboard` (M3.5, M3.8, M3.10) from fixture data.
 *
 * These stand in for the acceptance checks a night cannot be run to re-check: the primary
 * column never goes up, line 2 names `Rating` on every row, the `settling` chip is per row and
 * its sentence is per page, and a nameless player is `Someone` with one line under the list.
 */

function draw(board: BoardViewModel = workedBoard(), viewerPuuid: string | null = null) {
  return render(<BoardView board={board} viewerPuuid={viewerPuuid} />);
}

function rows(): HTMLElement[] {
  return screen.getAllByRole('listitem');
}

describe('the two numbers', () => {
  it('prints the primary number in descending order, top to bottom', () => {
    draw();

    // The first text node, not the whole element: the number is followed by the
    // visually-hidden `Proven` a screen reader needs.
    const proven = rows().map((row) => Number(row.querySelector('.cn-proven')?.firstChild?.textContent));
    expect(proven).toEqual([1_548, 1_137, 1_062, 990, 987, 917, 882, 831, 654, 534]);
    for (const [index, value] of proven.entries()) {
      expect(value).toBeLessThanOrEqual(proven[index - 1] ?? value);
    }
  });

  /**
   * **The legend is the single word `Proven`** (amended 2026-09-09, from the rendered page).
   * Right-aligned, `Proven · Rating` put `Rating` directly over the Proven column and `Proven`
   * over nothing, which reads as two side-by-side columns when the two numbers are stacked.
   */
  it('names the primary number once, in the card header, and Rating again on every row', () => {
    const { container } = draw();

    const legend = container.querySelector('.cn-legend');
    expect(legend?.textContent).toBe(BOARD_LEGEND);
    expect(BOARD_LEGEND).toBe(PROVEN_LABEL);
    // In the card's `raise` header bar, and nowhere else on the page.
    expect(legend?.parentElement).toHaveClass('cn-card-head');
    expect(container.querySelectorAll('.cn-legend')).toHaveLength(1);
    // `Rating 1266` is on line 2 of every row: it is the number people arrive knowing, so its
    // name has to be where it appears (`05-design.md`).
    for (const row of rows()) {
      expect(row.querySelector('.cn-row-rating')?.textContent).toMatch(/^Rating \d+$/);
    }
  });

  it('puts the rows on `surface` inside a card, under that header bar', () => {
    const { container } = draw();

    const card = container.querySelector('.cn-board-card');
    expect(card).toHaveClass('cn-card');
    expect(card?.querySelector('.cn-card-head')).toBeInTheDocument();
    expect(card?.querySelector('.cn-board')?.children).toHaveLength(10);
  });

  it('leaves the primary number unlabelled on the row, but not to a screen reader', () => {
    draw();

    for (const row of rows()) {
      const labels = [...row.querySelectorAll('*')].filter((node) => node.textContent?.trim() === 'Proven');
      // Exactly one, and it is the visually-hidden one: `Proven` prints nowhere on the row.
      expect(labels).toHaveLength(1);
      expect(labels[0]).toHaveClass('cn-sr');
    }
  });

  it('reads line 2 in the order the design doc fixes', () => {
    draw();

    const nadia = rows().find((row) => within(row).queryByText('Nadia'));
    expect(nadia?.querySelector('.cn-row-meta')?.textContent).toBe(
      `28 games · 14W 14L · L2 · ${SETTLING_CHIP}`,
    );
    expect(nadia?.querySelector('.cn-row-rating')?.textContent).toBe('Rating 1266');
  });
});

describe('the row', () => {
  it('gives rank 1 the accent, and nobody else', () => {
    draw();

    const ranks = rows().map((row) => row.querySelector('.cn-rank'));
    expect(ranks[0]).toHaveClass('cn-rank-first');
    expect(ranks.slice(1).every((rank) => !rank?.classList.contains('cn-rank-first'))).toBe(true);
    // No medals, no trophies, no emoji.
    expect(document.body.textContent).not.toMatch(/[🥇🏆]/u);
  });

  it('opens the player page from the name, keyed by puuid', () => {
    draw();

    expect(screen.getByRole('link', { name: 'Lena' })).toHaveAttribute('href', `/p/${workedPuuid('Lena')}`);
  });

  it('marks the viewer own row and nobody else', () => {
    draw(workedBoard(), workedPuuid('Theo'));

    const mine = rows().filter((row) => row.classList.contains('cn-you'));
    expect(mine).toHaveLength(1);
    expect(within(mine[0] as HTMLElement).getByText('Theo')).toBeInTheDocument();
  });
});

describe('the still-settling marker (M3.8)', () => {
  it('chips the players under 30 games and nobody else', () => {
    draw();

    const chipped = rows()
      .filter((row) => within(row).queryByText(SETTLING_CHIP))
      .map((row) => row.querySelector('.cn-row-name')?.textContent);
    expect(chipped).toEqual(['Nadia', 'Yuki']);
  });

  it('says the sentence once on the page, not once per row', () => {
    draw();

    expect(screen.getAllByText(SETTLING_SENTENCE)).toHaveLength(1);
  });

  it('disappears at 30 games, with the sentence', () => {
    const settled = workedBoardRows().map((row) => ({
      ...row,
      games: 30,
      wins: 15,
      losses: 15,
      settling: false,
    }));
    draw({ season: { id: 'season-1', name: 'Season 1' }, rows: settled });

    expect(screen.queryByText(SETTLING_CHIP)).not.toBeInTheDocument();
    expect(screen.queryByText(SETTLING_SENTENCE)).not.toBeInTheDocument();
  });
});

describe('a player with no name (M3.10)', () => {
  it('is `Someone`, with one line under the list and never a puuid', () => {
    const [first, ...rest] = workedBoardRows();
    draw({
      season: { id: 'season-1', name: 'Season 1' },
      rows: [{ ...(first as (typeof rest)[number]), name: null }, ...rest],
    });

    expect(screen.getByText('Someone')).toBeInTheDocument();
    expect(screen.getAllByText(NAMELESS_HINT)).toHaveLength(1);
    // Everything else about the row is unaffected.
    expect(rows()[0]?.querySelector('.cn-proven')?.textContent).toContain('1548');
  });

  /**
   * Two nameless players are two links called `Someone` (the designer's M3.5 review): a screen
   * reader listing the page's links reads the same word twice with nothing to choose between
   * them. The rank is on screen beside the name already; the puuid never is.
   */
  it('gives each `Someone` link its rank, out loud and only out loud', () => {
    const [first, second, ...rest] = workedBoardRows();
    draw({
      season: { id: 'season-1', name: 'Season 1' },
      rows: [
        { ...(first as (typeof rest)[number]), name: null },
        { ...(second as (typeof rest)[number]), name: null },
        ...rest,
      ],
    });

    expect(screen.getByRole('link', { name: 'Someone, rank 1' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Someone, rank 2' })).toBeInTheDocument();
    // On screen it is still one word, and the disambiguator is never a puuid.
    for (const link of screen.getAllByText('Someone')) {
      expect(link.parentElement?.querySelector('.cn-sr')?.textContent).toMatch(/^, rank \d+$/);
    }
    expect(document.body.textContent).not.toContain(workedPuuid('Lena'));
  });

  it('says nothing about names when every row has one', () => {
    draw();

    expect(screen.queryByText(NAMELESS_HINT)).not.toBeInTheDocument();
  });
});

describe('the empty states', () => {
  it('is a heading, the sentence and one line when the season has no games yet', () => {
    const seeded = workedBoardRows().map((row) => ({
      ...row,
      games: 0,
      wins: 0,
      losses: 0,
      streak: null,
      settling: true,
    }));
    draw({ season: { id: 'season-1', name: 'Season 1' }, rows: seeded });

    expect(screen.getByText(NO_GAMES_YET)).toBeInTheDocument();
    expect(screen.getByText(SETTLING_SENTENCE)).toBeInTheDocument();
    // Not an empty page: a friend seeded last night still finds themselves, with `0 games`.
    expect(rows()).toHaveLength(10);
    expect(rows()[0]?.querySelector('.cn-row-meta')?.textContent).toContain('0 games');
  });

  it('says so when no season is active, and lists nobody', () => {
    draw({ season: null, rows: [] });

    expect(screen.getByText(NO_SEASON_BOARD)).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    // Never the admin sentence: it names a page most of the group cannot open.
    expect(document.body.textContent).not.toContain('Start a season on the Seasons page.');
  });

  it('has a heading in every state, and the word is `Leaderboard`', () => {
    const { unmount, container } = draw();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Season 1 Leaderboard');
    // Beside a season name the noun is the dim sub-word.
    expect(container.querySelector('.cn-strip-sub')?.textContent).toBe('Leaderboard');
    unmount();

    const { container: bare } = draw({ season: null, rows: [] });
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Leaderboard');
    // With nothing beside it, it is the heading itself and not a grey afterthought.
    expect(bare.querySelector('.cn-strip-sub')).not.toBeInTheDocument();
    expect(heading.textContent).toBe('Leaderboard');
  });
});
