/**
 * What "tonight" means (M2.5).
 *
 * A night runs **06:00 to 06:00** in the timezone named by `CUSTOMS_NIGHT_TZ`, not midnight
 * to midnight: the group plays late, and a midnight boundary would reset "games tonight"
 * while people are still in the lobby — which is exactly when the sit-out rotation is read.
 * 06:00 is an hour nobody is playing. Recorded in `04-decisions.md`.
 *
 * Pure: every function here takes the instant it is asked about. No `Date.now()`.
 */

/** Where the group is. Overridable per deployment with `CUSTOMS_NIGHT_TZ` (an IANA name). */
export const DEFAULT_NIGHT_TIME_ZONE = 'Africa/Cairo';

/** The local hour a night starts and the previous one ends. */
export const NIGHT_START_HOUR = 6;

interface CivilTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * The locale every date on a public page is formatted in, whatever the reader's browser says.
 *
 * Fixed on purpose (`05-design.md`, the status strip's slug): a date formatted in the visitor's
 * locale is formatted differently by the server than by the browser that re-renders it, and the
 * line changes under the reader. One locale, one timezone, one string, decided on the server.
 */
export const DISPLAY_LOCALE = 'en-GB';

const dayMonthFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * `9 Sep`: the short date a page puts beside a game (M3.5, `/p/[puuid]`'s recent games).
 *
 * The same locale and the same configured timezone the night's slug line uses, and the same
 * reason for both — `CUSTOMS_NIGHT_TZ` is where the group is, so a game that started at 01:00
 * their time is dated the day they played it and not the day UTC had.
 *
 * Built from parts rather than from `format()` because `en-GB`'s short month is **`Sept`** on
 * current ICU and three letters everywhere else, so a column of dates would have one four-letter
 * entry a year. Cutting to three gives `Sep` and leaves the other eleven untouched, and it is
 * stable across the ICU versions that disagree about September.
 *
 * This is the only date formatter in the app. Anything else that needs one takes different
 * `Intl` options from here rather than building a second `DateTimeFormat` somewhere else.
 */
export function formatDayMonth(instant: Date, timeZone: string = DEFAULT_NIGHT_TIME_ZONE): string {
  const cached = dayMonthFormatters.get(timeZone);
  const formatter =
    cached ?? new Intl.DateTimeFormat(DISPLAY_LOCALE, { timeZone, day: 'numeric', month: 'short' });
  if (cached === undefined) dayMonthFormatters.set(timeZone, formatter);

  const parts = formatter.formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${read('day')} ${read('month').slice(0, 3)}`;
}

const nightLabelFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * `Tuesday 9 September`: the tonight page's slug line (M3.18, `05-design.md`, "The status
 * strip"), rendered upper case by the stylesheet and left as a readable date in the DOM.
 *
 * Same locale and same configured timezone as every other date on a public page, and for the
 * same reason: this is formatted **on the server** and travels in the snapshot, because a date
 * the browser formatted in the reader's own locale would disagree with the server's render and
 * the line would change under them.
 *
 * It is given the night's start, not the current instant, so a game at 01:00 still says
 * Tuesday.
 */
export function formatNightLabel(
  nightStartInstant: Date,
  timeZone: string = DEFAULT_NIGHT_TIME_ZONE,
): string {
  const cached = nightLabelFormatters.get(timeZone);
  const formatter =
    cached ??
    new Intl.DateTimeFormat(DISPLAY_LOCALE, { timeZone, weekday: 'long', day: 'numeric', month: 'long' });
  if (cached === undefined) nightLabelFormatters.set(timeZone, formatter);
  return formatter.format(nightStartInstant);
}

/** Is this a timezone `Intl` knows? Used to validate `CUSTOMS_NIGHT_TZ` at the boundary. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    // `h23` and not `hour12: false`: the latter prints midnight as 24 in some runtimes.
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  formatters.set(timeZone, formatter);
  return formatter;
}

/** The wall-clock reading of `instant` in `timeZone`. */
function civilTimeIn(instant: Date, timeZone: string): CivilTime {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

/** Milliseconds to add to UTC to get local time at this instant (the zone's offset). */
function offsetMsAt(instant: Date, timeZone: string): number {
  const civil = civilTimeIn(instant, timeZone);
  const asIfUtc = Date.UTC(civil.year, civil.month - 1, civil.day, civil.hour, civil.minute, civil.second);
  // The formatter drops milliseconds, so round the instant to the second before subtracting.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant at which the clock in `timeZone` reads this wall-clock time.
 *
 * Two passes: the first guesses with the offset that applies at the same numbers read as
 * UTC, the second corrects it with the offset that actually applies there. That is what
 * makes the answer right on the two days a year the offset changes (Africa/Cairo has kept
 * DST since 2023).
 */
function instantOfCivilTime(civil: CivilTime, timeZone: string): Date {
  const asIfUtc = Date.UTC(civil.year, civil.month - 1, civil.day, civil.hour, civil.minute, civil.second);
  const firstGuess = asIfUtc - offsetMsAt(new Date(asIfUtc), timeZone);
  return new Date(asIfUtc - offsetMsAt(new Date(firstGuess), timeZone));
}

/**
 * The start of the night containing `now`: 06:00 local on the day it belongs to. Anything
 * before 06:00 belongs to the night that started the previous morning, so a session running
 * to 01:30 is still one night.
 */
export function nightStart(now: Date, timeZone: string = DEFAULT_NIGHT_TIME_ZONE): Date {
  const civil = civilTimeIn(now, timeZone);
  // Civil-date arithmetic through UTC so month and year ends carry correctly. This is a
  // calendar calculation, not an instant: the zone is applied afterwards.
  const civilDay = Date.UTC(civil.year, civil.month - 1, civil.day);
  const nightDay = new Date(civil.hour < NIGHT_START_HOUR ? civilDay - 24 * 60 * 60 * 1000 : civilDay);

  return instantOfCivilTime(
    {
      year: nightDay.getUTCFullYear(),
      month: nightDay.getUTCMonth() + 1,
      day: nightDay.getUTCDate(),
      hour: NIGHT_START_HOUR,
      minute: 0,
      second: 0,
    },
    timeZone,
  );
}

/**
 * The end of the night containing `now`: the 06:00 the next one starts at (M3.6).
 *
 * It is what `players.role_tonight_until` is set to, so "this lasts the night" is one stored
 * instant rather than a rule every reader has to re-derive.
 *
 * 26 hours past this night's 06:00 lands between 07:00 and 09:00 the next morning whatever DST
 * did in between — a shift is at most an hour either way — and the night containing *that*
 * instant starts at the 06:00 this one ends on. One definition of 06:00 local, used twice.
 */
export function nightEnd(now: Date, timeZone: string = DEFAULT_NIGHT_TIME_ZONE): Date {
  return nightStart(new Date(nightStart(now, timeZone).getTime() + 26 * 60 * 60 * 1000), timeZone);
}
