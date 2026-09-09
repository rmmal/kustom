import { displayRating } from '@customs/core';
import { useEffect, useState } from 'react';
import { favoredClause, formatDamage, formatDuration } from '@/lib/discord/embeds';
import { PLAYERS_PER_GAME } from '@/lib/lobbyState';
import { displayDelta, formatWebDelta, isGain } from '@/lib/ratingDisplay';
import { NO_ACTIVE_SEASON_TONIGHT_MESSAGE } from '@/lib/season';
import {
  AROUND_LABEL,
  EMPTY_LOBBY,
  IDLE_LINK_LABEL,
  IDLE_SENTENCE,
  joinWebNames,
  NAMELESS_HINT,
  renderWebName,
  SIT_OUT_VIEWER,
  sitOutGeneral,
} from '@/lib/tonight/copy';
import { hasNamelessRow, tonightHeader, tonightState } from '@/lib/tonight/state';
import type {
  LobbyView,
  MemberView,
  ResultSeatView,
  ResultView,
  SeatView,
  TeamsView,
  TonightSnapshot,
} from '@/lib/tonight/types';
import { RerollControl } from './RerollControl';

/**
 * The tonight page's markup (M3.4). A pure function of one snapshot and who is looking, so
 * every state in `05-design.md`'s table is a component test rather than a night of waiting.
 *
 * The rule this file exists to keep: **one primary block, chosen from `lobbies.status`,
 * replaced in place.** The header strip is always mounted and is the only element that
 * survives every transition. Nothing here appends, scrolls or animates anything but a 150 ms
 * opacity fade.
 */

export interface TonightViewProps {
  snapshot: TonightSnapshot;
  /** The signed-in viewer's puuid, for the `accent` "you" border. `null` for everybody else. */
  viewerPuuid: string | null;
  /** Decided on the server from the session (`lib/viewer.ts`). Draws the reroll control. */
  isAdmin: boolean;
}

export function TonightView({ snapshot, viewerPuuid, isAdmin }: TonightViewProps) {
  const state = tonightState(snapshot);
  const header = tonightHeader(state);
  const viewer = { puuid: viewerPuuid, isAdmin };

  return (
    <main className="cn-page">
      <header className="cn-strip">
        <h1 className="cn-strip-title">
          {header.count === null ? (
            header.label
          ) : (
            <>
              <span className="cn-num cn-count">{header.count}</span>{' '}
              <span className="cn-strip-sub">{header.label}</span>
            </>
          )}
          {header.live ? <span className="cn-dot" aria-hidden="true" /> : null}
        </h1>
        {state.kind === 'filling' ? <LobbyBars around={state.lobby.members.length} /> : null}
      </header>

      {snapshot.seasonActive ? null : (
        // Directly under the strip, not at the foot of a 977px page: it is the reason the
        // numbers below it are not being saved, and a reader who has to scroll to find that
        // out has already read the numbers. **This page's own sentence** (M3.17): the admin
        // one ends by naming a page most of the people holding this link cannot open.
        <p className="cn-notice" role="status">
          {NO_ACTIVE_SEASON_TONIGHT_MESSAGE}
        </p>
      )}

      {state.kind === 'idle' ? <Idle /> : null}
      {state.kind === 'filling' ? <MemberList lobby={state.lobby} viewerPuuid={viewer.puuid} /> : null}
      {state.kind === 'teams' ? <TeamsBlock lobby={state.lobby} teams={state.teams} viewer={viewer} /> : null}
      {state.kind === 'result' ? (
        <ResultBlock result={state.result} teams={state.teams} viewerPuuid={viewer.puuid} />
      ) : null}

      {/* M3.10's one quiet line, under the block and never per row. */}
      {hasNamelessRow(state) ? <p className="cn-hint">{NAMELESS_HINT}</p> : null}
    </main>
  );
}

/**
 * No lobby tonight. One sentence and a link, and nothing else: no spinner, no skeleton, no
 * illustration, and no repeat of the header strip's `Nothing tonight`.
 *
 * The link is a plain anchor rather than `next/link` because `/leaderboard` does not exist
 * until M3.5 and `typedRoutes` will not type a route that has no page. It becomes a `Link` in
 * the same commit that creates the board.
 */
