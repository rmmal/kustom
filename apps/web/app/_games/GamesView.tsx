import Link from 'next/link';
import { WINDOW_LABELS, windowSlotLine } from '@/lib/board/copy';
import { EVERYONE_LABEL, GAMES_LABEL, showingFocus } from '@/lib/games/copy';
import { gamesHref, gamesQuery } from '@/lib/games/href';
import type { GamesHistoryView, HistoryGame, HistorySeat, HistoryTeam } from '@/lib/games/types';
import { capLine } from '@/lib/stats/copy';
import { isNameless, renderWebName } from '@/lib/tonight/copy';
import { NamelessHint, RoleName } from '../_board/parts';
import { WindowPicker } from '../_board/WindowPicker';
import { WindowSlot } from '../_board/WindowSlot';
import { MatchSheet, SeatName } from './MatchSheet';
import { QueuePicker } from './QueuePicker';

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
  const extra = gamesQuery({ focusPuuid: history.focusPuuid, queue: history.queue });

  return (
    <main className="cn-page">
      <header className="cn-strip">
        <h1 className="cn-strip-title">
          {WINDOW_LABELS[history.window]} <span className="cn-strip-sub">{GAMES_LABEL}</span>
        </h1>
        <WindowPicker
          path="/games"
          selected={history.window}
          {...(Object.keys(extra).length === 0 ? {} : { query: extra })}
        />
        <QueuePicker
          path="/games"
          window={history.window}
          selected={history.queue}
          query={history.focusPuuid ? { p: history.focusPuuid } : {}}
        />
        <WindowSlot
          window={history.window}
          line={empty ? null : windowSlotLine(history.range as string, history.games)}
        />
        {history.focusPuuid === null || history.focusName === null ? null : (
          <p className="cn-hint">
            {showingFocus(renderWebName(history.focusName))}{' '}
            <Link className="cn-lineup-link" href={gamesHref(history.window, { queue: history.queue })}>
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
        <MatchSheet game={game} focusPuuid={focusPuuid} />
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
