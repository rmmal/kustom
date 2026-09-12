import Link from 'next/link';
import { WINDOW_LABELS, windowSlotLine } from '@/lib/board/copy';
import { capLine, playersLine } from '@/lib/stats/copy';
import {
  CS_HEADING,
  CS_HIGH_LABEL,
  CS_LOW_LABEL,
  FUN_LABEL,
  HABITS_HEADING,
  noCsAtRole,
  RECORDS_HEADING,
} from '@/lib/stats/funCopy';
import type { FunFactsView, FunHolder, FunRecord, FunTable, PlayerRef, RoleCsPair } from '@/lib/stats/types';
import { renderWebName } from '@/lib/tonight/copy';
import { WindowPicker } from '../_board/WindowPicker';
import { WindowSlot } from '../_board/WindowSlot';
import { RoleIcon } from '../_icons/RoleIcon';
import '../board-parts.css';

/**
 * `/fun` (M5.24): the window's single-game records, in the same shell `/stats` already wears.
 *
 * A pure function of one snapshot. The numbers live in `lib/stats/fun.ts`; this file decides
 * nothing except order: the notes about what we do not store, then CS by role, then one-game
 * records, then habits.
 */

export function FunView({ facts }: { facts: FunFactsView }) {
  const empty = facts.range === null;

  return (
    <main className="cn-page">
      <header className="cn-strip">
        <h1 className="cn-strip-title">
          {WINDOW_LABELS[facts.window]} <span className="cn-strip-sub">{FUN_LABEL}</span>
        </h1>
        <WindowPicker path="/fun" selected={facts.window} />
        <WindowSlot
          window={facts.window}
          line={empty ? null : windowSlotLine(facts.range as string, facts.games)}
        />
        {facts.capped ? <p className="cn-hint">{capLine(facts.cap)}</p> : null}
      </header>

      {empty ? null : (
        <>
          <p className="cn-stats-line">{playersLine(facts.players)}</p>
          {facts.notes.map((note) => (
            <p key={note} className="cn-hint">
              {note}
            </p>
          ))}
          {facts.tables.map((table) => (
            <Table key={table.id} table={table} />
          ))}
          <CsByRole pairs={facts.csByRole} />
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

function Table({ table }: { table: FunTable }) {
  return (
    <section className="cn-block">
      <section className="cn-card cn-list-card">
        <header className="cn-card-head cn-list-head">
          <h2 className="cn-board-title">{table.title}</h2>
        </header>
        <p className="cn-stats-intro">{table.intro}</p>
        {table.rows.length === 0 ? (
          <p className="cn-stats-empty">{table.empty}</p>
        ) : (
          <ol className="cn-records">
            {table.rows.map((row, index) => (
              <li key={row.puuid} className="cn-record cn-stats-record">
                <span className="cn-num cn-stats-rank">{index + 1}</span>
                <PlayerName player={row} />
                <span className="cn-num cn-record-wl">{row.valueLabel}</span>
              </li>
            ))}
          </ol>
        )}
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
  return (
    <li className="cn-record cn-stats-record">
      <span className="cn-stats-subtitle">{label}</span>
      <PlayerName player={holder} />
      <span className="cn-num cn-record-wl">{holder.valueLabel}</span>
    </li>
  );
}

function Records({ heading, records }: { heading: string; records: FunRecord[] }) {
  return (
    <section className="cn-block">
      <section className="cn-card cn-list-card">
        <header className="cn-card-head cn-list-head">
          <h2 className="cn-board-title">{heading}</h2>
        </header>
        {records.map((block) => (
          <div key={block.id} className="cn-award">
            <p className="cn-award-label">{block.title}</p>
            {block.holders.length === 0 ? (
              <p className="cn-award-line cn-award-none">{block.empty}</p>
            ) : (
              block.holders.map((holder) => (
                <p key={holder.puuid} className="cn-award-line">
                  <PlayerName player={holder} />
                  {` · ${holder.valueLabel}`}
                  {holder.detail === null ? null : ` · ${holder.detail}`}
                </p>
              ))
            )}
            <p className="cn-award-rule">{block.rule}</p>
          </div>
        ))}
      </section>
    </section>
  );
}

function PlayerName({ player }: { player: PlayerRef }) {
  return (
    <Link className="cn-stats-name" href={`/p/${player.puuid}`}>
      {renderWebName(player.name)}
    </Link>
  );
}
