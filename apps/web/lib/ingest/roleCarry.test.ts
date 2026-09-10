import { describe, expect, it } from 'vitest';
import { nightEnd, nightStart } from '../night';

/**
 * How long a role for tonight lasts (M3.6, decisions 2026-09-09 and 2026-09-10): the night,
 * and it lives on the player.
 *
 * The carry itself is now two queries with no rule left in TypeScript — "the rows this post
 * created" and "`players.role_tonight` while `role_tonight_until` is in the future" — so it is
 * exercised end to end in `roleCarry.integration.test.ts` against the local stack, where the
 * expiry is compared by Postgres exactly as it is in production. What is left here is the
 * boundary that decides it: when a night ends.
 */

const TIME_ZONE = 'Africa/Cairo';

describe('the night a preference belongs to', () => {
  it('ends at the 06:00 that starts the next one', () => {
    const evening = new Date('2026-09-08T20:30:00.000Z'); // 23:30 in Cairo
    const end = nightEnd(evening, TIME_ZONE);

    expect(end.toISOString()).toBe('2026-09-09T03:00:00.000Z'); // 06:00 Cairo, next morning
    expect(end.getTime()).toBe(nightStart(new Date(end.getTime() + 1_000), TIME_ZONE).getTime());
  });

  it('is the same instant for a 01:00 game as for the evening before it', () => {
    // A session running to 01:30 is one night (`lib/night.ts`), so a tap at either end of it
    // expires at the same 06:00 and nobody re-taps at midnight.
    const evening = new Date('2026-09-08T20:30:00.000Z');
    const afterMidnight = new Date('2026-09-08T23:10:00.000Z'); // 02:10 in Cairo

    expect(nightEnd(afterMidnight, TIME_ZONE).getTime()).toBe(nightEnd(evening, TIME_ZONE).getTime());
  });

  it('is always in the future of the night it belongs to, and 24 hours after its start', () => {
    const now = new Date('2026-09-08T20:30:00.000Z');

    expect(nightEnd(now, TIME_ZONE).getTime()).toBeGreaterThan(now.getTime());
    // Cairo has had no DST since 2023, so this night is exactly 24 hours long; the 26-hour
    // probe inside `nightEnd` is what keeps that true in a zone that still shifts.
    expect(nightEnd(now, TIME_ZONE).getTime() - nightStart(now, TIME_ZONE).getTime()).toBe(
      24 * 60 * 60 * 1000,
    );
  });

  it('lands on 06:00 local through a DST shift, not 05:00 or 07:00', () => {
    // Europe/Berlin springs forward at 02:00 on 2026-03-29, inside the night of the 28th.
    const berlinNight = new Date('2026-03-28T21:00:00.000Z');
    const end = nightEnd(berlinNight, 'Europe/Berlin');

    expect(
      new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Europe/Berlin',
      }).format(end),
    ).toBe('06:00');
    // Twenty-three hours, because the night lost one to the clock going forward.
    expect(end.getTime() - nightStart(berlinNight, 'Europe/Berlin').getTime()).toBe(23 * 60 * 60 * 1000);
  });
});
