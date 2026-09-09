import { displayRating } from '@customs/core';
import Link from 'next/link';
import {
  gamesLabel,
  NO_GAMES_YET,
  NO_SEASON_BOARD,
  PROVEN_LABEL,
  RATING_LABEL,
  RECENT_GAMES_HEADING,
  ROLE_RECORD_HEADING,
  STANDINGS_LABEL,
  winLossLabel,
} from '@/lib/board/copy';
import type { PlayerBoardView, RecentGame } from '@/lib/board/types';
import { formatDuration } from '@/lib/discord/embeds';
import { displayDelta, formatWebDelta, isGain } from '@/lib/ratingDisplay';
import { renderWebName } from '@/lib/tonight/copy';
import { RatingChart } from './RatingChart';

/**
 * `/p/[puuid]` (M3.5): the two numbers, the `Rating` history, the role record and
 * the last few games.
 *
 * **Two numbers with two names, and no third.** `Rating` and `Proven` are the board's words,
 * printed here under the same two labels, once, above the chart. The chart belongs to `Rating`;
 * the numbers beside it say where the board has this player today.
 */

/**
 * This player's own result, not the winning side's: the page is about them, and `Red wins`
 * beside their own delta would make a reader work out which side they were on first.
 * New copy, 2026-09-09, recorded in `04-decisions.md`.
 */
const WON = 'Won';
const LOST = 'Lost';

export interface PlayerViewProps {
  player: PlayerBoardView;
  /** The signed-in viewer's puuid: their own row in a lineup gets the `accent` rule. */
  viewerPuuid: string | null;
}

export function PlayerView({ player, viewerPuuid }: PlayerViewProps) {
  return (
    <main className="cn-page">
      <header className="cn-strip">
        <p className="cn-back">
          <Link className="cn-link" href="/leaderboard">
            {STANDINGS_LABEL}
          </Link>
        </p>
        <h1 className="cn-strip-title">{renderWebName(player.name)}</h1>
      </header>

      {player.season === null ? <p className="cn-notice">{NO_SEASON_BOARD}</p> : null}

      <section className="cn-block">
        {/*
         * Above the chart, once: the number people arrive knowing and the primary number,
         * under the same two labels the board uses.
         */}
        <p className="cn-numbers">
          <span className="cn-number">
            <span className="cn-number-label">{RATING_LABEL}</span>{' '}
            <span className="cn-num cn-number-value">{player.rating}</span>
          </span>
          <span className="cn-number">
            <span className="cn-number-label">{PROVEN_LABEL}</span>{' '}
            <span className="cn-num cn-number-value">{player.proven}</span>
          </span>
        </p>

        {player.history.length === 0 ? (
          <p className="cn-empty">{NO_GAMES_YET}</p>
        ) : (
          <RatingChart history={player.history} seed={player.seed} />
        )}
      </section>

      {player.roles.length === 0 ? null : (
        <section className="cn-block">
          <h2 className="cn-heading">{ROLE_RECORD_HEADING}</h2>
          <ul className="cn-records">
            {player.roles.map((record) => (
              <li key={record.role} className="cn-record">
                <span className="cn-num cn-lineup-role">{record.role}</span>
                <span className="cn-num cn-record-games">{gamesLabel(record.games)}</span>
                <span className="cn-num cn-record-wl">{winLossLabel(record.wins, record.losses)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {player.recent.length === 0 ? null : (
        <section className="cn-block">
          <h2 className="cn-heading">{RECENT_GAMES_HEADING}</h2>
          <ul className="cn-games">
            {player.recent.map((game) => (
              <RecentGameView key={game.gameId} game={game} player={player} viewerPuuid={viewerPuuid} />
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

/**
 * One game: what it did to this player's rating, and the five they were on in lane order — the
 * same five positions the teams block and the result card use, so "my row" is where it was.
 *
 * **The delta is computed here, at render.** `displayDelta` rounds both ratings before it
 * subtracts, so `1512 (+43)` adds up, and its `-0` for a rating that fell by less than half a
 * point does not survive a `JSON.stringify` it never makes.
 */
function RecentGameView({
  game,
  player,
  viewerPuuid,
}: {
  game: RecentGame;
  player: PlayerBoardView;
  viewerPuuid: string | null;
}) {
  const rating = game.muAfter === null ? null : displayRating(game.muAfter);
  const delta =
    game.muBefore === null || game.muAfter === null ? null : displayDelta(game.muBefore, game.muAfter);

  return (
    <li className={`cn-game cn-game-${game.side === 100 ? 'blue' : 'red'}`}>
      <p className="cn-game-head">
        <span className="cn-game-result">{game.won ? WON : LOST}</span>{' '}
        <span className="cn-num cn-duration">{formatDuration(game.durationS)}</span>
        <span className="cn-num cn-game-rating">
          {rating ?? ''}
          {delta === null ? null : (
            // One string, not three children: React separates adjacent text nodes in the
            // server render, and a rating copied off the page should read `1512 (+43)`.
            <span className={isGain(delta) ? 'cn-delta cn-delta-up' : 'cn-delta'}>
              {` (${formatWebDelta(delta)})`}
            </span>
          )}
        </span>
      </p>
      <ul className="cn-lineup">
        {game.team.map((seat) => (
          <li
            key={seat.puuid}
            className={
              seat.puuid === player.puuid || seat.puuid === viewerPuuid
                ? 'cn-lineup-row cn-you'
                : 'cn-lineup-row'
            }
          >
            <span className="cn-num cn-lineup-role">{seat.role ?? ''}</span>
            <span className="cn-lineup-name">{renderWebName(seat.name)}</span>
          </li>
        ))}
      </ul>
    </li>
  );
}
