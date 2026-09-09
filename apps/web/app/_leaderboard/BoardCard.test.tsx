import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BOARD_LEGEND, TOP_OF_BOARD_TITLE } from '@/lib/board/copy';
import { workedBoard, workedBoardRows } from '@/lib/testing/boardFixtures';
import { workedPuuid } from '@/lib/testing/workedExample';
import { BoardView } from '../_board/BoardView';
import { BoardCard, TopOfBoard } from './BoardCard';

/**
 * **One row, two surfaces** (M3.19 acceptance): `/leaderboard` renders the whole board and the
 * tonight page's ≥1080px rail renders its first five, and the rail's `Top of the board` shows
 * the same five rows as the top of the board.
 *
 * That is the check this file exists for, because it is the one that rots silently: two copies
 * of a row drift the first time a number moves, and nobody notices until a friend screenshots
 * the rail and the page side by side.
 */

/** Every row's text, in order, with the whitespace a reader does not see collapsed. */
function rowText(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.cn-row')].map((row) =>
    (row.textContent ?? '').replace(/\s+/g, ' ').trim(),
  );
}

describe('the rail and the board render the same rows', () => {
  it('shows the board first five, in the board order, with the same numbers', () => {
    const board = workedBoard();
    const { container: page } = render(<BoardView board={board} viewerPuuid={null} />);
    const { container: rail } = render(<TopOfBoard rows={board.rows.slice(0, 5)} viewerPuuid={null} />);

    expect(rowText(rail)).toEqual(rowText(page).slice(0, 5));
    expect(rowText(rail)[0]).toContain('Lena');
  });

  it('keeps the ranks the board gave them, not the slice index', () => {
    const { container } = render(<TopOfBoard rows={workedBoardRows().slice(0, 5)} viewerPuuid={null} />);

    expect([...container.querySelectorAll('.cn-rank')].map((node) => node.textContent)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ]);
  });

  it('is a titled card with the same one-word legend the page carries', () => {
    const { container } = render(<TopOfBoard rows={workedBoardRows().slice(0, 5)} viewerPuuid={null} />);

    expect(screen.getByRole('heading', { level: 2, name: TOP_OF_BOARD_TITLE })).toBeInTheDocument();
    // One legend, in the `raise` header bar. The word also appears once per row, hidden, as
    // the noun of that row's bare number — which is why this asks the header and not the page.
    const legend = container.querySelector('.cn-legend');
    expect(legend?.textContent).toBe(BOARD_LEGEND);
    expect(legend?.parentElement).toHaveClass('cn-card-head');
  });

  it('links every name at its own puuid, the same way the page does', () => {
    render(<TopOfBoard rows={workedBoardRows().slice(0, 5)} viewerPuuid={null} />);

    expect(screen.getByRole('link', { name: 'Lena' })).toHaveAttribute('href', `/p/${workedPuuid('Lena')}`);
  });

  /** With no season there is no board, and an empty card in a rail is a page saying it failed. */
  it('renders nothing at all when there is no board yet', () => {
    const { container } = render(<TopOfBoard rows={[]} viewerPuuid={null} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('marks the viewer own row in the rail too, and nobody else', () => {
    const { container } = render(
      <BoardCard rows={workedBoardRows().slice(0, 5)} viewerPuuid={workedPuuid('Bilal')} />,
    );

    const mine = [...container.querySelectorAll('.cn-row')].filter((row) => row.classList.contains('cn-you'));
    expect(mine).toHaveLength(1);
    expect(mine[0]?.textContent).toContain('Bilal');
  });
});
