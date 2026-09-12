import Link from 'next/link';
import { WINDOW_LABELS, WINDOW_PICKER_LABEL } from '@/lib/board/copy';
import { WINDOW_ORDER, windowHref } from '@/lib/board/window';
import type { WindowKind } from '@/lib/night';

/**
 * The window picker (M5.12): `This week` · `Last week` · `This month` · `Last month` ·
 * `All time`, in the page header of `/leaderboard`, `/p/[puuid]` and — with M5.4 — `/stats`.
 *
 * **Five links and no state.** Each option is a plain `href` to `?window=…`, so the control
 * works with JavaScript off, survives a refresh, and can be copied out of the address bar into
 * the group chat. `next/link` makes the tap an in-place render rather than a document load —
 * the server renders the new board and swaps it in — which is the same "nothing on this page
 * reloads under you" rule the tonight page's controls follow, without inventing a fetch or a
 * client component to get it.
 *
 * **All five are links and the selected one carries `aria-current="page"`** (the designer,
 * 2026-09-10). Product's brief said the selected option should not be a link at all; a marked
 * link is the same promise kept better — `aria-current` is what a screen reader announces as
 * "current page", the chip keeps its 44px target so a mis-tap on the option you are already on
 * does nothing instead of hitting the one beside it, and the five stay one row of one shape
 * rather than four controls and a label. On two boards that otherwise look identical, the
 * marked chip is the only thing saying which one you are reading.
 *
 * The label of an option, the heading of the board and the title of the Discord post are the
 * same five words from `lib/board/copy.ts` — one map, so a picker cannot say `Week` over a
 * heading that says `This week`.
 *
 * **Layout is provisional (M5.8).** `05-design.md` has no picker spec yet, so this is the
 * role-chip recipe from the tonight page — a row of 44px mono chips that wraps to 3 + 2 on a
 * phone, the chosen one in `brand`. The designer's pass may replace the CSS entirely without
 * touching this file's structure.
 */

export interface WindowPickerProps {
  /** The page the options link to: `/leaderboard`, `/p/<puuid>`. Never carries a query. */
  path: string;
  selected: WindowKind;
  /** Extra query kept across window taps — `/games?p=` and `/games?queue=` so a list stays theirs. */
  query?: Record<string, string>;
}

export function WindowPicker({ path, selected, query }: WindowPickerProps) {
  return (
    <nav className="cn-windows" aria-label={WINDOW_PICKER_LABEL}>
      {WINDOW_ORDER.map((kind) => (
        <Link
          key={kind}
          className={kind === selected ? 'cn-window cn-window-on' : 'cn-window'}
          href={windowHref(path, kind, query)}
          {...(kind === selected ? { 'aria-current': 'page' as const } : {})}
        >
          {WINDOW_LABELS[kind]}
        </Link>
      ))}
    </nav>
  );
}
