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
 * **The selected one is marked and is not a link**: a link to the page you are already on is
 * not a destination, and on two boards that otherwise look identical the marked option is the
 * only thing saying which one you are reading.
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
}

export function WindowPicker({ path, selected }: WindowPickerProps) {
  return (
    <nav className="cn-windows" aria-label={WINDOW_PICKER_LABEL}>
      {WINDOW_ORDER.map((kind) =>
        kind === selected ? (
          <span key={kind} className="cn-window cn-window-on" aria-current="true">
            {WINDOW_LABELS[kind]}
          </span>
        ) : (
          <Link key={kind} className="cn-window" href={windowHref(path, kind)}>
            {WINDOW_LABELS[kind]}
          </Link>
        ),
      )}
    </nav>
  );
}
