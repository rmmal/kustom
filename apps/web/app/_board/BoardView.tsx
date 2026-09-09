import Link from 'next/link';
import {
  BOARD_LEGEND,
  gamesLabel,
  NO_GAMES_YET,
  NO_SEASON_BOARD,
  PROVEN_LABEL,
  RATING_LABEL,
  STANDINGS_LABEL,
  winLossLabel,
} from '@/lib/board/copy';
import { formatStreak } from '@/lib/board/streak';
import type { BoardRow, BoardView as BoardViewModel } from '@/lib/board/types';
import { renderWebName } from '@/lib/tonight/copy';

/**
 * `/leaderboard` (M3.5). A pure function of one snapshot and who is looking, so every edge case
 * in the brief — a season with no games, a player with none, a near-tie on Proven — is a
 * component test rather than a night of waiting.
 *
 * The rule this file exists to keep: **the sort order and the primary number are the same
 * number.** Rows arrive ordered by Proven descending and are rendered in that order, so
 * reading the primary column top to bottom never goes up.
 */

export interface BoardViewProps {
  board: BoardViewModel;
  /** The signed-in viewer's puuid, for the `accent` "you" rule. `null` for everybody else. */
  viewerPuuid: string | null;
}

export function BoardView({ board, viewerPuuid }: BoardViewProps) {
  const noGamesYet = board.rows.length === 0 || board.rows.every((row) => row.games === 0);

  return (
    <main className="cn-page">
      <header className="cn-strip">
        <h1 className="cn-strip-title">
          {board.season === null ? (
            <span className="cn-strip-sub">{STANDINGS_LABEL}</span>
          ) : (
            <>
              {board.season.name} <span className="cn-strip-sub">{STANDINGS_LABEL}</span>
            </>
          )}
        </h1>
      </header>

      {board.season === null ? <p className="cn-notice">{NO_SEASON_BOARD}</p> : null}

      <section className="cn-block">
        {/* Not an empty page and not a spinner: one line, in `dim`, and the seeded rows below
            it so a friend who has not played yet can still find themselves. */}
        {board.season !== null && noGamesYet ? <p className="cn-empty">{NO_GAMES_YET}</p> : null}

        {board.rows.length === 0 ? null : (
          <>
            {/*
             * A legend, not a header row (`05-design.md`): it names the two numbers once,
             * right-aligned over them. It does not stick, does not sort and is not tappable —
             * on a phone a header row scrolls away after four rows and leaves every row below
             * it as two unexplained numbers, which is why `Rating` also prints per row.
             */}
            <p className="cn-legend">{BOARD_LEGEND}</p>
            <ol className="cn-board">
              {board.rows.map((row, index) => (
                <BoardRowView key={row.puuid} row={row} rank={index + 1} viewerPuuid={viewerPuuid} />
              ))}
            </ol>
          </>
        )}
      </section>
    </main>
  );
}

/**
 * One row, two lines, each a pair of groups pinned to opposite edges.
 *
 * Line 1: rank, name, **Proven** hard against the right edge. Line 2: the meta under the name,
 * and `Rating` under the Proven number so the two form one vertical pair per row.
 *
 * `Proven` prints nowhere on the row — it is the unlabelled primary number, named once in the
 * legend above the list. It still carries visually-hidden text, the same way the team card's
 * bare side sum does, so a screen reader is not left with an integer and no noun.
 */
function BoardRowView({
  row,
  rank,
  viewerPuuid,
}: {
  row: BoardRow;
  rank: number;
  viewerPuuid: string | null;
}) {
  const you = row.puuid === viewerPuuid;
  return (
    <li className={you ? 'cn-row cn-you' : 'cn-row'}>
      <div className="cn-row-top">
        {/* Rank 1 gets `accent` on the rank number only. No medals, no trophies, no emoji. */}
        <span className={rank === 1 ? 'cn-num cn-rank cn-rank-first' : 'cn-num cn-rank'}>{rank}</span>
        <Link className="cn-row-name" href={`/p/${row.puuid}`}>
          {renderWebName(row.name)}
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
