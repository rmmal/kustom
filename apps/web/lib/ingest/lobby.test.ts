import { describe, expect, it } from 'vitest';
import { isLobbyMember, isRosterFrozen } from './lobby';
import { isDisplayNameAutomatic } from './players';

/**
 * The pure parts of lobby ingest: who may report a lobby (M1.8), when its roster stops
 * moving (M2.9), and when a display name is still following the Riot ID (M1.7). No database
 * here — the database halves are in `companion.integration.test.ts` and
 * `players.integration.test.ts`.
 */

describe('isLobbyMember', () => {
  const members = [
    { puuid: 'a', isSpectator: false },
    { puuid: 'b', isSpectator: false },
    { puuid: 'watcher', isSpectator: true },
  ];

  it('is true for everyone in the list, spectators included', () => {
    expect(isLobbyMember(members, 'a')).toBe(true);
    expect(isLobbyMember(members, 'b')).toBe(true);
    // A friend who sits out a round and watches is in the lobby (M1.8 brief, M2.8).
    expect(isLobbyMember(members, 'watcher')).toBe(true);
  });

  it('is false for anyone else, with no prefix or substring matching', () => {
    expect(isLobbyMember(members, 'c')).toBe(false);
    expect(isLobbyMember(members, 'a-extra')).toBe(false);
    expect(isLobbyMember(members, '')).toBe(false);
  });

  it('is false for every caller when the list is empty', () => {
    // The "everyone left" report cannot prove membership by itself; the route falls back to
    // `reported_by_player_id`.
    expect(isLobbyMember([], 'a')).toBe(false);
  });
});

describe('isRosterFrozen', () => {
  it('is false while the lobby is still filling or being balanced', () => {
    expect(isRosterFrozen('open')).toBe(false);
    expect(isRosterFrozen('balanced')).toBe(false);
  });

  it('is true from in_game on', () => {
    expect(isRosterFrozen('in_game')).toBe(true);
    expect(isRosterFrozen('finished')).toBe(true);
  });

  it('leaves an abandoned lobby on the normal replace semantics', () => {
    // M2.9 brief: a lobby that dissolves without ever starting is not history worth keeping.
    expect(isRosterFrozen('abandoned')).toBe(false);
  });
});

describe('isDisplayNameAutomatic', () => {
  it('is true while the display name still equals the stored game name', () => {
    expect(isDisplayNameAutomatic({ game_name: 'Alice', display_name: 'Alice' })).toBe(true);
  });

  it('is true when there is no display name at all', () => {
    // Both the never-named row and the row an admin just cleared with "".
    expect(isDisplayNameAutomatic({ game_name: null, display_name: null })).toBe(true);
    expect(isDisplayNameAutomatic({ game_name: 'Alice', display_name: null })).toBe(true);
  });

  it('is false once someone has overridden it', () => {
    expect(isDisplayNameAutomatic({ game_name: 'Alice', display_name: 'Bob' })).toBe(false);
    expect(isDisplayNameAutomatic({ game_name: null, display_name: 'Bob' })).toBe(false);
  });
});
