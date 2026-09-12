import Link from 'next/link';
import type { ReactNode } from 'react';
import { WINDOW_LABELS, windowSlotLine } from '@/lib/board/copy';
import type { HistoryGame } from '@/lib/games/types';
import { capLine, playersLine } from '@/lib/stats/copy';
import {
  CS_HEADING,
  CS_HIGH_LABEL,
  CS_LOW_LABEL,
  DEATH_HALL_TITLE,
  FEAR_BAN_RULE,
  FUN_LABEL,
  HABITS_HEADING,
  noCsAtRole,
  RECORDS_HEADING,
  THIEF_EMPTY,
  THIEF_TITLE,
  THIS_GAME,
} from '@/lib/stats/funCopy';
import type {
  FunBloodRow,
  FunFactsView,
  FunFearBan,
  FunHolder,
  FunRecord,
  FunSection,
  FunTable,
  PlayerRef,
  RoleCsPair,
} from '@/lib/stats/types';
import { renderWebName } from '@/lib/tonight/copy';
import { WindowPicker } from '../_board/WindowPicker';
import { WindowSlot } from '../_board/WindowSlot';
import { MatchSheet } from '../_games/MatchSheet';
import { QueuePicker } from '../_games/QueuePicker';
import { RoleIcon } from '../_icons/RoleIcon';
import '../board-parts.css';

/**
 * `/fun` (M5.24, M5.27): the window's records, in the same shell `/stats` already wears.
 *
 * A pure function of one snapshot. The numbers live in `lib/stats/fun.ts`; this file decides
 * nothing except order: first blood, deaths, steals, fear bans, then CS by role, then one-game
 * records, then habits. The Rift / ARAM picker is the same chips `/games` wears. CS-by-role
 * and objective steals are Rift only. Rows are labelled (name left, number right) so a long
 * Riot ID cannot wrap into the score.
 */

export function FunView({ facts }: { facts: FunFactsView }) {
  const empty = facts.range === null;
  const queueQuery = facts.queue === 'sr' ? {} : { queue: facts.queue };

  return (
    <main className="cn-page">
      <header className="cn-strip">
        <h1 className="cn-strip-title">
          {WINDOW_LABELS[facts.window]} <span className="cn-strip-sub">{FUN_LABEL}</span>
        </h1>
        <WindowPicker
          path="/fun"
          selected={facts.window}
          {...(Object.keys(queueQuery).length === 0 ? {} : { query: queueQuery })}
        />
        <QueuePicker path="/fun" window={facts.window} selected={facts.queue} />
        <WindowSlot
          window={facts.window}
          line={empty ? null : windowSlotLine(facts.range as string, facts.games)}
        />
        {facts.capped ? <p className="cn-hint">{capLine(facts.cap)}</p> : null}
      </header>

      {empty ? null : (
        <>
          <section className="cn-block">
            <section className="cn-card cn-stats-lines">
              <p className="cn-stats-line">{playersLine(facts.players)}</p>
            </section>
          </section>
          <Museum museum={facts.museum} most={facts.tables.find((table) => table.id === 'first-blood')} />
          <Records heading={DEATH_HALL_TITLE} records={facts.deathHall} />
          {facts.queue === 'aram' ? null : <Thieves records={facts.thieves} />}
          <FearBans section={facts.fearBans} />
          {facts.queue === 'aram' ? null : <CsByRole pairs={facts.csByRole} />}
          <Records
            heading={RECORDS_HEADING}
            records={facts.records.filter((record) => !isHabit(record.id))}
          />
          <Records heading={HABITS_HEADING} records={facts.records.filter((record) => isHabit(record.id))} />
        </>
      )}
    </main>
  );
}

function isHabit(id: string): boolean {
  return id === 'attendance' || id === 'comfort' || id === 'longest' || id === 'shortest';
}

function Museum({ museum, most }: { museum: FunSection<FunBloodRow>; most: FunTable | undefined }) {
  return (
    <section className="cn-block">
      <section className="cn-card cn-list-card">
        <header className="cn-card-head cn-list-head">
          <h2 className="cn-board-title">{museum.title}</h2>
        </header>
        <div className="cn-role-block">
          <p className="cn-stats-intro">{museum.intro}</p>
          {most !== undefined && most.rows.length > 0 ? (
            <ul className="cn-records">
              {most.rows.map((row) => (
                <HolderRow key={row.puuid} holder={row} />
              ))}
            </ul>
          ) : null}
          {museum.rows.length === 0 ? (
            <p className="cn-stats-empty">{museum.empty}</p>
          ) : (
            <ol className="cn-records">
              {museum.rows.map((row) => (
                <BloodRow key={row.gameId} row={row} />
              ))}
            </ol>
          )}
        </div>
      </section>
    </section>
  );
}

function Thieves({ records }: { records: FunRecord[] }) {
  if (records.length === 0) {
    return (
      <section className="cn-block">
        <section className="cn-card cn-list-card">
          <header className="cn-card-head cn-list-head">
            <h2 className="cn-board-title">{THIEF_TITLE}</h2>
          </header>
          <div className="cn-role-block">
            <p className="cn-stats-empty">{THIEF_EMPTY}</p>
          </div>
        </section>
      </section>
    );
  }
  return <Records heading={THIEF_TITLE} records={records} />;
}

