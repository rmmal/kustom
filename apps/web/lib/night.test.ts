import { describe, expect, it } from 'vitest';
import {
  closedWindow,
  DEFAULT_NIGHT_TIME_ZONE,
  formatNightLabel,
  isInWindow,
  isValidTimeZone,
  monthStart,
  nightStart,
  weekStart,
  windowRange,
} from './night';

/**
 * "Tonight" runs 06:00 to 06:00 in `CUSTOMS_NIGHT_TZ` (M2.5). Every case here is a wall clock
 * a friend would recognise, converted by hand.
 */

const CAIRO = 'Africa/Cairo';

describe('nightStart', () => {
  it('is 06:00 local on the same day for an evening in the lobby', () => {
    // 2026-09-08 21:00 Cairo (UTC+3 in summer) is 18:00Z; the night began at 06:00 Cairo,
    // which is 03:00Z the same day.
    expect(nightStart(new Date('2026-09-08T18:00:00Z'), CAIRO).toISOString()).toBe(
      '2026-09-08T03:00:00.000Z',
    );
  });

  it('keeps a session that runs past midnight on the same night', () => {
    // 01:30 Cairo on the 9th belongs to the night that started 06:00 on the 8th.
    expect(nightStart(new Date('2026-09-08T22:30:00Z'), CAIRO).toISOString()).toBe(
      '2026-09-08T03:00:00.000Z',
    );
  });

  it('starts the next night at 06:00 exactly, not a second before', () => {
    // 05:59:59 Cairo on the 9th (02:59:59Z) is still the 8th's night.
    expect(nightStart(new Date('2026-09-09T02:59:59Z'), CAIRO).toISOString()).toBe(
      '2026-09-08T03:00:00.000Z',
    );
    // 06:00:00 Cairo on the 9th (03:00:00Z) is the new one.
    expect(nightStart(new Date('2026-09-09T03:00:00Z'), CAIRO).toISOString()).toBe(
      '2026-09-09T03:00:00.000Z',
    );
  });

  it('carries across a month and a year boundary', () => {
    expect(nightStart(new Date('2026-10-01T02:00:00Z'), CAIRO).toISOString()).toBe(
      '2026-09-30T03:00:00.000Z',
    );
    expect(nightStart(new Date('2027-01-01T02:00:00Z'), CAIRO).toISOString()).toBe(
      '2026-12-31T04:00:00.000Z',
    );
  });

  it('reads 06:00 local on both sides of a DST change', () => {
    // Cairo is UTC+2 in winter and UTC+3 in summer (DST is back since 2023).
    expect(nightStart(new Date('2026-01-15T20:00:00Z'), CAIRO).toISOString()).toBe(
      '2026-01-15T04:00:00.000Z',
    );
    expect(nightStart(new Date('2026-07-15T20:00:00Z'), CAIRO).toISOString()).toBe(
      '2026-07-15T03:00:00.000Z',
    );
  });

  it('works for a zone west of UTC, where the night starts on the next UTC day', () => {
    // 22:00 on the 8th in New York (EDT, UTC-4) is 02:00Z on the 9th; that night started at
    // 06:00 EDT on the 8th, which is 10:00Z on the 8th.
    expect(nightStart(new Date('2026-09-09T02:00:00Z'), 'America/New_York').toISOString()).toBe(
      '2026-09-08T10:00:00.000Z',
    );
  });

  it('defaults to where the group is', () => {
    expect(DEFAULT_NIGHT_TIME_ZONE).toBe('Africa/Cairo');
    expect(nightStart(new Date('2026-09-08T18:00:00Z')).toISOString()).toBe('2026-09-08T03:00:00.000Z');
  });
});

