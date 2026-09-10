import { LEADERBOARD_LABEL, WINDOW_EMPTY, WINDOW_LABELS } from '@/lib/board/copy';
import type { BoardView as BoardViewModel } from '@/lib/board/types';
import { isNameless } from '@/lib/tonight/copy';
import { BoardCard } from '../_leaderboard/BoardCard';
import { NamelessHint, SettlingNote } from './parts';
import { WindowPicker } from './WindowPicker';

/**
 * `/leaderboard` (M3.5, M3.8, M3.10; dressed for Floodlit in M3.19). A pure function of one
 * snapshot and who is looking, so every edge case in the brief — a season with no games, a
 * player with none, a nameless row, a near-tie on Proven — is a component test rather than a
 * night of waiting.
 *
 * The rule this file exists to keep: **the sort order and the primary number are the same
 * number.** Rows arrive ordered by Proven descending and are rendered in that order, so
 * reading the primary column top to bottom never goes up.
 *
 * The row itself is `app/_leaderboard/BoardRow.tsx`, because the tonight page's rail renders
 * the first five of the same list and one row drawn twice would be two rows by Christmas.
 */

export interface BoardViewProps {
  board: BoardViewModel;
  /** The signed-in viewer's puuid, for the `brand` "you" rule. `null` for everybody else. */
  viewerPuuid: string | null;
}

export function BoardView({ board, viewerPuuid }: BoardViewProps) {
  const settling = board.rows.some((row) => row.settling);
  const nameless = board.rows.some((row) => isNameless(row.name));
  /**
   * **A window with nothing in it.** On `All time` the board still lists everybody the
   * database knows, seeded from rank, so "no games" there is a board whose every row reads
   * `0 games` — the same test the shipped page made. In a window, membership *is* the games,
   * so an empty window is no rows at all.
   */
  const noGamesYet = board.rows.length === 0 || board.rows.every((row) => row.games === 0);

  return (
    <main className="cn-page">
      <header className="cn-strip">
        {/*
         * `This week Leaderboard` (M5.12): the **window's** name at full weight with the
         * page's noun beside it in `dim` — where the season's name used to be, in the shape
         * the designer settled on 2026-09-09. A season's name is never printed to a friend
         * again, and the heading and the picker say the same three words.
         */}
        <h1 className="cn-strip-title">
          {WINDOW_LABELS[board.window]} <span className="cn-strip-sub">{LEADERBOARD_LABEL}</span>
        </h1>
        <WindowPicker path="/leaderboard" selected={board.window} />
      </header>

      {/* Once per page, under the heading, and never once per row (M3.8). */}
      {settling ? <SettlingNote /> : null}

      <section className="cn-block">
        {/* Not an empty page and not a spinner: one line, in `dim`, and — on `All time` — the
            seeded rows below it, so a friend who has not played yet can still find themselves. */}
        {noGamesYet ? <p className="cn-empty">{WINDOW_EMPTY[board.window]}</p> : null}

        {board.rows.length === 0 ? null : <BoardCard rows={board.rows} viewerPuuid={viewerPuuid} />}
      </section>

      {nameless ? <NamelessHint /> : null}
    </main>
  );
}
