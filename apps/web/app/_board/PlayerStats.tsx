import Link from 'next/link';
import { gamesLabel, ROLE_RECORD_HEADING, winLossLabel } from '@/lib/board/copy';
import { formatStreak, type Streak } from '@/lib/board/streak';
import {
  averageGameLine,
  BEST_TOGETHER,
  CURRENT_STREAK,
  capLine,
  LONGEST_LOSS,
  LONGEST_WIN,
  NO_PARTNERS,
  noRoleFootnote,
  PARTNERS_HEADING,
  percentLabel,
  SIDE_LABELS,
  SIDE_RECORD_HEADING,
  STREAKS_HEADING,
  WORST_TOGETHER,
} from '@/lib/stats/copy';
import type { PartnerRecord, PlayerSideRecord, PlayerStatsView, StatsRecord } from '@/lib/stats/types';
import { renderWebName } from '@/lib/tonight/copy';
import { RoleName } from './parts';

/**
 * The per-player sections on `/p/[puuid]` (M5.20), under the rating chart: how **this** person
 * does on each role, on each side, beside each of their friends, and how long their games run.
 *
 * The scene is not the ten-in-voice one. It is the friend who lost four in a row, opened their
 * own page to work out whether it is them or the teams, and until this task found a chart and a
 * list of games. `/stats` answers "who is best on jungle"; this answers "how do I do on
 * jungle".
 *
 * **It renders `lib/stats` and decides nothing.** Every number arrives folded (`player.ts`),
 * every word is a constant in `lib/stats/copy.ts` or `lib/board/copy.ts`, and the page reads
 * the same loader `/stats` does — so a record here and the same record there are one
 * computation, not two that agree today.
 *
 * The dress is M5.8's, applied to a person instead of a group: two heading levels and no third
 * (a card title in Archivo, a group label in `dim`), a streak as a **row** and not a sentence,
 * and roles as the exception they always are — mono, lower case, icon and word.
 */

export interface PlayerStatsProps {
  stats: PlayerStatsView;
}

export function PlayerStats({ stats }: PlayerStatsProps) {
  /**
   * **A window this player did not play draws nothing at all.**
   *
   * The window's own empty sentence is already in the header strip, two hundred pixels above,
   * and it is the true and complete answer; four cards saying `Nobody has 5 games with them
   * yet.` under it would be four ways of repeating one line. It is the same rule the page
   * already follows for the chart and for `Recent games`, and M5.8's rule 6 for an empty
   * window on `/stats` — nothing is drawn over the sentence.
   */
  if (stats.games === 0) return null;

  return (
    <>
      {/*
       * The award, first, because it is about the climb the chart above it draws — one line,
       * no badge and no icon (product). It is only ever here on `Last week` and `Last month`:
       * a running window has handed nothing out yet and `All time` never will.
       */}
      {stats.awards.length === 0 ? null : (
        <section className="cn-block">
          {stats.awards.map((line) => (
            <p key={line} className="cn-player-award">
              {line}
            </p>
          ))}
        </section>
      )}

      <Roles stats={stats} />
      <Sides sides={stats.sides} />
      <Partners best={stats.bestPartners} worst={stats.worstPartners} />
      <Streaks streaks={stats.streaks} />

      {/*
       * Their mean game: **one sentence and no card** (the designer, 2026-09-11). `/stats`'
       * card holds three statements about one subject; one sentence in the same box is a card
       * with a line in it, which is the empty-card failure at its smallest. It is the same
       * string as the group's since product took the count out of both (M5.22) — one function,
       * two pages. **Never `0 min` and never `NaN`**: `null` is a player with no counted game,
       * and this whole band is undrawn there.
       */}
      {stats.averageMinutes === null ? null : (
        <section className="cn-block">
          <p className="cn-stats-answer">{averageGameLine(stats.averageMinutes)}</p>
        </section>
      )}

      {/* Nothing drops silently: over the cap the page says which games these numbers are over. */}
      {stats.capped ? <p className="cn-hint">{capLine(stats.cap)}</p> : null}
    </>
  );
}

/**
 * `By role`: the positions they actually played, in lane order, with a percentage from five
 * rows up.
 *
 * **Under five rows the record prints bare** (`1W 0L`), so nobody is "100% mid" off one game —
 * product's minimum, applied by the fold and simply rendered here.
 */
function Roles({ stats }: { stats: PlayerStatsView }) {
  return (
    <section className="cn-block">
      <section className="cn-card cn-list-card">
        <header className="cn-card-head cn-list-head">
          <h2 className="cn-board-title">{ROLE_RECORD_HEADING}</h2>
        </header>
        {stats.roles.length === 0 ? (
          <div className="cn-role-block">
            {/*
             * Every one of their games was backfilled, so the client recorded no positions and
             * there is no role row to draw. The footnote is the section's whole answer, in
             * `/stats`'s own words with this player's own count in it.
             */}
            <p className="cn-stats-empty">{noRoleFootnote(stats.noRoleGames)}</p>
          </div>
        ) : (
          <ul className="cn-records">
            {stats.roles.map((record) => (
              <li key={record.role} className="cn-record cn-stats-duo">
                <RoleName role={record.role} size={16} />
                <Record record={record} />
              </li>
            ))}
          </ul>
        )}
      </section>
      {/*
       * Under the card, and only above zero: the games of theirs the record above cannot see.
       * Not printed twice — with no role rows at all it *is* the section, above.
       */}
      {stats.noRoleGames === 0 || stats.roles.length === 0 ? null : (
        <p className="cn-hint">{noRoleFootnote(stats.noRoleGames)}</p>
      )}
    </section>
  );
}

