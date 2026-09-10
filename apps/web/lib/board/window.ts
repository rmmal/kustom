import { z } from 'zod';
import type { WindowKind } from '../night';

/**
 * The window a page is being read through (M5.12): the parameter, its order, and each page's
 * own default.
 *
 * **The parameter is the same word on all three pages** — `?window=this-week` on
 * `/leaderboard`, on `/p/[puuid]` and on `/stats` (M5.4) — so a link pasted from one lands on
 * the same window in another. The boundaries themselves are `lib/night.ts` (M5.9); this file
 * is the reading of a URL and nothing else, which is why it is pure and has no client.
 */

/**
 * The order the picker prints them in, and the order product wrote them in: the two weeks,
 * then the two months, then all time. Nearest window first, because the leaderboard opens on
 * `This week` and the tap most people make is one step away from it.
 */
export const WINDOW_ORDER = [
  'this-week',
  'last-week',
  'this-month',
  'last-month',
  'all-time',
] as const satisfies readonly WindowKind[];

/**
 * The parameter, as a schema — the same `zod` every other boundary in this app is validated
 * with (CLAUDE.md), rather than an `includes` and a cast. It is built from
 * {@link WINDOW_ORDER}, so the five words, the picker's order and what a URL may say are one
 * list and cannot drift.
 */
export const windowKindSchema = z.enum(WINDOW_ORDER);

/**
 * `/leaderboard` opens on the running week: the board is a thing that ends, and the page
 * somebody opens on the bus on Monday should be the week they are in.
 */
export const LEADERBOARD_WINDOW: WindowKind = 'this-week';

/**
 * `/p/[puuid]` opens on `All time`: the page is a person's history, and a page that opened on
 * six days of games would answer a question nobody asked it (M5.12, M5.15).
 */
export const PLAYER_WINDOW: WindowKind = 'all-time';

/**
 * `/stats` opens on `This month` (M5.4): every minimum on that page is five games or more, and
 * a five-game minimum against a five-game week prints nothing but "not enough yet". One tap
 * gets to the week.
 */
export const STATS_WINDOW: WindowKind = 'this-month';

/**
 * The `?window=` value, or `null` for anything that is not one of the five.
 *
 * Absent is the page's own default; **an unknown value is a 404** and never a silent fallback,
 * because it can only come from a typed or mangled URL and a page that quietly showed a
 * different window than the URL names is a page whose links cannot be trusted. The page owns
 * the `notFound()`; this returns the honest answer.
 *
 * Next hands a repeated parameter over as an array (`?window=a&window=b`). That is not one of
 * the five either, so it is refused rather than reduced to its first element.
 */
export function parseWindow(value: string | string[] | undefined, fallback: WindowKind): WindowKind | null {
  if (value === undefined) return fallback;
  // A repeated parameter arrives as an array; `z.enum` refuses it, like anything else that is
  // not one of the five, so it is a 404 rather than a silent first-element read.
  const parsed = windowKindSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * The link behind one option: `/leaderboard?window=last-week`, `/p/<puuid>?window=all-time`.
 *
 * **Every option names its window, including the page's default.** A parameterless link would
 * be one character shorter and would give the page two URLs for one board — the one somebody
 * copies out of the address bar after tapping `This week` has to say which board they are
 * looking at, because that is the link they paste into the group chat.
 */
export function windowHref(path: string, kind: WindowKind): string {
  return `${path}?window=${kind}`;
}