describe('formatNightLabel', () => {
  /** 06:00 in Africa/Cairo on Tuesday 8 September 2026, which is 03:00 UTC. */
  const nightOf8Sep = new Date('2026-09-08T03:00:00.000Z');

  it('is the night that started, in one fixed locale', () => {
    expect(formatNightLabel(nightOf8Sep)).toBe('Tuesday 8 September');
    expect(formatNightLabel(nightOf8Sep, CAIRO)).toBe('Tuesday 8 September');
  });

  it("reads the instant in the zone it is given, never the runner's", () => {
    // 03:00 UTC is still the 7th in New York, which is why the slug is formatted on the server
    // with the configured zone and carried through every re-read (M3.18).
    expect(formatNightLabel(nightOf8Sep, 'America/New_York')).toBe('Monday 7 September');
    expect(formatNightLabel(nightOf8Sep, 'UTC')).toBe('Tuesday 8 September');
  });

  it('says the night, not the clock: a 01:00 game still reads the day it started', () => {
    // 01:00 on Thursday in Cairo belongs to the night that started 06:00 on Wednesday.
    const late = new Date('2026-09-09T22:00:00.000Z');
    expect(formatNightLabel(nightStart(late, CAIRO), CAIRO)).toBe('Wednesday 9 September');
  });
});

