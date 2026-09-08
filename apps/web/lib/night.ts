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
