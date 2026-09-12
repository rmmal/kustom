import Link from 'next/link';
import { WINDOW_LABELS, windowSlotLine } from '@/lib/board/copy';
import { windowHref } from '@/lib/board/window';
import {
  COL_CS,
  COL_DAMAGE,
  COL_GOLD,
  COL_KDA,
  EVERYONE_LABEL,
  GAMES_LABEL,
  SCOREBOARD_LABEL,
  showingFocus,
} from '@/lib/games/copy';
import type { GamesHistoryView, HistoryGame, HistorySeat, HistoryTeam } from '@/lib/games/types';
import { capLine } from '@/lib/stats/copy';
import { isNameless, renderWebName } from '@/lib/tonight/copy';
import { NamelessHint, RoleName } from '../_board/parts';
import { WindowPicker } from '../_board/WindowPicker';
import { WindowSlot } from '../_board/WindowSlot';

/**
 * `/games`: the window's captured customs, each a collapsed match card that opens into both
 * scoreboards. The same recipe OP.GG uses for a match history, dressed in Floodlit — side
 * rules, no champion art, no item icons, no green.
 *
 * A pure function of one snapshot. Expand is `<details>`, so the page works with JavaScript
 * off and does not need a client component.
 */

export function GamesView({ history }: { history: GamesHistoryView }) {
  const empty = history.range === null;
  const nameless =
    isNameless(history.focusName) ||
    history.items.some(
      (game) =>
        game.blue.seats.some((seat) => isNameless(seat.name)) ||
        game.red.seats.some((seat) => isNameless(seat.name)),
    );
  const query = history.focusPuuid === null ? undefined : { p: history.focusPuuid };

  return (
    <main className="cn-page">
      <header className="cn-strip">
        <h1 className="cn-strip-title">
          {WINDOW_LABELS[history.window]} <span className="cn-strip-sub">{GAMES_LABEL}</span>
        </h1>
        <WindowPicker path="/games" selected={history.window} {...(query === undefined ? {} : { query })} />
        <WindowSlot
          window={history.window}
          line={empty ? null : windowSlotLine(history.range as string, history.games)}
        />
        {history.focusPuuid === null || history.focusName === null ? null : (
          <p className="cn-hint">
            {showingFocus(renderWebName(history.focusName))}{' '}
            <Link className="cn-lineup-link" href={windowHref('/games', history.window)}>
              {EVERYONE_LABEL}
            </Link>
          </p>
        )}
        {history.capped ? <p className="cn-hint">{capLine(history.cap)}</p> : null}
      </header>

      {empty ? null : (
        <section className="cn-block">
          <ol className="cn-matches">
            {history.items.map((game) => (
              <MatchCard key={game.id} game={game} focusPuuid={history.focusPuuid} />
            ))}
          </ol>
        </section>
      )}

      {nameless ? <NamelessHint /> : null}
    </main>
  );
}

function MatchCard({ game, focusPuuid }: { game: HistoryGame; focusPuuid: string | null }) {
  const side = game.ruleSide === 100 ? 'blue' : 'red';

  return (
    <li>
      <details className={`cn-match cn-card cn-match-${side}`}>
        <summary className="cn-match-summary">
          <span className="cn-match-mark" aria-hidden="true" />
          <p className="cn-game-head">
            <span className="cn-game-result">{game.result}</span>
            <span className="cn-num cn-duration">{game.startedLabel}</span>
            <span className="cn-num cn-duration">{game.durationLabel}</span>
            <span className="cn-num cn-match-score">{game.score}</span>
          </p>
          {game.focus === null || game.focusMeta === null ? null : (
            <p className="cn-num cn-match-meta">{game.focusMeta}</p>
          )}
          {focusPuuid === null ? (
            <BothSides game={game} />
          ) : (
            <Teammates seats={game.teammates} focusPuuid={focusPuuid} />
          )}
        </summary>
        <Scoreboard game={game} focusPuuid={focusPuuid} />
      </details>
    </li>
  );
}

