import { describe, expect, it } from 'vitest';
import { config } from '../config';
import type { Role } from '../types';
import { type InferredRoles, inferRoles, type RoleGame } from './infer';

const DAY = 86_400_000;
/** 2025-09-10T20:00:00Z. An arbitrary fixed anchor; never `Date.now()`. */
const T0 = 1_757_534_400_000;

/** One game row as M5.17 hands them over. `startedAt` is epoch millis unless a test says otherwise. */
function g(role: Role | null, startedAt: string | number, countsForInference = true): RoleGame {
  return { role, startedAt, countsForInference };
}

/** `n` games of one role, most recent first, starting at `from` and stepping one day back. */
function run(role: Role | null, n: number, from: number, countsForInference = true): RoleGame[] {
  return Array.from({ length: n }, (_, i) => g(role, from - i * DAY, countsForInference));
}

describe('config.roles', () => {
  it('pins the window and the threshold from the M5.16 brief', () => {
    expect(config.roles).toEqual({ inferenceWindow: 20, minGames: 3 });
  });
});

describe('inferRoles', () => {
  it('(1) twelve support and five jungle games give support / jungle', () => {
    const games = [...run('support', 12, T0), ...run('jungle', 5, T0 - 12 * DAY)];
    const out: InferredRoles = inferRoles(games);
    expect(out).toEqual({ main: 'support', secondary: 'jungle', counted: 17 });
  });

  it('(2) a 5-5 tie goes to the role whose most recent game is later, under both insert orders', () => {
    // Jungle's newest game is the newest of all; support's newest is a day older than jungle's oldest.
    const jungle = run('jungle', 5, T0);
    const support = run('support', 5, T0 - 6 * DAY);
    expect(inferRoles([...jungle, ...support])).toEqual({
      main: 'jungle',
      secondary: 'support',
      counted: 10,
    });
    expect(inferRoles([...support, ...jungle])).toEqual({
      main: 'jungle',
      secondary: 'support',
      counted: 10,
    });
    // The mirror: make support the more recent and the answer flips.
    const supportNewer = run('support', 5, T0 + DAY);
    expect(inferRoles([...jungle, ...supportNewer])).toEqual({
      main: 'support',
      secondary: 'jungle',
      counted: 10,
    });
  });

  it('(2b) a tie among more roles ranks every tied role by recency, so the backup is the second most recent', () => {
    // 4 top, 4 mid, 3 adc, with mid's newest game later than top's.
    const games = [
      g('mid', T0),
      g('top', T0 - 1 * DAY),
      ...run('adc', 3, T0 - 2 * DAY),
      ...run('top', 3, T0 - 5 * DAY),
      ...run('mid', 3, T0 - 8 * DAY),
    ];
    expect(inferRoles(games)).toEqual({ main: 'mid', secondary: 'top', counted: 11 });
  });

  it('(3) two counted games are flexible with the count reported; the third flips it', () => {
    expect(inferRoles(run('adc', 2, T0))).toEqual({ main: null, secondary: null, counted: 2 });
    expect(inferRoles(run('adc', 3, T0))).toEqual({ main: 'adc', secondary: null, counted: 3 });
  });

  it('(3b) the threshold counts only games that count: two counted plus ten filled stays flexible', () => {
    const games = [...run('adc', 2, T0), ...run('jungle', 10, T0 - 2 * DAY, false)];
    expect(inferRoles(games)).toEqual({ main: null, secondary: null, counted: 2 });
  });

  it('(4) only the last 20 counted games count: 15 mid then 15 jungle comes out jungle first', () => {
    // Most recent first: the 15 jungle games are newer than the 15 mid games.
    const games = [...run('jungle', 15, T0), ...run('mid', 15, T0 - 15 * DAY)];
    expect(inferRoles(games)).toEqual({ main: 'jungle', secondary: 'mid', counted: 20 });
  });

  it('(4b) the 21st game is ignored entirely', () => {
    expect(inferRoles([...run('top', 20, T0), g('mid', T0 - 20 * DAY)])).toEqual({
      main: 'top',
      secondary: null,
      counted: 20,
    });
    // Drop one top game and the mid game slides into the window as the backup.
    expect(inferRoles([...run('top', 19, T0), g('mid', T0 - 19 * DAY)])).toEqual({
      main: 'top',
      secondary: 'mid',
      counted: 20,
    });
  });

  it('(5) a game that does not count changes no count: a support filled into jungle five times stays a support', () => {
    const games = [...run('jungle', 5, T0, false), ...run('support', 5, T0 - 5 * DAY)];
    expect(inferRoles(games)).toEqual({ main: 'support', secondary: null, counted: 5 });
  });

  it('(5b) a game that does not count does not consume a window slot either', () => {
    // 20 counted support games with 20 filled jungle games interleaved: all 20 support games are seen.
    const games: RoleGame[] = [];
    for (let i = 0; i < 20; i++) {
      games.push(g('jungle', T0 - 2 * i * DAY, false), g('support', T0 - (2 * i + 1) * DAY));
    }
    expect(inferRoles(games)).toEqual({ main: 'support', secondary: null, counted: 20 });
  });

  it('(6) null roles are skipped and do not consume a window slot', () => {
    const games: RoleGame[] = [];
    for (let i = 0; i < 20; i++) {
      games.push(g(null, T0 - 2 * i * DAY), g('adc', T0 - (2 * i + 1) * DAY));
    }
    games.push(g('mid', T0 - 40 * DAY)); // the 21st counted game, outside the window
    expect(inferRoles(games)).toEqual({ main: 'adc', secondary: null, counted: 20 });
    // Nulls alone are nothing.
    expect(inferRoles(run(null, 10, T0))).toEqual({ main: null, secondary: null, counted: 0 });
  });

  it('(7) one role only gives a main and a null secondary; a second role is never invented', () => {
    expect(inferRoles(run('top', 20, T0))).toEqual({ main: 'top', secondary: null, counted: 20 });
  });

  it('(8) is total: an empty list is flexible with zero counted', () => {
    expect(inferRoles([])).toEqual({ main: null, secondary: null, counted: 0 });
  });

  it('is deterministic: equal input gives equal output, and the input is not mutated', () => {
    const games = [
      ...run('support', 6, T0),
      ...run('jungle', 6, T0 - 6 * DAY),
      ...run('mid', 4, T0 - 12 * DAY),
    ];
    const snapshot = JSON.stringify(games);
    const a = inferRoles(games);
    const b = inferRoles(games);
    expect(a).toEqual(b);
    expect(a).toEqual({ main: 'support', secondary: 'jungle', counted: 16 });
    expect(JSON.stringify(games)).toBe(snapshot);
  });

  it('orders by startedAt itself, so a caller that hands the list oldest-first gets the same answer', () => {
    const games = [...run('jungle', 5, T0), ...run('support', 5, T0 - 5 * DAY)];
    const reversed = [...games].reverse();
    expect(inferRoles(reversed)).toEqual(inferRoles(games));
    expect(inferRoles(reversed)).toEqual({ main: 'jungle', secondary: 'support', counted: 10 });
    // The window is the newest 20 by startedAt, not the first 20 in the list.
    const thirty = [...run('mid', 15, T0 - 15 * DAY), ...run('jungle', 15, T0)];
    expect(inferRoles(thirty)).toEqual({ main: 'jungle', secondary: 'mid', counted: 20 });
  });

  it('accepts ISO-8601 strings for startedAt, as the database hands them over, and mixes them with numbers', () => {
    const iso = (ms: number) => new Date(ms).toISOString();
    const games = [
      g('jungle', iso(T0)),
      g('support', iso(T0 - DAY)),
      g('jungle', iso(T0 - 2 * DAY)),
      g('support', iso(T0 - 3 * DAY)),
    ];
    expect(inferRoles(games)).toEqual({ main: 'jungle', secondary: 'support', counted: 4 });
    // The Postgres `+00:00` spelling parses the same as `Z`.
    const pg = games.map((x) => g(x.role, String(x.startedAt).replace('Z', '+00:00')));
    expect(inferRoles(pg)).toEqual({ main: 'jungle', secondary: 'support', counted: 4 });
    // A number and a string for the same instant are the same instant.
    const mixed = [
      g('jungle', T0),
      g('support', iso(T0 - DAY)),
      g('jungle', iso(T0 - 2 * DAY)),
      g('support', T0 - 3 * DAY),
    ];
    expect(inferRoles(mixed)).toEqual({ main: 'jungle', secondary: 'support', counted: 4 });
  });

  it('breaks a tie whose newest games share a timestamp by lane order, never by insert order', () => {
    // Cannot happen for one player in practice (one game at a time); pinned so the answer is never the list order.
    const a = [g('support', T0), g('top', T0), g('support', T0 - DAY), g('top', T0 - DAY)];
    const b = [g('top', T0), g('support', T0), g('top', T0 - DAY), g('support', T0 - DAY)];
    expect(inferRoles(a)).toEqual({ main: 'top', secondary: 'support', counted: 4 });
    expect(inferRoles(b)).toEqual(inferRoles(a));
  });

  it('takes an explicit window, and a window that cannot hold the threshold is flexible', () => {
    const games = [...run('jungle', 3, T0), ...run('support', 5, T0 - 3 * DAY)];
    expect(inferRoles(games)).toEqual({ main: 'support', secondary: 'jungle', counted: 8 });
    expect(inferRoles(games, 4)).toEqual({ main: 'jungle', secondary: 'support', counted: 4 });
    expect(inferRoles(games, 2)).toEqual({ main: null, secondary: null, counted: 2 });
    expect(inferRoles(games, 0)).toEqual({ main: null, secondary: null, counted: 0 });
  });
});
