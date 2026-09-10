import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  CURRENT_STREAK,
  LONGEST_LOSS,
  LONGEST_WIN,
  NO_PARTNERS,
  noRoleFootnote,
  PARTNERS_HEADING,
  playerAverageGameLine,
  SIDE_RECORD_HEADING,
} from '@/lib/stats/copy';
import type { PlayerStatsView } from '@/lib/stats/types';
import { emptyPlayerStats, workedPlayerStats } from '@/lib/testing/boardFixtures';
import { workedPuuid } from '@/lib/testing/workedExample';
import { PlayerStats } from './PlayerStats';

/**
 * The sections under the rating chart (M5.20), rendered from a folded answer.
 *
 * The arithmetic is `lib/stats/playerStats.test.ts`; this is what the page *does* with it —
 * which record prints a percentage and which prints bare, what a section with nothing to say
 * says, where a name links, and the two heading levels M5.8 fixed.
 */

function draw(stats: PlayerStatsView = workedPlayerStats()) {
  return render(<PlayerStats stats={stats} />);
}

/** The row text with the screen-reader-only count taken back out. */
function rowsOf(container: HTMLElement, card: number): string[] {
  const lists = [...container.querySelectorAll('.cn-list-card')];
  const rows = [...(lists[card]?.querySelectorAll('.cn-record') ?? [])];
  return rows.map((row) => row.textContent?.replace(/ over \d+ games?/, '') ?? '');
}

