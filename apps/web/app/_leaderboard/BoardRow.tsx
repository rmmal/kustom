import Link from 'next/link';
import { gamesLabel, PROVEN_LABEL, RATING_LABEL, winLossLabel } from '@/lib/board/copy';
import { formatStreak } from '@/lib/board/streak';
import type { BoardRow as BoardRowModel, Climb } from '@/lib/board/types';
import { displayDelta, formatWebDelta, isGain } from '@/lib/ratingDisplay';
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
          {/*
           * **What happened inside the window** (M5.12): `6 games · 4W 2L · +58`. The counts
           * beside it are already the window's, and the climb closes the line.
           *
           * The delta is computed **here, at render**, from the two mu values the row carries:
           * `displayDelta` rounds both ratings before it subtracts — so the number adds up
           * against the two boards it sits between — and its `-0` for a week that lost less
           * than half a point does not survive the `JSON.stringify` the rail's rows make.
           *
           * On `All time` there is no climb and the streak takes this position instead: the
           * row is exactly today's row and gains nothing.
           */}
          {row.climb === null ? null : <ClimbValue climb={row.climb} />}
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

/**
 * `+58`: what the window did to this player's rating, in the same two glyphs `/p/[puuid]`
 * prints a game's delta with — `+` and U+2212, never a colour, never an arrow (`05-design.md`,
 * "Rating delta"). A gain is `text` at 600 and a loss is `dim` at 400, which is the same rule
 * and the same two classes as the per-game delta.
 */
function ClimbValue({ climb }: { climb: Climb }) {
  const delta = displayDelta(climb.muBefore, climb.muAfter);

  return (
    <>
      {' · '}
      <span className={isGain(delta) ? 'cn-num cn-delta cn-delta-up' : 'cn-num cn-delta'}>
        {formatWebDelta(delta)}
      </span>
    </>
  );
}
