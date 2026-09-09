import { LEADERBOARD_LABEL, NO_GAMES_YET, NO_SEASON_BOARD } from '@/lib/board/copy';
import type { BoardView as BoardViewModel } from '@/lib/board/types';
import { isNameless } from '@/lib/tonight/copy';
import { BoardCard } from '../_leaderboard/BoardCard';
import { NamelessHint, SettlingNote } from './parts';

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
  const noGamesYet = board.rows.length === 0 || board.rows.every((row) => row.games === 0);

  return (
    <main className="cn-page">
      <header className="cn-strip">
        {/*
         * `Season 1 Leaderboard`, and `Leaderboard` alone when no season is active — at full
         * weight, not as the dim sub-word (the designer's review, 2026-09-09). `cn-strip-sub`
         * demotes the noun beside the season name it belongs to; with nothing beside it the
         * page's only heading was a grey afterthought.
         */}
        <h1 className="cn-strip-title">
          {board.season === null ? (
            LEADERBOARD_LABEL
          ) : (
            <>
              {board.season.name} <span className="cn-strip-sub">{LEADERBOARD_LABEL}</span>
            </>
          )}
        </h1>
      </header>

      {/* Once per page, under the heading, and never once per row (M3.8). */}
      {settling ? <SettlingNote /> : null}

      {board.season === null ? <p className="cn-notice">{NO_SEASON_BOARD}</p> : null}

      <section className="cn-block">
        {/* Not an empty page and not a spinner: one line, in `dim`, and the seeded rows below
            it so a friend who has not played yet can still find themselves. */}
        {board.season !== null && noGamesYet ? <p className="cn-empty">{NO_GAMES_YET}</p> : null}

        {board.rows.length === 0 ? null : <BoardCard rows={board.rows} viewerPuuid={viewerPuuid} />}
      </section>

      {nameless ? <NamelessHint /> : null}
    </main>
  );
}
