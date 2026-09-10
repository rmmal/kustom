import { displayRating } from '@customs/core';
import type { RoleValue } from '@customs/db';
import Link from 'next/link';
import {
  gamesLabel,
  LOST,
  NOT_RATED,
  NOT_RATED_HINT,
  PROVEN_LABEL,
  RATING_LABEL,
  RECENT_GAMES_HEADING,
  RECENT_RATING_LEGEND,
  ROLE_RECORD_HEADING,
  WINDOW_EMPTY,
  WON,
  winLossLabel,
} from '@/lib/board/copy';
import type { PlayerBoardView, RecentGame, RecentTeammate } from '@/lib/board/types';
import { formatDuration } from '@/lib/discord/embeds';
import { formatDayMonth } from '@/lib/night';
import { displayDelta, formatWebDelta, isGain } from '@/lib/ratingDisplay';
import { isNameless, renderWebName } from '@/lib/tonight/copy';
import { nightTimeZone } from '@/lib/tonight/night';
import '../board-parts.css';
import { RoleIcon } from '../_icons/RoleIcon';
import { NamelessHint, SettlingChip, SettlingNote } from './parts';
import { RatingChart } from './RatingChart';
import { WindowPicker } from './WindowPicker';

/**
 * `/p/[puuid]` (M3.5, M3.8, M3.10; dressed for Floodlit in M3.19): the two numbers, the
 * `Rating` history, the role record and the last few games.
 *
 * **Two numbers with two names, and no third.** `Rating` and `Proven` are the board's words,
 * printed here under the same two labels, once, above the chart. The chart belongs to `Rating`;
 * the numbers beside it say where the board has this player today.
 *
 * Floodlit's rank order down the page, which v1 had upside down: **the name outranks the
 * section headings and the two numbers outrank both.** The name is the display cut, `Proven` is
 * `t-display`, `Rating` is `t-md`, and `By role` and `Recent games` are mono `t-xs` micro-labels
 * in a `raise` card header — v1 set the name and both headings at the same `t-lg`, which made
 * the largest type on a page about a person the words `By role`.
 *
 * There is **no back link**: the `Leaderboard` tab in the shell is the same destination, and a
 * page does not carry two ways to one place (`05-design.md`, settled with M3.18's shell).
 */

export interface PlayerViewProps {
  player: PlayerBoardView;
}

/**
 * **Nothing on this page depends on who is looking.** A lineup marks the player whose page it
 * is, and only them: marking the viewer as well put the `brand` rule on two of five rows on
 * every night the viewer played beside the person they are reading about (the designer,
 * 2026-09-10), which is two answers to "which one is my row" on a page that is not about the
 * viewer at all.
 */
export function PlayerView({ player }: PlayerViewProps) {
  return (
    <main className="cn-page">
      <header className="cn-strip">
        {/* The person is the page: the display cut, and the biggest language on it. */}
        <h1 className="cn-display cn-player-name">{renderWebName(player.name)}</h1>
        {/*
         * The same five options, in the same order and the same words, as `/leaderboard`
         * (M5.12) — the control looks the same on all three pages, and the parameter is the
         * same word. This page's default is `All time`, because it is a person's history.
         */}
        <WindowPicker path={`/p/${player.puuid}`} selected={player.window} />

        {/*
         * The same slot the board's header carries (the designer, 2026-09-10): the window's one
         * line, under the chips and above the hairline. A player with no counted game in the
         * window says so here rather than inside the card, where it used to sit between the two
         * numbers and the chart.
         */}
        {player.games === 0 ? <p className="cn-empty">{WINDOW_EMPTY[player.window]}</p> : null}
      </header>

      <PlayerWindow player={player} />
    </main>
  );
}