describe('by role', () => {
  it('prints the percentage over the minimum and the bare record under it', () => {
    const { container } = draw(
      workedPlayerStats({
        roles: [
          { role: 'jungle', puuid: 'u', name: 'Hana', games: 17, wins: 12, losses: 5, winRate: 71 },
          { role: 'mid', puuid: 'u', name: 'Hana', games: 1, wins: 1, losses: 0, winRate: null },
        ],
      }),
    );

    // Acceptance 2, on the page: `71%` for jungle, and `1W 0L` with no percentage for mid.
    expect(rowsOf(container, 0)).toEqual(['jungle12W 5L · 71%', 'mid1W 0L']);
  });

  it('names each role with its icon and its word, never the icon alone', () => {
    const { container } = draw();

    for (const role of container.querySelectorAll('.cn-lineup-role')) {
      expect(role.textContent?.trim().length ?? 0).toBeGreaterThan(0);
      expect(role.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    }
  });

  /**
   * Every game backfilled: the section is the footnote and nothing else, with **this player's**
   * count in it, and the line is not also printed under the card.
   */
  it('is the no-role footnote alone when the client recorded no position of theirs', () => {
    draw(workedPlayerStats({ roles: [], noRoleGames: 12 }));

    expect(screen.getAllByText(noRoleFootnote(12))).toHaveLength(1);
  });

  it('prints the footnote under the card when only some of their games are missing one', () => {
    const { container } = draw(workedPlayerStats({ noRoleGames: 3 }));

    expect(screen.getByText(noRoleFootnote(3))).toHaveClass('cn-hint');
    expect(rowsOf(container, 0)).toHaveLength(2);
  });

  it('says nothing about roles when every game of theirs has one', () => {
    draw();

    expect(document.body.textContent).not.toContain('not in the role numbers');
  });
});

describe('by side', () => {
  /** Acceptance 3, on the page: four games on red are a record with no percentage. */
  it('prints blue then red, and no percentage under the minimum', () => {
    const { container } = draw();

    expect(screen.getByText(SIDE_RECORD_HEADING)).toBeInTheDocument();
    expect(rowsOf(container, 1)).toEqual(['blue12W 9L · 57%', 'red3W 1L']);
  });

  /** A side is a word in a row, not a colour: the tonight page's tint means something else. */
  it('draws a side as a word with no colour and no icon', () => {
    const { container } = draw();

    const side = container.querySelector('.cn-stats-side');
    expect(side?.textContent).toBe('blue');
    expect(side?.querySelector('svg')).toBeNull();
    expect(container.querySelector('.cn-game-blue')).toBeNull();
  });
});

describe('partners', () => {
  it('is three best and three worst, each a link to that person s page', () => {
    const { container } = draw();

    expect(screen.getByText(PARTNERS_HEADING)).toBeInTheDocument();
    expect(rowsOf(container, 2)).toEqual([
      'Iris9W 3L · 75%',
      'Karim7W 4L · 64%',
      'Theo6W 4L · 60%',
      'Bilal2W 9L · 18%',
      'Omar3W 8L · 27%',
      'Theo6W 4L · 60%',
    ]);
    expect(screen.getAllByRole('link', { name: 'Iris' })[0]).toHaveAttribute(
      'href',
      `/p/${workedPuuid('Iris')}`,
    );
  });

  it('says the empty line, twice, when nobody has five games with them', () => {
    draw(workedPlayerStats({ bestPartners: [], worstPartners: [] }));

    expect(screen.getAllByText(NO_PARTNERS)).toHaveLength(2);
  });
});

describe('streaks', () => {
  /**
   * **A streak is a row, not a sentence** (M5.8): the label left, `W3` right, in the form the
   * leaderboard row prints and from the same helper.
   */
  it('is three rows: the run they are on and the longest of each kind', () => {
    const { container } = draw();

    expect(rowsOf(container, 3)).toEqual([`${CURRENT_STREAK}W3`, `${LONGEST_WIN}W6`, `${LONGEST_LOSS}L4`]);
  });

  it('draws no row for a kind that never happened, and never `L0`', () => {
    const { container } = draw(
      workedPlayerStats({
        streaks: {
          puuid: 'u',
          name: 'Hana',
          current: { kind: 'W', length: 8 },
          longestWin: 8,
          longestLoss: 0,
        },
      }),
    );

    expect(rowsOf(container, 3)).toEqual([`${CURRENT_STREAK}W8`, `${LONGEST_WIN}W8`]);
    expect(document.body.textContent).not.toContain('L0');
  });
});

describe('their average game length', () => {
  /** Acceptance 6, on the page: the mean, to the minute, with no second count beside it. */
  it('is one sentence, in a card, with no count the seed line already carries', () => {
    draw();

    const line = screen.getByText(playerAverageGameLine(32));
    expect(line).toHaveClass('cn-stats-line');
    expect(line.textContent).toBe('Average game 32 min.');
  });

  it('is absent, not `0 min` and not `NaN`, for a window with nothing in it', () => {
    const { container } = draw(emptyPlayerStats('last-week'));

    expect(container).toBeEmptyDOMElement();
    expect(document.body.textContent).not.toContain('NaN');
    expect(document.body.textContent).not.toContain('0 min');
  });
});

describe('the award line', () => {
  /** Acceptance 7: one line, no badge, no icon — and not the `/stats` winner's `t-lg`. */
  it('prints the award and the month, once, above the sections', () => {
    const { container } = draw(
      workedPlayerStats({ window: 'last-month', awards: ['Most improved, September.'] }),
    );

    const line = screen.getByText('Most improved, September.');
    expect(line).toHaveClass('cn-player-award');
    expect(line.className).not.toContain('cn-award-line');
    // Above `By role`, which is the first card under it.
    expect(container.firstElementChild?.textContent).toBe('Most improved, September.');
    expect(container.querySelectorAll('img, svg[role="img"]')).toHaveLength(0);
  });

  it('prints nothing at all on a window that handed nothing out', () => {
    draw();

    expect(document.body.textContent).not.toContain('Most improved');
  });
});

describe('a window this player did not play', () => {
  /**
   * The header strip already prints the window's own empty sentence. Four cards of `Nobody…`
   * under it are four ways of repeating one line, so the band is not drawn at all.
   */
  it('draws nothing, so the window s own sentence is the whole answer', () => {
    const { container } = draw(emptyPlayerStats('last-month'));

    expect(container).toBeEmptyDOMElement();
  });
});

describe('the cap', () => {
  it('says which games these numbers are over when the read hit its cap', () => {
    draw(workedPlayerStats({ capped: true, cap: 2_000 }));

    expect(screen.getByText('Showing the most recent 2000 games.')).toHaveClass('cn-hint');
  });
});
