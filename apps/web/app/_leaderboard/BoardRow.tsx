import Link from 'next/link';
import { gamesLabel, PROVEN_LABEL, RATING_LABEL, winLossLabel } from '@/lib/board/copy';
import { formatStreak } from '@/lib/board/streak';
import type { BoardRow as BoardRowModel } from '@/lib/board/types';
import { isNameless, renderWebName } from '@/lib/tonight/copy';
import { SettlingChip } from '../_board/parts';

/**
 * One row of the board (M3.5, dressed for Floodlit in M3.19).
 *
 * **One component, two surfaces.** `/leaderboard` renders every row and the tonight page's
 * ≥1080px rail renders the first five of the same list (`05-design.md`, "What changes on the
 * leaderboard and the player page", item 5). Building it inline in the page would mean writing
 * it twice and having the two drift the first time a number moves.
 *
 * Two lines, each a pair of groups pinned to opposite edges:
 *
 *   - Line 1: rank, name, **Proven** hard against the right edge.
 *   - Line 2: the meta under the name, and `Rating` under the Proven number, so the two numbers
 *     form one vertical pair per row rather than two competing columns.
 *
 * `Proven` prints nowhere on the row — it is the unlabelled primary number, named once in the
 * card header's legend. It still carries visually-hidden text, the same way the team card's
 * bare side sum does, so a screen reader is not left with an integer and no noun.
 */

export interface BoardRowProps {
  row: BoardRowModel;
  /** 1-based, and the same rank the board reads: it is also the `Someone` disambiguator. */
  rank: number;
  /** The signed-in viewer's puuid, for the `brand` "you" rule. `null` for everybody else. */
  viewerPuuid: string | null;
}

export function BoardRow({ row, rank, viewerPuuid }: BoardRowProps) {
  const you = row.puuid === viewerPuuid;

  return (
    <li className={you ? 'cn-row cn-you' : 'cn-row'}>
      <div className="cn-row-top">
        {/* Rank 1 gets `brand` on the rank number only. No medals, no trophies, no emoji. */}
        <span className={rank === 1 ? 'cn-num cn-rank cn-rank-first' : 'cn-num cn-rank'}>{rank}</span>
        <Link className="cn-row-name" href={`/p/${row.puuid}`}>
          {/*
           * Two nameless players are two links called `Someone` (M3.10, the designer's M3.5
           * review). A screen reader listing the page's links then reads the same word twice
           * with nothing to choose between them, so the rank — which is on screen beside it —
           * joins the accessible name and nothing else. Never the puuid.
           *
           * A named row stays one text node: the wrapper exists only where there is something
           * to disambiguate.
           */}
          {isNameless(row.name) ? (
            <>
              <span>{renderWebName(row.name)}</span>
              {/* The comma is doing work: an accessible name concatenates its parts with no
                  separator, so ` rank 1` would be announced as `Someonerank 1`. */}
              <span className="cn-sr">{`, rank ${rank}`}</span>
            </>
          ) : (
            renderWebName(row.name)
          )}
        </Link>
        <span className="cn-num cn-proven">
          {row.proven}
          <span className="cn-sr"> {PROVEN_LABEL}</span>
        </span>
      </div>
      <div className="cn-row-bottom">
        <span className="cn-row-meta">
          <span className="cn-num">{gamesLabel(row.games)}</span>
          {' · '}
          <span className="cn-num">{winLossLabel(row.wins, row.losses)}</span>
          {row.streak === null ? null : (
            <>
              {' · '}
              <span className="cn-num">{formatStreak(row.streak)}</span>
            </>
          )}
          {row.settling ? (
            <>
              {' · '}
              <SettlingChip />
            </>
          ) : null}
        </span>
        {/* `Rating` prints inline on every line 2: it is the number people arrive knowing, so
            it is the one whose name has to be where it appears. */}
        <span className="cn-row-rating">
          {RATING_LABEL} <span className="cn-num">{row.rating}</span>
        </span>
      </div>
    </li>
  );
}
