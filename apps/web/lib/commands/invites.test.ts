import { describe, expect, it } from 'vitest';
import { nightStart } from '../night';
import { type AroundPlayer, chooseInvitees, MAX_INVITES, nightsAgo, nightWindow } from './invites';

/**
 * The around set as a pure function (M4.2): who is invited, in what order, and where the cap
 * falls. The two clauses' *queries* are the integration test's; this is the rule they feed.
 */

const NIGHT = new Date('2019-06-09T20:00:00.000Z');

function at(minutesAgo: number): Date {
  return new Date(NIGHT.getTime() - minutesAgo * 60_000);
}

function candidate(playerId: string, minutesAgo: number): AroundPlayer {
  return { playerId, lastActiveAt: at(minutesAgo) };
}

describe('chooseInvitees', () => {
  it('orders most recently active first', () => {
    const chosen = chooseInvitees({
      candidates: [candidate('c', 50), candidate('a', 2), candidate('b', 20)],
      hostPlayerId: 'host',
    });

    expect(chosen).toEqual({ playerIds: ['a', 'b', 'c'], trimmed: 0 });
  });

  it('keeps one row per player, at their freshest evidence', () => {
    // Clause (a) and clause (b) both name the same friend: a token seen two minutes ago and a
    // game six nights back. They get one invite, and they sort by the token.
    const chosen = chooseInvitees({
      candidates: [candidate('a', 6 * 24 * 60), candidate('b', 30), candidate('a', 2)],
      hostPlayerId: 'host',
    });

    expect(chosen.playerIds).toEqual(['a', 'b']);
  });

  it('never invites the host to their own lobby', () => {
    const chosen = chooseInvitees({
      candidates: [candidate('host', 1), candidate('a', 5)],
      hostPlayerId: 'host',
    });

    expect(chosen.playerIds).toEqual(['a']);
  });

  it('never invites somebody already in the lobby', () => {
    const chosen = chooseInvitees({
      candidates: [candidate('a', 1), candidate('b', 2), candidate('c', 3)],
      hostPlayerId: 'host',
      excludePlayerIds: ['b'],
    });

    expect(chosen.playerIds).toEqual(['a', 'c']);
  });

  it('trims a twenty-five-player group to nineteen, and says how many it dropped', () => {
    const candidates = Array.from({ length: 25 }, (_, index) =>
      // The lower the index, the more recently active.
      candidate(`p${String(index).padStart(2, '0')}`, index + 1),
    );

    const chosen = chooseInvitees({ candidates, hostPlayerId: 'host' });

    expect(chosen.playerIds).toHaveLength(MAX_INVITES);
    expect(chosen.trimmed).toBe(6);
    expect(chosen.playerIds[0]).toBe('p00');
    expect(chosen.playerIds.at(-1)).toBe('p18');
  });

  it('is stable: the same night queues the same rows in the same order', () => {
    const candidates = [candidate('b', 10), candidate('a', 10), candidate('c', 1)];

    const first = chooseInvitees({ candidates, hostPlayerId: 'host' });
    const second = chooseInvitees({ candidates: [...candidates].reverse(), hostPlayerId: 'host' });

    expect(first.playerIds).toEqual(['c', 'a', 'b']);
    expect(second.playerIds).toEqual(first.playerIds);
  });

  it('drops a row whose timestamp is not a date rather than sorting it to the top', () => {
    const chosen = chooseInvitees({
      candidates: [{ playerId: 'broken', lastActiveAt: new Date('not a date') }, candidate('a', 5)],
      hostPlayerId: 'host',
    });

    expect(chosen.playerIds).toEqual(['a']);
  });
});

describe('the night window', () => {
  it('is the night containing `now`, up to `now` itself', () => {
    const window = nightWindow(NIGHT);

    expect(window.start).toBe(nightStart(NIGHT).toISOString());
    expect(window.until).toBe(NIGHT.toISOString());
    // 06:00 in Africa/Cairo, which is 04:00Z with no DST in 2019.
    expect(window.start).toBe('2019-06-09T04:00:00.000Z');
  });

  it('counts seven nights back to the 06:00 boundary, so six nights ago is in and eight is out', () => {
    const since = nightsAgo(NIGHT, 7);

    expect(since.toISOString()).toBe('2019-06-03T04:00:00.000Z');
    expect(new Date('2019-06-03T21:00:00.000Z').getTime()).toBeGreaterThan(since.getTime());
    expect(new Date('2019-06-01T21:00:00.000Z').getTime()).toBeLessThan(since.getTime());
  });
});
