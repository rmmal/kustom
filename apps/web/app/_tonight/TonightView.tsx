import { displayRating } from '@customs/core';
import type { RoleValue } from '@customs/db';
import { favoredClause, formatDamage, formatDuration } from '@/lib/discord/embeds';
import { displayDelta, formatWebDelta, isGain } from '@/lib/ratingDisplay';
import { NO_ACTIVE_SEASON_TONIGHT_MESSAGE } from '@/lib/season';
import {
  joinWebNames,
  NAMELESS_HINT,
  renderWebName,
  SIT_OUT_VIEWER,
  SITTING_OUT_LABEL,
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
import { RoleIcon } from '../_icons/RoleIcon';
import { CompanionCard, HowThisWorksCard } from '../_shell/HowThisWorks';
import { RerollControl } from './RerollControl';
import { SeatRack } from './SeatRack';

/**
 * The tonight page's markup (M3.4, Floodlit v2 in M3.18). A pure function of one snapshot and
 * who is looking, so every state in `05-design.md`'s table is a component test rather than a
 * night of waiting.
 *
 * The two rules this file exists to keep, neither of which v2 bends:
 *
 *   - **One primary block**, chosen from `lobbies.status`, replaced in place. The status strip
 *     is always mounted and is the only element that survives every transition.
 *   - **No layout shift inside a state.** A join, a leave, a name arriving and a reroll each
 *     move nothing above the fold: the rack is ten rows at every count, the strip's sentence
 *     has two lines reserved, and both markers are inset shadows rather than borders.
 *
 * The rail is the ≥1080px second column. It never carries state — three static cards — and it
 * is `display: none` below that, where the same two cards are in the footer.
 */

export interface TonightViewProps {
  snapshot: TonightSnapshot;
  /** The signed-in viewer's puuid, for the `brand` "you" rule. `null` for everybody else. */
  viewerPuuid: string | null;
  /** Decided on the server from the session (`lib/viewer.ts`). Draws the reroll control. */
  isAdmin: boolean;
}

export function TonightView({ snapshot, viewerPuuid, isAdmin }: TonightViewProps) {
  const state = tonightState(snapshot);
  const header = tonightHeader(state);
  const viewer = { puuid: viewerPuuid, isAdmin };

  return (
    <div className="cn-grid cn-grid-rail">
      <main className="cn-col">
        <StatusStrip snapshot={snapshot} header={header} />

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
        {state.kind === 'filling' ? (
          <section className="cn-block">
            <SeatRack members={state.lobby.members} viewerPuuid={viewer.puuid} />
          </section>
        ) : null}
        {state.kind === 'teams' ? (
          <TeamsBlock lobby={state.lobby} teams={state.teams} viewer={viewer} />
        ) : null}
        {state.kind === 'result' ? (
          <ResultBlock result={state.result} teams={state.teams} viewerPuuid={viewer.puuid} />
        ) : null}

        {/* M3.10's one quiet line, under the block and never per row. */}
        {hasNamelessRow(state) ? <p className="cn-hint">{NAMELESS_HINT}</p> : null}
      </main>

      <aside className="cn-rail" aria-label="About this page">
        <HowThisWorksCard />
        <CompanionCard />
      </aside>
    </div>
  );
}

/**
 * The status strip (05-design.md, "The status strip"): slug, headline, live pill, sentence.
 *
 * The `<h1>` is the wordmark in the shell, so the headline here is a `<p>` — there is one page
 * title and it is the product's name, not the state of a lobby.
 */
function StatusStrip({
  snapshot,
  header,
}: {
  snapshot: TonightSnapshot;
  header: ReturnType<typeof tonightHeader>;
}) {
  return (
    <header className="cn-strip">
      {/* The line that tells a friend from WhatsApp what they are looking at and when.
          Formatted on the server, in one locale and the configured timezone. With no active
          season it is the date alone. */}
      <p className="cn-num cn-slug">
        {snapshot.seasonName === null
          ? snapshot.nightLabel
          : `${snapshot.nightLabel} · ${snapshot.seasonName}`}
      </p>

      <p className="cn-headline-row">
        {header.count === null ? null : <span className="cn-display cn-count">{header.count}</span>}
        <span className="cn-display cn-headline">{header.headline}</span>
        {header.live ? <LivePill /> : null}
      </p>

      {/*
       * The page's one polite live region, with two lines of `t-sm` reserved: the sentence
       * changes with the count — the one text that changes without a state change — and the
       * block under it must not move while it does.
       */}
      <p className="cn-sentence" aria-live="polite">
        {header.sentence}
      </p>
    </header>
  );
}

/**
 * The one glow and the one pulse in the product. The word is the accessible text and the dot
 * is decoration: a pulsing orange circle that nothing names means nothing.
 *
 * It means **the lobby is open**, not that a socket is up. The page has no idea whether the
 * companion is still running and must not pretend to.
 */
function LivePill() {
  return (
    <span className="cn-live">
      <span className="cn-live-dot" aria-hidden="true" />
      <span className="cn-num cn-live-word">live</span>
    </span>
  );
}

/**
 * No lobby tonight. The strip has said `NOBODY IN YET` and the shipped sentence; this is an
 * empty rack — the shape the page will have in an hour — and the two cards the desktop rail
 * carries, inline at every width, because there is nothing else to read.
 */
function Idle() {
  return (
    <section className="cn-block">
      <SeatRack members={[]} viewerPuuid={null} />
      <div className="cn-idle-cards">
        <HowThisWorksCard />
        <CompanionCard />
      </div>
    </section>
  );
}

interface Viewer {
  puuid: string | null;
  isAdmin: boolean;
}

/**
 * `balanced` and `in_game` render the identical block: the sit-out strip, the two cards blue
 * first, then the explanation line. Only the headline word and the live pill differ, and the
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
 * and you should learn that before you scan for your name. v2 gives it a `raise` header bar so
 * it reads as a card and not as a loose paragraph; the sentences are unchanged.
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
    <section className="cn-card cn-sitout">
      <header className="cn-card-head">
        <span className="cn-num cn-card-label">{SITTING_OUT_LABEL}</span>
      </header>
      <p className="cn-sitout-text">
        {youSit ? SIT_OUT_VIEWER : sitOutGeneral(joinWebNames(sitters.map((member) => member.name)))}
      </p>
    </section>
  );
}

/**
 * One side. The 4px side rule is on the **leading edge** — the top when the cards are stacked,
 * the left when they are side by side — the header bar is `raise` with the side colour on the
 * name only, and the body carries the 10% tint. Never a filled side-coloured block behind five
 * names.
 */
function TeamCard({
  side,
  seats,
  viewerPuuid,
}: {
  side: 'blue' | 'red';
  seats: readonly SeatView[];
  viewerPuuid: string | null;
}) {
  const sum = seats.reduce((total, seat) => total + seat.rating, 0);

  return (
    <section className={`cn-card cn-team cn-team-${side}`}>
      <header className="cn-card-head cn-team-head">
        <h2 className="cn-display cn-side">{side === 'blue' ? 'BLUE' : 'RED'}</h2>
        <p className="cn-num cn-sum">
          {sum}
          <span className="cn-sr"> sum of the five ratings</span>
        </p>
      </header>
      <ul className="cn-seats">
        {seats.map((seat) => (
          <li key={seat.puuid} className={seat.puuid === viewerPuuid ? 'cn-seat cn-you' : 'cn-seat'}>
            <RoleCell role={seat.role} offRole={seat.offRole} />
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
 * Icon and word, always both (05-design.md, "Iconography"). Off-role turns the pair `brand`
 * and dots the word's underline — colour is never the only signal, and the stored explanation
 * names them in a sentence anyway.
 */
function RoleCell({ role, offRole = false }: { role: RoleValue | null; offRole?: boolean }) {
  if (role === null) return <span className="cn-num cn-seat-role" />;

  return (
    <span className={offRole ? 'cn-num cn-seat-role cn-off' : 'cn-num cn-seat-role'}>
      <RoleIcon role={role} />
      {role}
    </span>
  );
}

/**
 * The explanation strip: `splits.explanation` of the promoted split, **verbatim**, as a single
 * paragraph. Never re-composed from the split's numbers, never chopped into chips, never
 * truncated. Three lines of wrap on a phone is the correct outcome.
 *
 * After a reroll the same element re-renders with the promoted split's stored string, off-role
 * clause and all (M3.7). The reroll control stays here and not in the top bar: the button
 * means "give me a different version of *this sentence*".
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
    <div className="cn-card cn-explain">
      <p className="cn-explain-text">{teams.explanation}</p>
      {showReroll ? <RerollControl lobbyId={lobby.id} splits={teams.splits} /> : null}
    </div>
  );
}

/**
 * The result (`finished`). The headline card — winner, duration, the honest prediction line and
 * top damage — then the two team cards with **after** ratings and deltas, then the explanation
 * line of the split they played.
 *
 * **One rating per player per screen.** The cards inside this block are the only cards; there
 * is no second pair underneath with the before numbers (M3.4, M3.16).
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
  const winner = result.winningSide === 100 ? 'BLUE' : 'RED';
  const prediction = favoredClause(result.blueWinProb);

  return (
    <section className="cn-block">
      <section className="cn-card cn-result">
        <p className="cn-result-head">
          {/* The one place in the product where a colour is large, and it is large for one
              line. The strip says `GAME OVER`; this says who won, and neither repeats the
              other (M3.16, and product 2026-09-09). */}
          <span
            className={
              result.winningSide === 100 ? 'cn-display cn-win cn-win-blue' : 'cn-display cn-win cn-win-red'
            }
          >
            {`${winner} WINS`}
          </span>
          <span className="cn-num cn-duration">{formatDuration(result.durationS)}</span>
        </p>
        {prediction === null ? null : <p className="cn-prediction">{prediction}</p>}
        {result.topDamage === null ? null : (
          // A fact about the game, inside the game's own card.
          <p className="cn-damage">
            {`Top damage: ${renderWebName(result.topDamage.name)}, `}
            <span className="cn-num cn-damage-value">{formatDamage(result.topDamage.damage)}</span>
          </p>
        )}
      </section>

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

      {teams === null ? null : (
        <div className="cn-card cn-explain">
          <p className="cn-explain-text">{teams.explanation}</p>
        </div>
      )}
    </section>
  );
}

/**
 * One side of the result. Lane order, the same five positions as the teams block, so "my row"
 * is where it was. The winner keeps its 4px side rule and gains a 1px `brand` ring; the loser's
 * rule drops to a hairline. Two signals, both structural.
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
    <section className={`cn-card cn-team cn-team-${side}${losing ? ' cn-team-lost' : ' cn-team-won'}`}>
      {/*
       * **No side sums here.** The sum answers "are these teams even?", which is a question
       * the game has just answered, and a reader who saw `6000` before and `6465` after has
       * computed a team total of deltas by subtraction — the one number this page must not
       * print (05-design.md, "Result card"). The teams block keeps its sums; this header is
       * the side name alone.
       */}
      <header className="cn-card-head cn-team-head">
        <h2 className="cn-display cn-side">{side === 'blue' ? 'BLUE' : 'RED'}</h2>
      </header>
      <ul className="cn-seats">
        {rows.map(({ seat, rating, delta }) => (
          <li key={seat.puuid} className={seat.puuid === viewerPuuid ? 'cn-seat cn-you' : 'cn-seat'}>
            <RoleCell role={seat.role} />
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