function Idle() {
  return (
    <section className="cn-block">
      <p className="cn-idle">{IDLE_SENTENCE}</p>
      <p>
        <a className="cn-link" href="/leaderboard">
          {IDLE_LINK_LABEL}
        </a>
      </p>
    </section>
  );
}

/** Ten 3px bars: the whole status at arm's length, countable without reading. */
function LobbyBars({ around }: { around: number }) {
  const filled = Math.min(around, PLAYERS_PER_GAME);
  return (
    <div className="cn-bars" aria-hidden="true">
      {Array.from({ length: PLAYERS_PER_GAME }, (_, index) => (
        <span
          // The bars are positional and have no identity of their own.
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed-length row of ten marks
          key={index}
          className={index < filled ? 'cn-bar cn-bar-on' : 'cn-bar'}
        />
      ))}
    </div>
  );
}

/**
 * The lobby filling up. Join order, oldest first, newest appended — a list that reorders under
 * a thumb is worse than a list you scroll — and **ten rows of height reserved from the first
 * paint**, so the 9→10 join moves nothing.
 */
function MemberList({ lobby, viewerPuuid }: { lobby: LobbyView; viewerPuuid: string | null }) {
  const playing = lobby.members.filter((member) => !member.isSpectator);
  const around = lobby.members.filter((member) => member.isSpectator);

  return (
    <section className="cn-block">
      {lobby.members.length === 0 ? <p className="cn-empty">{EMPTY_LOBBY}</p> : null}
      <ul className="cn-members">
        {playing.map((member) => (
          <MemberRow key={member.puuid} member={member} viewerPuuid={viewerPuuid} />
        ))}
      </ul>
      {around.length === 0 ? null : (
        <>
          <p className="cn-around">{AROUND_LABEL}</p>
          <ul className="cn-members cn-members-around">
            {around.map((member) => (
              <MemberRow key={member.puuid} member={member} viewerPuuid={viewerPuuid} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function MemberRow({ member, viewerPuuid }: { member: MemberView; viewerPuuid: string | null }) {
  const you = member.puuid === viewerPuuid;
  const justJoined = useJustJoined(member.joinedAt);

  return (
    <li className={you ? 'cn-member cn-you' : 'cn-member'}>
      {/* The three-second marker. Always mounted, so removing it is a 150ms opacity fade
          rather than a row that changes shape (05-design.md, "Lobby member list"). */}
      <span className={justJoined ? 'cn-new cn-new-on' : 'cn-new'} aria-hidden="true" />
      <span className="cn-member-name">{renderWebName(member.name)}</span>
      <span className="cn-num cn-member-roles">{roleLine(member)}</span>
      <span className="cn-num cn-member-rating">{member.rating}</span>
    </li>
  );
}

/** `05-design.md`: a member who joined in the last 3s carries a 2px accent left border. */
const JUST_JOINED_MS = 3_000;

/**
 * Has this row been on the page for less than three seconds?
 *
 * Always `false` on the server, and decided after mount: the answer depends on the clock, and
 * a server render that disagreed with the first client render is a hydration mismatch. The
 * timer clears itself, so a row stops being new exactly once and nothing polls.
 */
function useJustJoined(joinedAt: string): boolean {
  const [justJoined, setJustJoined] = useState(false);

  useEffect(() => {
    // A row whose timestamp is in the future — the database's clock is not the phone's — is
    // not new, it is skewed, and it must not keep an accent border for the rest of the night.
    const age = Date.now() - Date.parse(joinedAt);
    if (!Number.isFinite(age) || age < 0 || age >= JUST_JOINED_MS) return;

    setJustJoined(true);
    const timer = setTimeout(() => setJustJoined(false), JUST_JOINED_MS - age);
    return () => clearTimeout(timer);
  }, [joinedAt]);

  return justJoined;
}

/**
 * `top / mid`, or `flexible` for somebody who has declared nothing.
 *
 * The player's own two roles, as `players` holds them. A role tap for tonight
 * (`lobby_members.role_override`) has no writer until M3.6 and no renderer here: showing it
 * would mean restating core's `resolveRoles` in the web app, and M3.6 lands the control and
 * the resolved pair together.
 */
function roleLine(member: MemberView): string {
  if (member.mainRole === null) return 'flexible';
  return member.secondaryRole === null ? member.mainRole : `${member.mainRole} / ${member.secondaryRole}`;
}

interface Viewer {
  puuid: string | null;
  isAdmin: boolean;
}

/**
 * `balanced` and `in_game` render the identical block: the sit-out strip, the two cards blue
 * first, then the explanation line. Only the header word and the live dot differ, and the
 * cards do not re-render, re-fetch or fade on the way between them.
 */
function TeamsBlock({ lobby, teams, viewer }: { lobby: LobbyView; teams: TeamsView; viewer: Viewer }) {
  return (
    <section className="cn-block">
      <SitOutNotice sitters={teams.sitters} viewerPuuid={viewer.puuid} />
      <div className="cn-cards">
        <TeamCard side="blue" seats={teams.blue} viewerPuuid={viewer.puuid} />
        <TeamCard side="red" seats={teams.red} viewerPuuid={viewer.puuid} />
      </div>
      <Explanation
        lobby={lobby}
        teams={teams}
        // The control is drawn for an admin while there are teams to reroll. The route checks
        // the session again before it writes; this only decides whether a button is on screen.
        showReroll={viewer.isAdmin && lobby.status === 'balanced'}
      />
    </section>
  );
}

/**
 * Above the cards, never below: if you are sitting out, everything under it is not about you,
 * and you should learn that before you scan for your name.
 */
function SitOutNotice({
  sitters,
  viewerPuuid,
}: {
  sitters: readonly MemberView[];
  viewerPuuid: string | null;
}) {
  if (sitters.length === 0) return null;
  const youSit = viewerPuuid !== null && sitters.some((member) => member.puuid === viewerPuuid);

  return (
    <p className="cn-sitout">
      {youSit ? SIT_OUT_VIEWER : sitOutGeneral(joinWebNames(sitters.map((member) => member.name)))}
    </p>
  );
}

function TeamCard({
  side,
  seats,
  viewerPuuid,
  losing = false,
}: {
  side: 'blue' | 'red';
  seats: readonly SeatView[];
  viewerPuuid: string | null;
  /** The result card drops the losing side's 3px rule to a hairline. Nothing else changes. */
  losing?: boolean;
}) {
  const sum = seats.reduce((total, seat) => total + seat.rating, 0);
  return (
    <section className={`cn-card cn-card-${side}${losing ? ' cn-card-lost' : ''}`}>
      <header className="cn-card-head">
        <h2 className="cn-side">{side === 'blue' ? 'Blue' : 'Red'}</h2>
        <p className="cn-num cn-sum">
          {sum}
          <span className="cn-sr"> sum of the five ratings</span>
        </p>
      </header>
      <ul className="cn-seats">
        {seats.map((seat) => (
          <li key={seat.puuid} className={seat.puuid === viewerPuuid ? 'cn-seat cn-you' : 'cn-seat'}>
            <span className={seat.offRole ? 'cn-num cn-role cn-off' : 'cn-num cn-role'}>{seat.role}</span>
            <span className="cn-seat-name">
              {seat.offRole ? <span className="cn-off-dot" aria-hidden="true" /> : null}
              {renderWebName(seat.name)}
              {seat.offRole ? <span className="cn-sr"> off-role</span> : null}
            </span>
            <span className="cn-num cn-seat-rating">{seat.rating}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The explanation strip: `splits.explanation` of the promoted split, **verbatim**, as a single
 * paragraph. Never re-composed from the split's numbers, never chopped into chips, never
 * truncated. Three lines of wrap on a phone is the correct outcome.
 *
 * After a reroll the same element re-renders with the promoted split's stored string, off-role
 * clause and all (M3.7).
 */
function Explanation({
  lobby,
  teams,
  showReroll,
}: {
  lobby: LobbyView;
  teams: TeamsView;
  showReroll: boolean;
}) {
  return (
    <div className="cn-explain">
      <p className="cn-explain-text">{teams.explanation}</p>
      {showReroll ? <RerollControl lobbyId={lobby.id} splits={teams.splits} /> : null}
    </div>
  );
}

/**
 * The result (`finished`). The result card is the whole block: headline, duration, the honest
 * prediction line, the two team cards with **after** ratings and delta chips, top damage. Then
 * the explanation line of the split they played.
 *
 * **One rating per player per screen.** The cards inside this card are the only cards; there is
 * no second pair underneath with the before numbers (M3.4; the state table in `05-design.md`
 * reads as though there were, and M3.16 is reconciling it).
 */
function ResultBlock({
  result,
  teams,
  viewerPuuid,
}: {
  result: ResultView;
  teams: TeamsView | null;
  viewerPuuid: string | null;
}) {
  const winner = result.winningSide === 100 ? 'Blue' : 'Red';
  const prediction = favoredClause(result.blueWinProb);

  return (
    <section className="cn-block">
      <p className="cn-headline">
        <span className={result.winningSide === 100 ? 'cn-win-blue' : 'cn-win-red'}>{`${winner} wins`}</span>{' '}
        <span className="cn-num cn-duration">{formatDuration(result.durationS)}</span>
      </p>
      {prediction === null ? null : <p className="cn-prediction">{prediction}</p>}

      <div className="cn-cards">
        <ResultCard
          side="blue"
          seats={result.blue}
          losing={result.winningSide !== 100}
          viewerPuuid={viewerPuuid}
        />
        <ResultCard
          side="red"
          seats={result.red}
          losing={result.winningSide !== 200}
          viewerPuuid={viewerPuuid}
        />
      </div>

      {result.topDamage === null ? null : (
        <p className="cn-damage">
          {`Top damage: ${renderWebName(result.topDamage.name)}, `}
          <span className="cn-num cn-damage-value">{formatDamage(result.topDamage.damage)}</span>.
        </p>
      )}

      {teams === null ? null : (
        <div className="cn-explain">
          <p className="cn-explain-text">{teams.explanation}</p>
        </div>
      )}
    </section>
  );
}

/**
 * One side of the result card. Lane order, the same five positions as the teams block, so "my
 * row" is where it was.
 *
 * **The delta is computed here, at render.** `displayDelta` returns `-0` for a rating that fell
 * by less than half a point, and `-0` does not survive `JSON.stringify`: carried through a
 * payload it would print `(+0)` on a row that went down (`05-design.md`).
 */
function ResultCard({
  side,
  seats,
  losing,
  viewerPuuid,
}: {
  side: 'blue' | 'red';
  seats: readonly ResultSeatView[];
  losing: boolean;
  viewerPuuid: string | null;
}) {
  const rows = seats.map((seat) => ({
    seat,
    rating: seat.muAfter === null ? null : displayRating(seat.muAfter),
    delta: seat.muBefore === null || seat.muAfter === null ? null : displayDelta(seat.muBefore, seat.muAfter),
  }));

  return (
    <section className={`cn-card cn-card-${side}${losing ? ' cn-card-lost' : ''}`}>
      {/*
       * **No side sums here.** The sum answers "are these teams even?", which is a question
       * the game has just answered, and a reader who saw `6000` before and `6465` after has
       * computed a team total of deltas by subtraction — the one number this page must not
       * print (05-design.md, "Result card"). The teams block keeps its sums; this header is
       * the side name alone.
       */}
      <header className="cn-card-head">
        <h2 className="cn-side">{side === 'blue' ? 'Blue' : 'Red'}</h2>
      </header>
      <ul className="cn-seats">
        {rows.map(({ seat, rating, delta }) => (
          <li key={seat.puuid} className={seat.puuid === viewerPuuid ? 'cn-seat cn-you' : 'cn-seat'}>
            <span className="cn-num cn-role">{seat.role ?? ''}</span>
            <span className="cn-seat-name">{renderWebName(seat.name)}</span>
            <span className="cn-num cn-seat-rating">
              {rating ?? ''}
              {delta === null ? null : (
                // One string, not three children: React separates adjacent text nodes with
                // `<!-- -->` in the server render, and a rating copied off the page should
                // read `1512 (+43)`.
                <span className={isGain(delta) ? 'cn-delta cn-delta-up' : 'cn-delta'}>
                  {` (${formatWebDelta(delta)})`}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
