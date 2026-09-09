import { describe, expect, it } from 'vitest';
import {
  extraMember,
  lobbyView,
  snapshot,
  workedMembers,
  workedResult,
  workedTeams,
} from '../testing/tonightFixtures';
import { fillingSentence } from './copy';
import { tonightHeader, tonightState } from './state';

/**
 * The status strip, state by state (M3.18, `05-design.md`, "Copy — final (product
 * 2026-09-09)").
 *
 * These are the strings a friend reads in a dark room and the ones product argued over twice,
 * so they are pinned here character for character rather than inferred from the page: four of
 * the five headlines and five of the sentences are deliberate edits to what the code said
 * before this task, and a test that only checked "some text" would have let them drift back.
 */

const header = (state: Parameters<typeof tonightHeader>[0]) => tonightHeader(state);
const stripOf = (input: Parameters<typeof tonightState>[0]) => header(tonightState(input));

describe('the strip headline, one per state', () => {
  it('idle: NOBODY IN YET, no count, the shipped sentence, no live pill', () => {
    const strip = stripOf(snapshot(null));

    expect(strip.headline).toBe('NOBODY IN YET');
    expect(strip.count).toBeNull();
    expect(strip.sentence).toBe(
      'When ten of you are in a custom lobby with the companion running, the teams show up here.',
    );
    expect(strip.live).toBe(false);
  });

  it('filling: the count and IN THE LOBBY, with the pill lit', () => {
    const strip = stripOf(snapshot(lobbyView({ members: workedMembers(9) })));

    expect(strip.headline).toBe('IN THE LOBBY');
    expect(strip.count).toBe(9);
    expect(strip.sentence).toBe('One more to go.');
    expect(strip.live).toBe(true);
  });

  it('balanced: TEAMS ARE SET, and a sentence that does not repeat it', () => {
    const strip = stripOf(snapshot(lobbyView({ status: 'balanced', teams: workedTeams() })));

    expect(strip.headline).toBe('TEAMS ARE SET');
    expect(strip.sentence).toBe('Split by rating and role. Nobody picked the teams.');
    expect(strip.live).toBe(true);
  });

  it('in game: IN GAME, and what happens when it ends', () => {
    const strip = stripOf(snapshot(lobbyView({ status: 'in_game', teams: workedTeams() })));

    expect(strip.headline).toBe('IN GAME');
    expect(strip.sentence).toBe('Ratings move when it ends.');
    expect(strip.live).toBe(true);
  });

  it('finished: GAME OVER, the ratings are in, and the pill is gone', () => {
    const strip = stripOf(
      snapshot(lobbyView({ status: 'finished', teams: workedTeams(), result: workedResult() })),
    );

    expect(strip.headline).toBe('GAME OVER');
    expect(strip.sentence).toBe('Ratings are updated. The leaderboard has the rest.');
    expect(strip.live).toBe(false);
  });

  it('finished but unrated: GAME OVER and an empty sentence slot, never an apology', () => {
    const withTeams = stripOf(
      snapshot(
        lobbyView({ status: 'finished', teams: workedTeams(), result: workedResult({ rated: false }) }),
      ),
    );
    expect(withTeams.headline).toBe('GAME OVER');
    expect(withTeams.sentence).toBe('');

    // The narrower case: a finished lobby with a result and no stored split at all.
    const withoutTeams = stripOf(
      snapshot(lobbyView({ status: 'finished', teams: null, result: workedResult({ rated: false }) })),
    );
    expect(withoutTeams.headline).toBe('GAME OVER');
    expect(withoutTeams.sentence).toBe('');
  });
});

describe('the sentence while the lobby fills', () => {
  it('says the fact once at zero, and never repeats the headline', () => {
    expect(fillingSentence(0)).toBe('Nobody in the lobby yet.');
  });

  it('counts the seats still to fill, in words, because the digit is already 44px above it', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(fillingSentence)).toEqual([
      'Nine more to go.',
      'Eight more to go.',
      'Seven more to go.',
      'Six more to go.',
      'Five more to go.',
      'Four more to go.',
      'Three more to go.',
      'Two more to go.',
      'One more to go.',
    ]);
  });

  it('waits at ten and explains the eleventh', () => {
    expect(fillingSentence(10)).toBe('Teams in a moment.');
    expect(fillingSentence(11)).toBe('Ten play, the rest sit out this game.');
    expect(fillingSentence(14)).toBe('Ten play, the rest sit out this game.');
  });

  it('is the sentence the strip carries, for the lobby it is given', () => {
    const eleven = snapshot(lobbyView({ members: [...workedMembers(), extraMember()] }));
    const strip = stripOf(eleven);

    expect(strip.count).toBe(11);
    expect(strip.sentence).toBe('Ten play, the rest sit out this game.');
  });
});