function BothSides({ game }: { game: HistoryGame }) {
  return (
    <div className="cn-match-sides">
      <NameColumn team={game.blue} />
      <NameColumn team={game.red} />
    </div>
  );
}

function NameColumn({ team }: { team: HistoryTeam }) {
  return (
    <ul className="cn-match-names">
      {team.seats.map((seat) => (
        <li key={seat.puuid} className="cn-match-name">
          <SeatName seat={seat} viewed={false} />
        </li>
      ))}
    </ul>
  );
}

function Teammates({ seats, focusPuuid }: { seats: readonly HistorySeat[]; focusPuuid: string }) {
  return (
    <ul className="cn-lineup">
      {seats.map((seat) => (
        <li key={seat.puuid} className={seat.puuid === focusPuuid ? 'cn-lineup-row cn-you' : 'cn-lineup-row'}>
          {seat.role === null ? <span className="cn-num cn-lineup-role" /> : <RoleName role={seat.role} />}
          <SeatName seat={seat} viewed={seat.puuid === focusPuuid} />
        </li>
      ))}
    </ul>
  );
}

function Scoreboard({ game, focusPuuid }: { game: HistoryGame; focusPuuid: string | null }) {
  return (
    <div className="cn-sheet">
      <p className="cn-sr">{SCOREBOARD_LABEL}</p>
      <TeamSheet team={game.blue} focusPuuid={focusPuuid} />
      <TeamSheet team={game.red} focusPuuid={focusPuuid} />
    </div>
  );
}

function TeamSheet({ team, focusPuuid }: { team: HistoryTeam; focusPuuid: string | null }) {
  const tone = team.side === 100 ? 'blue' : 'red';

  return (
    <section className={`cn-sheet-team cn-sheet-${tone}`}>
      <header className="cn-sheet-head">
        <h2 className="cn-sheet-title">{team.label}</h2>
        <span className="cn-num cn-sheet-gold-total">{team.goldLabel}</span>
      </header>
      <div className="cn-sheet-cols" aria-hidden="true">
        <span />
        <span />
        <span className="cn-num">{COL_KDA}</span>
        <span className="cn-num cn-sheet-wide">{COL_DAMAGE}</span>
        <span className="cn-num cn-sheet-wide">{COL_GOLD}</span>
        <span className="cn-num">{COL_CS}</span>
      </div>
      <ol className="cn-sheet-rows">
        {team.seats.map((seat) => (
          <li key={seat.puuid} className={seat.puuid === focusPuuid ? 'cn-sheet-row cn-you' : 'cn-sheet-row'}>
            {seat.role === null ? <span className="cn-num cn-lineup-role" /> : <RoleName role={seat.role} />}
            <span className="cn-sheet-who">
              <SeatName seat={seat} viewed={seat.puuid === focusPuuid} />
              <span className="cn-num cn-sheet-sub">
                {seat.csLabel}
                {seat.kp === null ? '' : ` · ${seat.kp}% KP`}
              </span>
            </span>
            <span className="cn-num cn-sheet-kda">{seat.kda}</span>
            <span className="cn-sheet-bar cn-sheet-wide" aria-hidden="true">
              <span className="cn-sheet-bar-fill" style={{ width: `${seat.damageShare}%` }} />
              <span className="cn-num cn-sheet-bar-n">{seat.damageLabel}</span>
            </span>
            <span className="cn-num cn-sheet-wide">{seat.goldLabel}</span>
            <span className="cn-num">{seat.csLabel}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function SeatName({ seat, viewed }: { seat: HistorySeat; viewed: boolean }) {
  if (viewed) return <span className="cn-lineup-name">{renderWebName(seat.name)}</span>;

  return (
    <Link className="cn-lineup-name cn-lineup-link" href={`/p/${seat.puuid}`}>
      {renderWebName(seat.name)}
    </Link>
  );
}