/**
 * `By side`: their rows on blue and their rows on red, with the same five-row minimum.
 *
 * **The group's blue rate is `/stats`'s headline and is not repeated here.** This card answers
 * the one thing a person can say about it — "I told you I win on red" — and says nothing about
 * the twenty of them.
 */
function Sides({ sides }: { sides: PlayerSideRecord[] }) {
  return (
    <section className="cn-block">
      <section className="cn-card cn-list-card">
        <header className="cn-card-head cn-list-head">
          <h2 className="cn-board-title">{SIDE_RECORD_HEADING}</h2>
        </header>
        <ul className="cn-records">
          {sides.map(({ side, record }) => (
            <li key={side} className="cn-record cn-stats-duo">
              {/*
               * **A capitalised name, in Archivo, in its own side's colour**: product's casing
               * (2026-09-11 — every side this product prints to a friend is capitalised) and the
               * designer's colour (`blue` / `red` on the word, not `dim`). The mono lower-case
               * register stays the roles' alone, which is also why this is not
               * `.cn-lineup-role`, a role and its icon. The colour is on the **word** and never
               * a tint behind the row: a tint means "which team" on the tonight page.
               */}
              <span className={side === 100 ? 'cn-stats-side cn-side-blue' : 'cn-stats-side cn-side-red'}>
                {SIDE_LABELS[side]}
              </span>
              <Record record={record} />
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}

/**
 * `Partners`: the three best and the three worst, at five games together **on the same side**.
 *
 * A game the two of them played against each other is in neither list — it is not a game they
 * played together, and rivalries are a different question the milestone put out of scope.
 *
 * **Nobody over the bar is one sentence with no labels over it** (the designer, 2026-09-11): a
 * group label is a promise of rows, and `Best together` above `Nobody has 5 games with them
 * yet.` above `Worst together` above the same line again says one true thing four times.
 * `Worst together` is drawn only when there is something under it, which is also what the
 * fold's split guarantees at three qualifying partners or fewer.
 */
function Partners({ best, worst }: { best: PartnerRecord[]; worst: PartnerRecord[] }) {
  return (
    <section className="cn-block">
      <section className="cn-card cn-list-card">
        <header className="cn-card-head cn-list-head">
          <h2 className="cn-board-title">{PARTNERS_HEADING}</h2>
        </header>
        {best.length === 0 ? (
          <div className="cn-role-block">
            <p className="cn-stats-empty">{NO_PARTNERS}</p>
          </div>
        ) : (
          <>
            <PartnerList title={BEST_TOGETHER} partners={best} />
            {worst.length === 0 ? null : <PartnerList title={WORST_TOGETHER} partners={worst} />}
          </>
        )}
      </section>
    </section>
  );
}

function PartnerList({ title, partners }: { title: string; partners: PartnerRecord[] }) {
  return (
    <div className="cn-role-block">
      <p className="cn-stats-subtitle">{title}</p>
      <ul className="cn-records">
        {partners.map((partner) => (
          <li key={partner.puuid} className="cn-record cn-stats-duo">
            {/* Every other name on this page is a link to their page; so is this one. */}
            <Link className="cn-stats-name" href={`/p/${partner.puuid}`}>
              {renderWebName(partner.name)}
            </Link>
            <Record record={partner} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * `Streaks`: the run they are on, and the longest of each kind the window holds.
 *
 * **A streak is a row, not a sentence** (M5.8): label left, `W3` right in mono, which is the
 * form the leaderboard row already prints and comes from the same helper — the current streak
 * here and the `W3` on their board row are one number computed once.
 *
 * A kind nobody managed prints no row: `L0` in a column of `W3`s reads as data.
 */
function Streaks({ streaks }: { streaks: PlayerStatsView['streaks'] }) {
  if (streaks === null) return null;

  return (
    <section className="cn-block">
      <section className="cn-card cn-list-card">
        <header className="cn-card-head cn-list-head">
          <h2 className="cn-board-title">{STREAKS_HEADING}</h2>
        </header>
        <ul className="cn-records">
          <StreakRow label={CURRENT_STREAK} streak={streaks.current} />
          <StreakRow label={LONGEST_WIN} streak={run('W', streaks.longestWin)} />
          <StreakRow label={LONGEST_LOSS} streak={run('L', streaks.longestLoss)} />
        </ul>
      </section>
    </section>
  );
}

function StreakRow({ label, streak }: { label: string; streak: Streak | null }) {
  if (streak === null) return null;

  return (
    <li className="cn-record cn-stats-duo">
      <span className="cn-stats-subtitle">{label}</span>
      <span className="cn-num cn-record-wl">{formatStreak(streak)}</span>
    </li>
  );
}

/** A length of zero is a run that never happened, and has no row. */
function run(kind: 'W' | 'L', length: number): Streak | null {
  return length === 0 ? null : { kind, length };
}

/**
 * `12W 5L · 71%`, or the bare `1W 0L` under the minimum — one shape for a role, a side and a
 * partner, so three lists read as one page.
 *
 * The count the percentage is over is in the row for a screen reader only: on the page it is
 * `12 + 5`, and a third number in a 44px row is the table this page is not.
 */
function Record({ record }: { record: StatsRecord }) {
  return (
    <span className="cn-num cn-record-wl">
      {winLossLabel(record.wins, record.losses)}
      {record.winRate === null ? null : ` · ${percentLabel(record.winRate)}`}
      <span className="cn-sr"> over {gamesLabel(record.games)}</span>
    </span>
  );
}
