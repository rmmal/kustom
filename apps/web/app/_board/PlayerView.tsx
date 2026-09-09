import { displayRating } from '@customs/core';
import Link from 'next/link';
import {
  gamesLabel,
  LEADERBOARD_LABEL,
  NO_GAMES_YET,
  NO_SEASON_BOARD,
  PROVEN_LABEL,
  RATING_LABEL,
  RECENT_GAMES_HEADING,
  ROLE_RECORD_HEADING,
  winLossLabel,
} from '@/lib/board/copy';
import type { PlayerBoardView, PlayerSeasonView, RecentGame } from '@/lib/board/types';
import { formatDuration } from '@/lib/discord/embeds';
import { formatDayMonth } from '@/lib/night';
import { displayDelta, formatWebDelta, isGain } from '@/lib/ratingDisplay';
import { isNameless, renderWebName } from '@/lib/tonight/copy';
import { nightTimeZone } from '@/lib/tonight/night';
import { NamelessHint, SettlingChip, SettlingNote } from './parts';
import { RatingChart } from './RatingChart';

/**
 * `/p/[puuid]` (M3.5, M3.8, M3.10): the two numbers, the `Rating` history, the role record and
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
        {/* An arrow and the page's own name: a bare noun above a heading reads as a label. */}
        <p className="cn-back">
          <Link className="cn-link" href="/leaderboard">
            {`← ${LEADERBOARD_LABEL}`}
          </Link>
        </p>
        <h1 className="cn-strip-title">{renderWebName(player.name)}</h1>
      </header>

      {/*
       * **No season: the name, one sentence, and nothing else** (product, 2026-09-09).
       *
       * Ratings are per season, so there is no rating, no Proven, no history and no games to
       * show — and the first cut of this page filled those fields with zeros and printed
       * `Rating 0 · Proven 0 · settling` directly above the sentence saying there was no board.
       * The loader now hands over a shape with no numbers in it at all, so this is not a branch
       * that has to remember to hide them; there is nothing to hide.
       */}
      {player.kind === 'no-season' ? (
        <p className="cn-notice">{NO_SEASON_BOARD}</p>
      ) : (
        <PlayerSeason player={player} viewerPuuid={viewerPuuid} />
      )}
    </main>
  );
}

/** The page proper: the two numbers, the chart, the record and the last few games. */
function PlayerSeason({ player, viewerPuuid }: { player: PlayerSeasonView; viewerPuuid: string | null }) {
  const nameless =
    isNameless(player.name) || player.recent.some((game) => game.team.some((seat) => isNameless(seat.name)));

  return (
    <>
      <section className="cn-block">
        {/*
         * Above the chart, once: the number people arrive knowing and the primary number,
         * under the same two labels the board uses. The chip sits beside them (M3.8).
         */}
        <div className="cn-summary">
          <p className="cn-numbers">
            <span className="cn-number">
              <span className="cn-number-label">{RATING_LABEL}</span>{' '}
              <span className="cn-num cn-number-value">{player.rating}</span>
            </span>
            <span className="cn-number">
              <span className="cn-number-label">{PROVEN_LABEL}</span>{' '}
              <span className="cn-num cn-number-value">{player.proven}</span>
            </span>
            {player.settling ? <SettlingChip /> : null}
          </p>

          {/*
           * The record, directly under the two numbers (the designer's review, 2026-09-09). The
           * board prints it on every row and this page — the one place a friend goes to read
           * about themselves — did not, so `28 games · 13W 15L` had to be counted off the chart.
           */}
          <p className="cn-row-meta">
            <span className="cn-num">{gamesLabel(player.games)}</span>
            {' · '}
            <span className="cn-num">{winLossLabel(player.wins, player.losses)}</span>
          </p>
        </div>

        {/*
         * **Gated on games played, not on points to plot.** `history.length === 0` also means
         * "this player has games the season read did not reach", and the page then told
         * somebody with forty games that the season had none. A player with games and nothing
         * to draw gets no chart and no sentence rather than a false one.
         */}
        {player.games === 0 ? <p className="cn-empty">{NO_GAMES_YET}</p> : null}
        {player.history.length === 0 ? null : <RatingChart history={player.history} seed={player.seed} />}

        {/* Under the chart, once per page (M3.8). */}
        {player.settling ? <SettlingNote /> : null}
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
              <RecentGameView key={game.gameId} game={game} puuid={player.puuid} viewerPuuid={viewerPuuid} />
            ))}
          </ul>
        </section>
      )}

      {nameless ? <NamelessHint /> : null}
    </>
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
  puuid,
  viewerPuuid,
}: {
  game: RecentGame;
  /** Whose page this is: their own row in the lineup carries the `accent` rule. */
  puuid: string;
  viewerPuuid: string | null;
}) {
  const rating = game.muAfter === null ? null : displayRating(game.muAfter);
  const delta =
    game.muBefore === null || game.muAfter === null ? null : displayDelta(game.muBefore, game.muAfter);

  return (
    <li className={`cn-game cn-game-${game.side === 100 ? 'blue' : 'red'}`}>
      <p className="cn-game-head">
        <span className="cn-game-result">{game.won ? WON : LOST}</span> {/*
         * The night this was, beside how long it took. Formatted on the server in the fixed
         * locale and the configured timezone (`lib/night.ts`), so a 01:00 game is dated the
         * night the group played it and the string cannot change under a reader whose browser
         * is set to somewhere else.
         */}
        <span className="cn-num cn-duration">
          {formatDayMonth(new Date(game.startedAt), nightTimeZone())}
        </span>
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
              seat.puuid === puuid || seat.puuid === viewerPuuid ? 'cn-lineup-row cn-you' : 'cn-lineup-row'
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
