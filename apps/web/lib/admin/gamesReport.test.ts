import { describe, expect, it } from 'vitest';
import {
  CAPTURED_CAP,
  formatClock,
  formatDuration,
  formatNightOf,
  GAMES_COPY,
  MISSED_CAP,
  MISSED_LOBBY_STATUSES,
  shortPartyId,
} from './games';

/**
 * The pure half of the missed-game report (M5.5): the strings the page prints and the two
 * statuses the `Missed` list is made of.
 */

const CAIRO = 'Africa/Cairo';

describe('MISSED_LOBBY_STATUSES', () => {
  it('is both halves of "a game started and no result came back"', () => {
    // `in_game` may still be being played; `dropped` is one the sweep gave up on (M5.11).
    // One constant, so no query anywhere lists only half of them.
    expect([...MISSED_LOBBY_STATUSES]).toEqual(['in_game', 'dropped']);
  });

  it('keeps the brief’s caps', () => {
    expect(MISSED_CAP).toBe(100);
    expect(CAPTURED_CAP).toBe(200);
  });
});

describe("product's copy, byte for byte (brief, 2026-09-09)", () => {
  it('is the words in the brief and no others', () => {
    expect(GAMES_COPY).toEqual({
      heading: 'Games',
      missed: 'Missed',
      missedIntro:
        "These lobbies started a game and no result ever arrived. Somebody's companion was closed at the final whistle. Backfill usually picks the game up the next day and the row disappears on its own.",
      missedEmpty: 'Nothing missing. Every game that started has a result.',
      captured: 'Captured',
      capturedIntro:
        'The last 200 games the server has. Backfilled games are rated by pnpm --filter web rebuild-ratings, not on arrival.',
      capturedEmpty: 'No games yet.',
      lobbyNeverClosed:
        'A result arrived for this game but the lobby never moved to finished. The rating is fine; the lobby row is stuck.',
    });
  });
});

describe('formatNightOf', () => {
  it('is `Tue 9 Sep`', () => {
    // 21:30 Cairo on Tuesday 8 September 2026 — inside the night that started that morning.
    expect(formatNightOf(new Date('2026-09-08T18:30:00Z'), CAIRO)).toBe('Tue 8 Sep');
  });

  it('dates a game played after midnight to the night it belongs to', () => {
    // 01:20 Cairo on Wednesday is still Tuesday's night: 06:00 to 06:00 (M2.5).
    expect(formatNightOf(new Date('2026-09-08T22:20:00Z'), CAIRO)).toBe('Tue 8 Sep');
    // …and 07:00 Cairo on Wednesday is a new one.
    expect(formatNightOf(new Date('2026-09-09T04:00:00Z'), CAIRO)).toBe('Wed 9 Sep');
  });

  it('cuts the four-letter September en-GB ICU prints', () => {
    expect(formatNightOf(new Date('2026-09-08T18:30:00Z'), CAIRO)).not.toContain('Sept');
  });
});

describe('formatClock', () => {
  it('is a 24-hour clock in the night’s own zone', () => {
    expect(formatClock(new Date('2026-09-08T18:30:00Z'), CAIRO)).toBe('21:30');
    // Midnight is 00, never 24.
    expect(formatClock(new Date('2026-09-08T21:00:00Z'), CAIRO)).toBe('00:00');
  });
});

describe('formatDuration', () => {
  it('is m:ss', () => {
    expect(formatDuration(2_052)).toBe('34:12');
    expect(formatDuration(200)).toBe('3:20');
    expect(formatDuration(42)).toBe('0:42');
    expect(formatDuration(0)).toBe('0:00');
  });
});

describe('shortPartyId', () => {
  it('is the first eight characters, and leaves a short one alone', () => {
    expect(shortPartyId('e3c69392-1a2b-4c3d-8e9f-000000000000')).toBe('e3c69392');
    expect(shortPartyId('abc')).toBe('abc');
  });
});
