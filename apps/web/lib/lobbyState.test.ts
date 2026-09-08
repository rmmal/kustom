import type { LobbyStatusValue } from '@customs/db';
import { describe, expect, it } from 'vitest';
import {
  assertLegalTransition,
  IDLE_ABANDON_MS,
  IllegalLobbyTransitionError,
  isLegalTransition,
  isRosterStable,
  isTerminalLobbyStatus,
  LOBBY_TRANSITIONS,
  MIN_RATED_DURATION_S,
  MIN_RECHECK_MS,
  ROSTER_STABLE_MS,
  recheckInMs,
} from './lobbyState';

/**
 * The state machine's table and its two derived numbers. No database: the compare-and-set
 * halves are exercised in `companion.integration.test.ts`.
 */

const STATUSES: LobbyStatusValue[] = ['open', 'balanced', 'in_game', 'finished', 'abandoned'];

describe('the transition table', () => {
  it('is the table in the M2.5 brief, and nothing else', () => {
    expect(LOBBY_TRANSITIONS).toEqual({
      open: ['open', 'balanced', 'in_game', 'finished', 'abandoned'],
      balanced: ['open', 'balanced', 'in_game', 'finished', 'abandoned'],
      in_game: ['finished'],
      finished: [],
      abandoned: [],
    });
  });

  it('lets a full lobby balance and a balanced one come apart again', () => {
    expect(isLegalTransition('open', 'balanced')).toBe(true);
    expect(isLegalTransition('balanced', 'open')).toBe(true);
  });

  it('only lets an in_game lobby finish: it never ages out and never reopens', () => {
    // `abandoned` keeps the M2.9 replace semantics, so sweeping an `in_game` lobby would
    // unfreeze the record of who played. M5.5 lists the ones whose game never landed.
    expect(isLegalTransition('in_game', 'finished')).toBe(true);
    for (const to of ['open', 'balanced', 'abandoned', 'in_game'] as LobbyStatusValue[]) {
      expect(isLegalTransition('in_game', to)).toBe(false);
    }
  });

  it.each([['finished'], ['abandoned']] as [LobbyStatusValue][])('makes %s terminal', (from) => {
    for (const to of STATUSES) {
      expect(isLegalTransition(from, to)).toBe(false);
    }
  });

  it('knows which statuses are terminal, which is what the game route warns about', () => {
    expect(isTerminalLobbyStatus('finished')).toBe(true);
    expect(isTerminalLobbyStatus('abandoned')).toBe(true);
    for (const status of ['open', 'balanced', 'in_game'] as LobbyStatusValue[]) {
      expect(isTerminalLobbyStatus(status)).toBe(false);
    }
  });

  it('throws for an illegal move rather than silently succeeding', () => {
    expect(() => assertLegalTransition('finished', 'open')).toThrow(IllegalLobbyTransitionError);
    expect(() => assertLegalTransition('finished', 'open')).toThrow('lobby cannot go from finished to open');
    expect(() => assertLegalTransition('open', 'balanced')).not.toThrow();
  });
});

describe('the three numbers', () => {
  it('are ten seconds, two hours and five minutes', () => {
    expect(ROSTER_STABLE_MS).toBe(10_000);
    expect(IDLE_ABANDON_MS).toBe(2 * 60 * 60 * 1000);
    expect(MIN_RATED_DURATION_S).toBe(300);
  });
});

describe('isRosterStable', () => {
  it('is the ten-second mark exactly, not a millisecond later', () => {
    expect(isRosterStable(9_999)).toBe(false);
    expect(isRosterStable(10_000)).toBe(true);
  });
});

describe('recheckInMs', () => {
  const ten = { status: 'open' as LobbyStatusValue, around: 10, rosterChanged: false };

  it('is the full window when this post changed the roster', () => {
    expect(recheckInMs({ ...ten, elapsedMs: 12, rosterChanged: true })).toBe(ROSTER_STABLE_MS);
  });

  it('counts down on an unchanged repost', () => {
    expect(recheckInMs({ ...ten, elapsedMs: 3_000 })).toBe(7_000);
  });

  it('never asks for a knock sooner than a second', () => {
    expect(recheckInMs({ ...ten, elapsedMs: 9_800 })).toBe(MIN_RECHECK_MS);
    // Past the window and still open: the balance failed, so keep knocking.
    expect(recheckInMs({ ...ten, elapsedMs: 60_000 })).toBe(MIN_RECHECK_MS);
  });

  it('is null with fewer than ten around, however long they have sat there', () => {
    expect(recheckInMs({ ...ten, around: 9, elapsedMs: 30_000 })).toBeNull();
  });

  it('is null once the lobby is balanced or beyond', () => {
    for (const status of ['balanced', 'in_game', 'finished', 'abandoned'] as LobbyStatusValue[]) {
      expect(recheckInMs({ ...ten, status, elapsedMs: 30_000 })).toBeNull();
    }
  });

  it('counts a spectator as one of the people who are here', () => {
    // "Around" is every member, spectators included: nine on teams plus one watching is ten.
    expect(recheckInMs({ ...ten, around: 10, elapsedMs: 0, rosterChanged: true })).toBe(ROSTER_STABLE_MS);
  });
});