/** The page proper: the two numbers, the chart, the record and the last few games. */
function PlayerWindow({ player }: { player: PlayerBoardView }) {
  const nameless =
    isNameless(player.name) || player.recent.some((game) => game.team.some((seat) => isNameless(seat.name)));
  /** M3.23: the sentence is printed once, and only while a row on the page reads `not rated`. */
  const unrated = player.recent.some((game) => game.muAfter === null);

  return (
    <>
      <section className="cn-block">
        <div className="cn-card cn-player-card">
          {/*
           * Above the chart, once: the primary number and the number people arrive knowing,
           * under the same two labels the board uses, in the board's own order — `Rating`
           * first, because that is the one a reader is looking for, and `Proven` in the
           * display size, because that is the one the board sorts on. The chip sits beside
           * them (M3.8).
           */}
          <div className="cn-summary">
            <p className="cn-numbers">
              <span className="cn-number">
                <span className="cn-number-label">{RATING_LABEL}</span>{' '}
                <span className="cn-num cn-number-value">{player.rating}</span>
              </span>
              <span className="cn-number cn-number-primary">
                <span className="cn-number-label">{PROVEN_LABEL}</span>{' '}
                <span className="cn-num cn-number-value">{player.proven}</span>
              </span>
              {player.settling ? <SettlingChip /> : null}
            </p>

            {/*
             * The record, directly under the two numbers (the designer's review, 2026-09-09).
             * The board prints it on every row and this page — the one place a friend goes to
             * read about themselves — did not, so `28 games · 13W 15L` had to be counted off
             * the chart. It counts the **rated** games, the ones the fold counted (M3.23).
             *
             * At zero games there is no record to print: `0 games · 0W 0L` is three zeros
             * saying what the window's empty line says underneath in words (the designer,
             * 2026-09-10).
             */}
            {player.games === 0 ? null : (
              <p className="cn-row-meta">
                <span className="cn-num">{gamesLabel(player.games)}</span>
                {' · '}
                <span className="cn-num">{winLossLabel(player.wins, player.losses)}</span>
              </p>
            )}
          </div>

          {/*
           * **Gated on games played, not on points to plot.** `history.length === 0` also means
           * "this player has games the window's read did not reach", and the page then told
           * somebody with forty games that they had none. A player with games and nothing
           * to draw gets no chart and no sentence rather than a false one.
           */}
          {player.history.length === 0 ? null : (
            // The hairline is the seed on `All time` and the rating carried **into** the
            // window on the other four, labelled `start` — it is not a seed and does not
            // borrow the word (M5.12).
            <RatingChart history={player.history} reference={player.reference} window={player.window} />
          )}

          {/* Under the chart, once per page (M3.8). */}
          {player.settling ? <SettlingNote /> : null}
        </div>
      </section>

      {player.roles.length === 0 ? null : (
        <section className="cn-block">
          <section className="cn-card cn-list-card">
            <header className="cn-card-head cn-list-head">
              <h2 className="cn-num cn-list-title">{ROLE_RECORD_HEADING}</h2>
            </header>
            <ul className="cn-records">
              {player.roles.map((record) => (
                <li key={record.role} className="cn-record">
                  <RoleName role={record.role} size={20} />
                  <span className="cn-num cn-record-games">{gamesLabel(record.games)}</span>
                  <span className="cn-num cn-record-wl">{winLossLabel(record.wins, record.losses)}</span>
                </li>
              ))}
            </ul>
          </section>
        </section>
      )}

      {player.recent.length === 0 ? null : (
        <section className="cn-block">
          <section className="cn-card cn-list-card">
            <header className="cn-card-head cn-list-head">
              <h2 className="cn-num cn-list-title">{RECENT_GAMES_HEADING}</h2>
              {/* Right-aligned over the column of ratings, the same legend the seat rack
                  carries over its own (the designer's M3.5 review). */}
              <span className="cn-num cn-legend">{RECENT_RATING_LEGEND}</span>
            </header>
            <ul className="cn-games">
              {player.recent.map((game) => (
                <RecentGameView key={game.gameId} game={game} puuid={player.puuid} />
              ))}
            </ul>
          </section>
          {/* Once, under the list, and only while a row on it reads `not rated` (M3.23). */}
          {unrated ? <p className="cn-hint">{NOT_RATED_HINT}</p> : null}
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
 *
 * **A game that moved nothing says so** (M3.23, product 2026-09-10): where the rating would be,
 * the row reads `not rated` — one vocabulary for a game the fold refused and for a backfilled
 * game `rebuild-ratings` has not folded yet, because the reader's question is the same one. The
 * result, the date and the duration print exactly as they do on a rated row.
 */
function RecentGameView({
  game,
  puuid,
}: {
  game: RecentGame;
  /** Whose page this is: their own row in the lineup is plain text, and carries the rule. */
  puuid: string;
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
        {rating === null ? (
          // No delta, no em-dash and no visually-hidden `Rating`: there is no rating on this
          // row to name (product, 2026-09-10).
          <span className="cn-num cn-game-rating cn-not-rated">{NOT_RATED}</span>
        ) : (
          <span className="cn-num cn-game-rating">
            {rating}
            {/* The bare number gets its noun, the same rule the board row's bare Proven
                follows (the designer's M3.5 review). */}
            <span className="cn-sr"> {RATING_LABEL}</span>
            {delta === null ? null : (
              // One string, not three children: React separates adjacent text nodes in the
              // server render, and a rating copied off the page should read `1512 (+43)`.
              <span className={isGain(delta) ? 'cn-delta cn-delta-up' : 'cn-delta'}>
                {` (${formatWebDelta(delta)})`}
              </span>
            )}
          </span>
        )}
      </p>
      <ul className="cn-lineup">
        {game.team.map((seat) => (
          <li key={seat.puuid} className={seat.puuid === puuid ? 'cn-lineup-row cn-you' : 'cn-lineup-row'}>
            {seat.role === null ? <span className="cn-num cn-lineup-role" /> : <RoleName role={seat.role} />}
            <LineupName seat={seat} viewed={seat.puuid === puuid} />
          </li>
        ))}
      </ul>
    </li>
  );
}

/**
 * A teammate's name, and a link to their page — **except the player whose page this is**, whose
 * row is plain text (the designer's M3.5 review). This is the one screen in the product that
 * lists other people by name, and hopping between friends is what the board is for; a link
 * back to the page you are already on is not a destination.
 */
function LineupName({ seat, viewed }: { seat: RecentTeammate; viewed: boolean }) {
  if (viewed) return <span className="cn-lineup-name">{renderWebName(seat.name)}</span>;

  return (
    <Link className="cn-lineup-name cn-lineup-link" href={`/p/${seat.puuid}`}>
      {renderWebName(seat.name)}
    </Link>
  );
}

/**
 * A role, icon and word, always both (`05-design.md`, "Iconography"). The icon is `aria-hidden`
 * and the word beside it is the accessible name; the mark is an anchor for the eye in a dense
 * list, never a replacement for language.
 *
 * 20px where the role is the subject of its row (`By role`), 14px where it sits beside a name
 * in a lineup — the same size the seat rack and the team cards use for exactly that position.
 */
function RoleName({ role, size = 14 }: { role: RoleValue; size?: number }) {
  return (
    <span className="cn-num cn-lineup-role">
      <RoleIcon role={role} size={size} />
      {role}
    </span>
  );
}