function FearBans({ section }: { section: FunSection<FunFearBan> }) {
  return (
    <section className="cn-block">
      <section className="cn-card cn-list-card">
        <header className="cn-card-head cn-list-head">
          <h2 className="cn-board-title">{section.title}</h2>
        </header>
        <div className="cn-role-block">
          <p className="cn-stats-intro">{section.intro}</p>
          <p className="cn-award-rule">{FEAR_BAN_RULE}</p>
          {section.rows.length === 0 ? (
            <p className="cn-stats-empty">{section.empty}</p>
          ) : (
            <ul className="cn-records">
              {section.rows.map((row) => (
                <li key={row.player.puuid} className="cn-record cn-fun-holder">
                  <PlayerName player={row.player} />
                  <span className="cn-fun-stat">
                    <span className="cn-num cn-record-wl">{row.rate}%</span>
                    <span className="cn-fun-when cn-fun-fear">{row.line}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </section>
  );
}

function CsByRole({ pairs }: { pairs: RoleCsPair[] }) {
  return (
    <section className="cn-block">
      <section className="cn-card cn-list-card">
        <header className="cn-card-head cn-list-head">
          <h2 className="cn-board-title">{CS_HEADING}</h2>
        </header>
        {pairs.map((pair) => (
          <div key={pair.role} className="cn-role-block">
            <p className="cn-num cn-lineup-role">
              <RoleIcon role={pair.role} size={16} />
              {pair.role}
            </p>
            {pair.highest === null || pair.lowest === null ? (
              <p className="cn-stats-empty">{noCsAtRole(pair.role)}</p>
            ) : (
              <ul className="cn-records">
                <CsRow label={CS_HIGH_LABEL} holder={pair.highest} />
                <CsRow label={CS_LOW_LABEL} holder={pair.lowest} />
              </ul>
            )}
          </div>
        ))}
      </section>
    </section>
  );
}

function CsRow({ label, holder }: { label: string; holder: FunHolder }) {
  return <HolderRow holder={holder} label={label} />;
}

function Records({ heading, records }: { heading: string; records: FunRecord[] }) {
  return (
    <section className="cn-block">
      <section className="cn-card cn-list-card">
        <header className="cn-card-head cn-list-head">
          <h2 className="cn-board-title">{heading}</h2>
        </header>
        {records.map((block) => (
          <div key={block.id} className="cn-role-block">
            <p className="cn-stats-subtitle">{block.title}</p>
            {block.holders.length === 0 ? (
              <p className="cn-stats-empty">{block.empty}</p>
            ) : (
              <ul className="cn-records">
                {block.holders.map((holder) => (
                  <HolderRow key={holder.puuid} holder={holder} />
                ))}
              </ul>
            )}
            <p className="cn-award-rule">{block.rule}</p>
          </div>
        ))}
      </section>
    </section>
  );
}

function HolderRow({ holder, label }: { holder: FunHolder; label?: string }) {
  const row = (
    <>
      {label === undefined ? null : <span className="cn-stats-subtitle">{label}</span>}
      <PlayerName player={holder} />
      <span className="cn-fun-stat">
        <span className="cn-num cn-record-wl">{holder.valueLabel}</span>
        {holder.detail === null ? null : <span className="cn-fun-when">{holder.detail}</span>}
        {holder.game === null ? null : <span className="cn-fun-toggle">{THIS_GAME}</span>}
      </span>
    </>
  );

  if (holder.game === null) {
    return <li className={label === undefined ? 'cn-record cn-fun-holder' : 'cn-record cn-fun-cs'}>{row}</li>;
  }

  return (
    <li>
      <GameReveal
        game={holder.game}
        focusPuuid={holder.puuid}
        className={label === undefined ? 'cn-fun-holder' : 'cn-fun-cs'}
      >
        {row}
      </GameReveal>
    </li>
  );
}

function BloodRow({ row }: { row: FunBloodRow }) {
  const body = (
    <>
      <span className="cn-fun-blood">
        <PlayerName player={row.taker} />
        {row.victim === null ? null : (
          <span className="cn-fun-when">
            over <PlayerName player={row.victim} />
          </span>
        )}
      </span>
      <span className="cn-fun-stat">
        <span className="cn-num cn-record-wl">
          {row.champion}
          {row.opponent === null ? '' : ` vs ${row.opponent}`}
        </span>
        <span className="cn-fun-when">{row.when}</span>
        {row.game === null ? null : <span className="cn-fun-toggle">{THIS_GAME}</span>}
      </span>
    </>
  );

  if (row.game === null) {
    return <li className="cn-record cn-fun-holder">{body}</li>;
  }

  return (
    <li>
      <GameReveal game={row.game} focusPuuid={row.taker.puuid} className="cn-fun-holder">
        {body}
      </GameReveal>
    </li>
  );
}

function GameReveal({
  game,
  focusPuuid,
  className,
  children,
}: {
  game: HistoryGame;
  focusPuuid: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <details className="cn-fun-game">
      <summary className={`cn-record ${className}`}>{children}</summary>
      <div className="cn-fun-sheet">
        <p className="cn-fun-sheet-head">
          {game.result} · {game.score}
        </p>
        <MatchSheet game={game} focusPuuid={focusPuuid} />
      </div>
    </details>
  );
}

function PlayerName({ player }: { player: PlayerRef }) {
  return (
    <Link className="cn-stats-name" href={`/p/${player.puuid}`}>
      {renderWebName(player.name)}
    </Link>
  );
}
