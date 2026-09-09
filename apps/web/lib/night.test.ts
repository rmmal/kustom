import { describe, expect, it } from 'vitest';
import { DEFAULT_NIGHT_TIME_ZONE, formatNightLabel, isValidTimeZone, nightStart } from './night';

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

  it('reads the instant in the zone it is given, never the runner’s', () => {
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
