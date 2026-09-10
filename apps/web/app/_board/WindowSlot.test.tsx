import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WINDOW_EMPTY } from '@/lib/board/copy';
import { statsView } from '@/lib/stats/view';
import { emptyPlayerStats, emptyWindowBoard, workedPlayer } from '@/lib/testing/boardFixtures';
import { StatsView } from '../_stats/StatsView';
import { BoardView } from './BoardView';
import { PlayerView } from './PlayerView';

/**
 * **One empty window, one sentence, one dress** (M5.23, the designer 2026-09-11).
 *
 * `/leaderboard`, `/p/[puuid]` and `/stats` carry the same picker in the same header slot, so a
 * window with nothing in it may not be answered three ways. It was: the two board pages printed
 * the window's sentence in the slot in `dim`, and `/stats` printed the same sentence in the body
 * at `t-base` in `text` under a strip with its hairline taken off (M5.8's rule 6, written when
 * `/stats` was the only page whose whole subject is the window).
 *
 * This file is the acceptance check, and it is written across the three pages on purpose: each
 * page's own test file can only see its own answer, and the defect was that the three answers
 * differed. `WindowSlot` is the one component all three render.
 */

const WEEK = 'last-week' as const;

/** The three pages, on a window that has nothing in it, as one list to walk. */
function emptyPages(): { page: string; container: HTMLElement }[] {
  const board = render(<BoardView board={emptyWindowBoard(WEEK)} viewerPuuid={null} />);
  const player = render(
    <PlayerView
      player={workedPlayer('Hana', {
        window: WEEK,
        range: null,
        games: 0,
        wins: 0,
        losses: 0,
        history: [],
        recent: [],
      })}
      stats={emptyPlayerStats(WEEK)}
    />,
  );
  const stats = render(
    <StatsView
      stats={statsView({
        window: WEEK,
        games: [],
        players: [],
        range: { start: new Date('2026-09-01T03:00:00Z'), end: new Date('2026-09-08T03:00:00Z') },
        capped: false,
        cap: 2_000,
        timeZone: 'Africa/Cairo',
      })}
    />,
  );

  return [
    { page: '/leaderboard', container: board.container },
    { page: '/p/[puuid]', container: player.container },
    { page: '/stats', container: stats.container },
  ];
}

describe('the window with nothing in it, on the three pages that have a picker', () => {
  it('is one sentence, in one element, with one class', () => {
    for (const { page, container } of emptyPages()) {
      const found = [...container.querySelectorAll('.cn-empty')];

      expect(found, page).toHaveLength(1);
      const sentence = found[0] as HTMLElement;
      expect(sentence.tagName, page).toBe('P');
      expect(sentence.className, page).toBe('cn-empty');
      expect(sentence.textContent, page).toBe(WINDOW_EMPTY[WEEK]);
    }
  });

  it('prints it in the header slot, under the picker, on all three', () => {
    for (const { page, container } of emptyPages()) {
      const sentence = container.querySelector('.cn-empty') as HTMLElement;
      const strip = container.querySelector('.cn-strip');

      expect(sentence.parentElement, page).toBe(strip);
      // The picker is above it, and the sentence is the last thing in the header on a page
      // with nothing else to say about the window.
      expect(strip?.querySelector('.cn-windows'), page).not.toBeNull();
    }
  });

  it('keeps the strip s hairline, and says it exactly once', () => {
    for (const { page, container } of emptyPages()) {
      expect(container.querySelector('.cn-strip'), page).not.toHaveClass('cn-strip-bare');
      // Never beside the range and count: one slot, two strings, never both.
      expect(container.querySelector('.cn-window-line'), page).toBeNull();
      expect(container.textContent?.split(WINDOW_EMPTY[WEEK]), page).toHaveLength(2);
    }
  });
});