describe('isValidTimeZone', () => {
  it('accepts IANA names and refuses anything else', () => {
    expect(isValidTimeZone('Africa/Cairo')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});

/**
 * The window boundaries (M5.9). Every instant below is written as a Cairo wall clock with its
 * UTC form beside it, converted by hand: Cairo is UTC+3 in summer and UTC+2 in winter.
 *
 * Nobody reads this file's output, which is exactly why it is tested this hard — `This week`
 * on the leaderboard and the Monday post in Discord are only ever as right as it is.
 */

/** The wall clock in Cairo, `YYYY-MM-DD HH:mm`, for asserting that a boundary reads 06:00. */
function wallClock(instant: Date, timeZone = CAIRO): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${read('weekday')} ${read('year')}-${read('month')}-${read('day')} ${read('hour')}:${read('minute')}`;
}

describe('the week a game belongs to', () => {
  it('gives a Monday 05:59 game to the week that is ending, and 06:01 to the new one', () => {
    // 2026-09-07 is a Monday. 05:59 Cairo (UTC+3) is 02:59Z; the week that is ending opened on
    // Monday 2026-08-31 at 06:00 Cairo, which is 03:00Z.
    expect(weekStart(new Date('2026-09-07T02:59:00Z'), CAIRO).toISOString()).toBe(
      '2026-08-31T03:00:00.000Z',
    );
    expect(weekStart(new Date('2026-09-07T03:01:00Z'), CAIRO).toISOString()).toBe(
      '2026-09-07T03:00:00.000Z',
    );
    // And 06:00 exactly is the new week, not a second before it.
    expect(weekStart(new Date('2026-09-07T03:00:00Z'), CAIRO).toISOString()).toBe(
      '2026-09-07T03:00:00.000Z',
    );
  });

  it('keeps a Sunday night and the 01:40 that follows it in the same week', () => {
    // Sunday 2026-09-06 23:30 Cairo = 20:30Z, and Monday 2026-09-07 01:40 Cairo = 22:40Z on
    // the 6th. One night, one week — the week that is ending.
    const sundayNight = weekStart(new Date('2026-09-06T20:30:00Z'), CAIRO);
    const afterMidnight = weekStart(new Date('2026-09-06T22:40:00Z'), CAIRO);

    expect(sundayNight.toISOString()).toBe('2026-08-31T03:00:00.000Z');
    expect(afterMidnight.getTime()).toBe(sundayNight.getTime());
  });

  it('opens every week on a Monday at 06:00 local', () => {
    for (const instant of [
      '2026-01-14T20:00:00Z',
      '2026-06-30T11:00:00Z',
      '2026-09-06T22:40:00Z',
      '2026-12-31T23:00:00Z',
    ]) {
      expect(wallClock(weekStart(new Date(instant), CAIRO))).toMatch(/^Mon .* 06:00$/);
    }
  });
});

describe('the month a game belongs to', () => {
  it('gives a 02:00 game on the 1st to the month that is ending, and 07:00 to the new one', () => {
    // 2026-09-01 02:00 Cairo = 2026-08-31T23:00Z. The month that is ending opened 2026-08-01
    // at 06:00 Cairo = 03:00Z.
    expect(monthStart(new Date('2026-08-31T23:00:00Z'), CAIRO).toISOString()).toBe(
      '2026-08-01T03:00:00.000Z',
    );
    expect(monthStart(new Date('2026-09-01T04:00:00Z'), CAIRO).toISOString()).toBe(
      '2026-09-01T03:00:00.000Z',
    );
  });

  it('starts and ends at 06:00 local through a 31-day month, a 30-day month and February', () => {
    for (const instant of [
      // January (31), April (30), February (28) and the leap February of 2028 (29).
      '2026-01-20T18:00:00Z',
      '2026-04-20T18:00:00Z',
      '2026-02-20T18:00:00Z',
      '2028-02-20T18:00:00Z',
    ]) {
      const range = windowRange('this-month', new Date(instant), CAIRO);
      expect(wallClock(range.start as Date)).toMatch(/-01 06:00$/);
      expect(wallClock(range.end as Date)).toMatch(/-01 06:00$/);
    }
  });
});

describe('windowRange', () => {
  /** Wednesday 2026-09-09, 21:00 Cairo (18:00Z): a normal night in the middle of a week. */
  const now = new Date('2026-09-09T18:00:00Z');

  it('ends this week and this month in the future, so a game tonight is inside them', () => {
    const week = windowRange('this-week', now, CAIRO);
    expect(week.start?.toISOString()).toBe('2026-09-07T03:00:00.000Z');
    expect(week.end?.toISOString()).toBe('2026-09-14T03:00:00.000Z');
    expect(isInWindow(now, week)).toBe(true);

    const month = windowRange('this-month', now, CAIRO);
    expect(month.start?.toISOString()).toBe('2026-09-01T03:00:00.000Z');
    expect(month.end?.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(isInWindow(now, month)).toBe(true);
  });

  it('puts last week directly against this week, with no gap and no overlap', () => {
    const last = windowRange('last-week', now, CAIRO);
    const current = windowRange('this-week', now, CAIRO);

    expect(last.end?.getTime()).toBe(current.start?.getTime());
    expect(last.start?.toISOString()).toBe('2026-08-31T03:00:00.000Z');
    // The boundary instant itself belongs to the new week: half-open, `[start, end)`.
    const boundary = current.start as Date;
    expect(isInWindow(boundary, last)).toBe(false);
    expect(isInWindow(boundary, current)).toBe(true);
    expect(isInWindow(new Date(boundary.getTime() - 1), last)).toBe(true);
  });

  it('puts last month directly against this month', () => {
    const last = windowRange('last-month', now, CAIRO);
    const current = windowRange('this-month', now, CAIRO);

    expect(last.end?.getTime()).toBe(current.start?.getTime());
    expect(last.start?.toISOString()).toBe('2026-08-01T03:00:00.000Z');
  });

  it('is nulls for all time, and takes every game there has ever been', () => {
    const all = windowRange('all-time', now, CAIRO);

    expect(all).toEqual({ start: null, end: null });
    expect(isInWindow(new Date('2019-04-02T19:00:00Z'), all)).toBe(true);
    expect(isInWindow(now, all)).toBe(true);
  });

  it('reads the zone it is given and never the environment', () => {
    // The zone is a parameter with `nightStart`'s own default; `nightTimeZone()` in
    // `lib/tonight/night.ts` is the one place `CUSTOMS_NIGHT_TZ` is read.
    process.env.CUSTOMS_NIGHT_TZ = 'America/New_York';
    try {
      expect(windowRange('this-week', now).start?.toISOString()).toBe(
        windowRange('this-week', now, DEFAULT_NIGHT_TIME_ZONE).start?.toISOString(),
      );
      expect(windowRange('this-week', now, 'America/New_York').start?.toISOString()).not.toBe(
        windowRange('this-week', now, CAIRO).start?.toISOString(),
      );
    } finally {
      delete process.env.CUSTOMS_NIGHT_TZ;
    }
  });
});

/**
 * Egypt observes DST, so a week can be 167 or 169 hours long. `nightStart` already resolves
 * that and this file adds nothing to it: what has to stay true is that every boundary reads
 * 06:00 on the local wall clock, the ranges stay adjacent, and no game is in two windows or in
 * none.
 */
describe('daylight saving', () => {
  // Cairo springs forward on Friday 2026-04-24 and back on Thursday 2026-10-29.
  const acrossSpring = ['2026-04-21T18:00:00Z', '2026-04-24T18:00:00Z', '2026-04-27T18:00:00Z'];
  const acrossAutumn = ['2026-10-26T18:00:00Z', '2026-10-29T18:00:00Z', '2026-11-02T18:00:00Z'];

  it('still opens every window at 06:00 local across both changes', () => {
    for (const instant of [...acrossSpring, ...acrossAutumn]) {
      const now = new Date(instant);
      for (const kind of ['this-week', 'last-week', 'this-month', 'last-month'] as const) {
        const range = windowRange(kind, now, CAIRO);
        expect(wallClock(range.start as Date)).toMatch(/ 06:00$/);
        expect(wallClock(range.end as Date)).toMatch(/ 06:00$/);
      }
    }
  });

  it('leaves the weeks adjacent, so a game is in exactly one of them', () => {
    for (const instant of [...acrossSpring, ...acrossAutumn]) {
      const now = new Date(instant);
      const last = windowRange('last-week', now, CAIRO);
      const current = windowRange('this-week', now, CAIRO);
      expect(last.end?.getTime()).toBe(current.start?.getTime());

      // Every hour of the fortnight lands in one window and only one.
      const from = (last.start as Date).getTime();
      const to = (current.end as Date).getTime();
      for (let at = from; at < to; at += 60 * 60 * 1000) {
        const game = new Date(at);
        const inside = [isInWindow(game, last), isInWindow(game, current)].filter(Boolean);
        expect(inside).toHaveLength(1);
      }
    }
  });

  it('makes a week that is not 168 hours, and says so rather than hiding it', () => {
    // The week containing the spring change is an hour short; the autumn one an hour long.
    const spring = windowRange('this-week', new Date('2026-04-24T18:00:00Z'), CAIRO);
    const hours = ((spring.end as Date).getTime() - (spring.start as Date).getTime()) / 3_600_000;

    expect(hours).toBe(167);
  });
});

describe('the window that just closed', () => {
  /** Monday 2026-10-05, 09:00 Cairo (06:00Z): the hour after the week and the month turned. */
  const mondayMorning = new Date('2026-10-05T06:00:00Z');

  it('is last week, its bounds, and the key its dedupe row is written under (M5.13)', () => {
    const week = closedWindow('last-week', mondayMorning, CAIRO);

    expect(week.kind).toBe('last-week');
    expect(week.start.toISOString()).toBe('2026-09-28T03:00:00.000Z');
    expect(week.end.toISOString()).toBe('2026-10-05T03:00:00.000Z');
    expect(week.key).toBe('2026-09-28T03:00:00.000Z');
    // The bounds are the same ones every page reads the window through.
    expect(week.start.getTime()).toBe(windowRange('last-week', mondayMorning, CAIRO).start?.getTime());
  });

  it('is the one month that just closed, never a backlog of them', () => {
    const month = closedWindow('last-month', mondayMorning, CAIRO);

    expect(month.start.toISOString()).toBe('2026-09-01T03:00:00.000Z');
    expect(month.end.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(month.key).toBe(month.start.toISOString());
  });

  it('does not move while the window it names stays closed', () => {
    // Called hourly all Monday and all Tuesday, it answers with the same key every time —
    // which is what makes an insert-then-post route post a week exactly once.
    const keys = new Set(
      [0, 3, 11, 26, 47].map(
        (hours) =>
          closedWindow('last-week', new Date(mondayMorning.getTime() + hours * 3_600_000), CAIRO).key,
      ),
    );

    expect([...keys]).toEqual(['2026-09-28T03:00:00.000Z']);
  });
});
