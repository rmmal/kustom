import { displayRating, type Rating, rateGame } from '@customs/core';
import { describe, expect, it } from 'vitest';
import { displayDelta } from '../ratingDisplay';
import { WORKED_ROSTER, workedBalance, workedNames, workedPool, workedPuuid } from '../testing/workedExample';
import { buildTeamsInput } from './assemble';
import {
  ACCENT_COLOR,
  BLUE_COLOR,
  formatDamage,
  formatDelta,
  formatDuration,
  joinNames,
  RED_COLOR,
  type ResultEmbedInput,
  type ResultPlayer,
  renderName,
  resultEmbed,
  type TeamsEmbedInput,
  teamsEmbed,
  teamsTitle,
} from './embeds';

/**
 * The two embeds against the worked example (`docs/00-product.md`), which is also the layout
 * in `docs/05-design.md`, "Discord embeds".
 *
 * Nothing here is hand-computed: the split and the explanation come from `balance()`, the
 * display ratings from `displayRating`, and the result deltas from `rateGame`. The design
 * doc's result example was written by hand from the Plackett-Luce reduction and warns that it
 * is illustrative; these numbers are the package's.
 */

const TIMESTAMP = '2026-09-08T20:15:00.000Z';
const SITE_URL = 'https://customs.example';

function workedTeamsInput(overrides: Partial<TeamsEmbedInput> = {}): TeamsEmbedInput {
  const result = workedBalance();
  const split = result.splits[0];
  const explanation = result.explanations[0];
  if (split === undefined || explanation === undefined) throw new Error('no split');

  const built = buildTeamsInput(
    {
      split,
      explanation,
      lobbyName: 'customs-night',
      lobbyPassword: '4471',
      playing: workedPool(),
      sitters: [],
      seatMoves: [],
      tiedOnGames: false,
    },
    workedNames(),
    { url: SITE_URL, timestamp: TIMESTAMP },
  );

  return { ...built, ...overrides };
}

describe('teamsEmbed, the worked example', () => {
  const payload = teamsEmbed(workedTeamsInput());
  const embed = payload.embeds[0];

  it('matches the layout in 05-design.md', () => {
    expect(payload).toMatchSnapshot();
  });

  it('is the accent bar, not either side: a tinted teams embed reads as a prediction', () => {
    expect(embed?.color).toBe(ACCENT_COLOR);
    expect(embed?.title).toBe('Teams are set');
    expect(embed?.footer.text).toBe('Customs Night · more on the tonight page');
    expect(embed?.timestamp).toBe(TIMESTAMP);
  });

  it('posts the stored explanation verbatim as the description', () => {
    expect(embed?.description).toBe(
      'Blue favored 54%. Everyone on a main role. Gap 100. Next best: swap Hana and Omar, gap 170.',
    );
  });

  it('names the two side fields with the sum of five display ratings', () => {
    expect(embed?.fields[0]?.name).toBe('Blue · 7695');
    expect(embed?.fields[1]?.name).toBe('Red · 7595');
    expect(embed?.fields[0]?.inline).toBe(true);
    expect(embed?.fields[1]?.inline).toBe(true);
  });

  it('prints five lines a side, in lane order, role in inline code', () => {
    expect(embed?.fields[0]?.value.split('\n')).toEqual([
      '`top` Hana · 1434',
      '`jungle` Iris · 1578',
      '`mid` Karim · 1551',
      '`adc` Bilal · 1713',
      '`support` Theo · 1419',
    ]);
    expect(embed?.fields[1]?.value.split('\n')).toEqual([
      '`top` Omar · 1469',
      '`jungle` Rami · 1638',
      '`mid` Nadia · 1266',
      '`adc` Lena · 2088',
      '`support` Yuki · 1134',
    ]);
  });

  it('carries the lobby name and password so a straggler can still get in', () => {
    const lobby = embed?.fields.find((field) => field.name === 'Lobby');
    expect(lobby?.value).toBe('`customs-night` · password `4471`');
  });

  it('has no sit-out and no seats field on a ten-player night', () => {
    expect(embed?.fields.map((field) => field.name)).toEqual(['Blue · 7695', 'Red · 7595', 'Lobby']);
  });

  it('links the tonight page, and posts no url at all when there is none', () => {
    expect(embed?.url).toBe(SITE_URL);
    expect(teamsEmbed(workedTeamsInput({ url: undefined })).embeds[0]).not.toHaveProperty('url');
  });

  it('stops promising a tonight page when the title is not a link', () => {
    // A localhost origin is dropped by `tonightPageUrl`, and a footer that says "more on the
    // tonight page" over an unlinked title tells a friend to tap something that is not there.
    expect(teamsEmbed(workedTeamsInput({ url: undefined })).embeds[0]?.footer.text).toBe('Customs Night');
  });
});

describe('teamsEmbed, the fields that only sometimes exist', () => {
  it('drops the password half when the client reported no password (every lobby before M4.1)', () => {
    const embed = teamsEmbed(workedTeamsInput({ lobby: { name: 'customs-night', password: null } }))
      .embeds[0];
    expect(embed?.fields.find((field) => field.name === 'Lobby')?.value).toBe('`customs-night`');
  });

  it('has no Lobby field at all when neither is known: never empty, never "unknown"', () => {
    const embed = teamsEmbed(workedTeamsInput({ lobby: { name: null, password: null } })).embeds[0];
    expect(embed?.fields.some((field) => field.name === 'Lobby')).toBe(false);
  });

  it('prints M2.15 sit-out copy verbatim, with the most-games reason', () => {
    const embed = teamsEmbed(workedTeamsInput({ sitOut: { names: ['Omar', 'Sara'], reason: 'most-games' } }))
      .embeds[0];
    expect(embed?.fields.find((field) => field.name === 'Sitting out')?.value).toBe(
      'Sitting out: Omar and Sara — most games tonight.',
    );
  });

  it('switches the reason clause when everybody has played the same number tonight', () => {
    const embed = teamsEmbed(workedTeamsInput({ sitOut: { names: ['Omar'], reason: 'longest-since' } }))
      .embeds[0];
    expect(embed?.fields.find((field) => field.name === 'Sitting out')?.value).toBe(
      'Sitting out: Omar — longest since they last sat out.',
    );
  });

  it('says nobody had sat out before on the first balance of a night (M3.12)', () => {
    const embed = teamsEmbed(workedTeamsInput({ sitOut: { names: ['Player0'], reason: 'first-sit-out' } }))
      .embeds[0];
    expect(embed?.fields.find((field) => field.name === 'Sitting out')?.value).toBe(
      'Sitting out: Player0 — nobody has sat out before, so somebody had to be first.',
    );
  });

  it('prints one Seats line per move, swap and open slot', () => {
    const embed = teamsEmbed(
      workedTeamsInput({
        sitOut: { names: ['Omar'], reason: 'most-games' },
        seats: [
          { kind: 'swap', sitter: 'Omar', mover: 'Nadia' },
          { kind: 'open-slot', mover: 'Yuki' },
        ],
      }),
    ).embeds[0];
    expect(embed?.fields.find((field) => field.name === 'Seats')?.value.split('\n')).toEqual([
      'Swap: Omar out, Nadia in.',
      'Yuki is playing — take the open slot.',
    ]);
  });

  it('puts the rotation above the teams: Sitting out, Seats, Blue, Red, Lobby', () => {
    // `05-design.md`, revised 2026-09-09: the line that has to happen before anybody can play
    // goes above the fold, and Blue/Red stay next to each other so Discord still pairs them.
    const embed = teamsEmbed(
      workedTeamsInput({
        sitOut: { names: ['Omar'], reason: 'most-games' },
        seats: [{ kind: 'swap', sitter: 'Omar', mover: 'Nadia' }],
      }),
    ).embeds[0];
    expect(embed?.fields.map((field) => field.name)).toEqual([
      'Sitting out',
      'Seats',
      'Blue · 7695',
      'Red · 7595',
      'Lobby',
    ]);
    // Consecutive, and both inline: that is what makes them two columns rather than two rows.
    expect(embed?.fields.slice(2, 4).map((field) => field.inline)).toEqual([true, true]);
  });

  it('marks an off-role line, so the fact survives being read on its own', () => {
    const base = workedTeamsInput();
    const blue = base.blue.map((player, index) => (index === 0 ? { ...player, offRole: true } : player));
    const embed = teamsEmbed({ ...base, blue }).embeds[0];
    expect(embed?.fields[0]?.value.split('\n')[0]).toBe('`top` Hana · 1434 · off-role');
  });

  it('renders a player the database has no name for as Someone', () => {
    const base = workedTeamsInput();
    const blue = base.blue.map((player, index) => (index === 0 ? { ...player, name: null } : player));
    const embed = teamsEmbed({ ...base, blue }).embeds[0];
    expect(embed?.fields[0]?.value.split('\n')[0]).toBe('`top` Someone · 1434');
  });
});

/**
 * Red wins the worked example — the underdog at 46%, the case `05-design.md` illustrates.
 * The deltas are `rateGame`'s, not the design doc's hand arithmetic.
 */
function workedResultInput(overrides: Partial<ResultEmbedInput> = {}): ResultEmbedInput {
  const split = workedBalance().splits[0];
  if (split === undefined) throw new Error('no split');

  const before = new Map<string, Rating>(
    WORKED_ROSTER.map((player) => [workedPuuid(player.name), { mu: player.mu, sigma: player.sigma }]),
  );
  const rating = (puuid: string): Rating => {
    const value = before.get(puuid);
    if (value === undefined) throw new Error(`no rating for ${puuid}`);
    return value;
  };

  const rated = rateGame(
    split.blue.map((assignment) => rating(assignment.puuid)),
    split.red.map((assignment) => rating(assignment.puuid)),
    200,
  );

  const nameOf = new Map(WORKED_ROSTER.map((player) => [workedPuuid(player.name), player.name]));
  const side = (
    assignments: readonly { puuid: string; role: ResultPlayer['role'] }[],
    after: readonly Rating[],
  ): ResultPlayer[] =>
    assignments.map((assignment, index) => {
      const muAfter = after[index]?.mu;
      if (muAfter === undefined) throw new Error('rateGame returned fewer ratings than players');
      return {
        puuid: assignment.puuid,
        name: nameOf.get(assignment.puuid) ?? null,
        role: assignment.role,
        rating: displayRating(muAfter),
        delta: displayDelta(rating(assignment.puuid).mu, muAfter),
      };
    });

  return {
    winningSide: 200,
    // Invented, like the design doc's: the docs pin no result for the worked example.
    durationS: 2_052,
    blue: side(split.blue, rated.blue),
    red: side(split.red, rated.red),
    blueWinProb: split.blueWinProb,
    topDamage: { name: 'Lena', damage: 47_300 },
    seasonName: 'Season 1',
    gameNumber: 47,
    url: SITE_URL,
    timestamp: '2026-09-08T21:09:12.000Z',
    ...overrides,
  };
}

describe('resultEmbed, the worked example lost by the favourite', () => {
  const input = workedResultInput();
  const payload = resultEmbed(input);
  const embed = payload.embeds[0];

  it('matches the layout in 05-design.md', () => {
    expect(payload).toMatchSnapshot();
  });

  it('wears the winning side colour, and blue keeps the first column', () => {
    expect(embed?.color).toBe(RED_COLOR);
    expect(embed?.title).toBe('Red wins · 34:12');
    expect(embed?.fields.map((field) => field.name)).toEqual(['Blue', 'Red']);
    expect(resultEmbed(workedResultInput({ winningSide: 100 })).embeds[0]?.color).toBe(BLUE_COLOR);
    expect(resultEmbed(workedResultInput({ winningSide: 100 })).embeds[0]?.fields[0]?.name).toBe('Blue');
  });

  it('says who was favoured and who did the damage', () => {
    expect(embed?.description).toBe('Blue was favored 54%. Top damage: Lena, 47.3k.');
  });

  it('prints new rating and signed delta, one line per player', () => {
    expect(embed?.fields[0]?.value.split('\n')).toMatchSnapshot('blue lines');
    expect(embed?.fields[1]?.value.split('\n')).toMatchSnapshot('red lines');
  });

  it('adds up: every line is displayRating(muAfter) and its delta from displayRating(muBefore)', () => {
    const before = new Map(WORKED_ROSTER.map((player) => [player.name, displayRating(player.mu)]));
    for (const player of [...input.blue, ...input.red]) {
      const was = before.get(player.name ?? '');
      if (was === undefined) throw new Error(`no before rating for ${player.name}`);
      expect(player.rating - player.delta).toBe(was);
    }
  });

  it('never prints a team total of deltas', () => {
    // -223 and +223 on this roster: with real `rateGame` output the two sides happen to
    // cancel, which the design doc's hand-computed example (-228 / +231) did not. Either way
    // the total is not printed — movement scales with each player's own sigma, so the sides
    // are not guaranteed to cancel, and a visible imbalance is a free argument (M3.3).
    const blue = input.blue.reduce((total, player) => total + player.delta, 0);
    const red = input.red.reduce((total, player) => total + player.delta, 0);
    expect([blue, red]).toEqual([-223, 223]);
    for (const field of embed?.fields ?? []) {
      expect(field.name).not.toContain(String(blue));
      expect(field.name).not.toContain(String(red));
    }
  });

  it('footers the season and this game inside it', () => {
    expect(embed?.footer.text).toBe('Season 1 · game 47');
    expect(resultEmbed(workedResultInput({ gameNumber: null })).embeds[0]?.footer.text).toBe('Season 1');
  });

  it('drops the clauses it has nothing to say for', () => {
    const bare = resultEmbed(workedResultInput({ blueWinProb: null, topDamage: null })).embeds[0];
    expect(bare).not.toHaveProperty('description');
  });

  it('names neither side for the coin flip, and drops the number with it (M3.11)', () => {
    // `Even 50%.` is core's present-tense fragment and stays core's; under `Red wins · 34:12`
    // it reads as a scoreline. 50 is what "neither" means, so the percent goes too.
    const embedded = resultEmbed(workedResultInput({ blueWinProb: 0.5 })).embeds[0];
    expect(embedded?.description).toBe('Neither side was favored. Top damage: Lena, 47.3k.');
    expect(embedded?.description).not.toContain('50%');
  });

  it('reads the underdog win the other way round when red was favoured', () => {
    const embedded = resultEmbed(workedResultInput({ blueWinProb: 0.42, topDamage: null })).embeds[0];
    expect(embedded?.description).toBe('Red was favored 58%.');
  });
});

describe('teamsTitle, the title on a reroll (M3.2)', () => {
  it('leaves split 1 plain, including when an admin promotes it back', () => {
    expect(teamsTitle(undefined)).toBe('Teams are set');
    expect(teamsTitle({ rank: 1, splitCount: 3 })).toBe('Teams are set');
  });

  it('says which reroll this is, and that the second one is the last', () => {
    expect(teamsTitle({ rank: 2, splitCount: 3 })).toBe('Teams are set · reroll 1 of 2');
    expect(teamsTitle({ rank: 3, splitCount: 3 })).toBe('Teams are set · reroll 2 of 2');
  });

  it('counts the splits the lobby stored rather than assuming three', () => {
    // `of 2` is true because core returns three. A lobby that stored two must not promise a
    // reroll it has not got.
    expect(teamsTitle({ rank: 2, splitCount: 2 })).toBe('Teams are set · reroll 1 of 1');
  });

  it('titles the embed, and changes nothing else about it', () => {
    const plain = teamsEmbed(workedTeamsInput()).embeds[0];
    const rerolled = teamsEmbed(workedTeamsInput({ promoted: { rank: 2, splitCount: 3 } })).embeds[0];
    expect(rerolled?.title).toBe('Teams are set · reroll 1 of 2');
    expect({ ...rerolled, title: 'Teams are set' }).toEqual(plain);
  });
});

describe('the small formatters', () => {
  it('formats a duration as mm:ss, and hh:mm:ss past the hour', () => {
    expect(formatDuration(2_052)).toBe('34:12');
    expect(formatDuration(59)).toBe('0:59');
    expect(formatDuration(3_723)).toBe('1:02:03');
    expect(formatDuration(0)).toBe('0:00');
  });

  it('signs every delta, and keeps the direction of one that rounds to zero', () => {
    expect(formatDelta(43)).toBe('+43');
    expect(formatDelta(-46)).toBe('-46');
    expect(formatDelta(0)).toBe('+0');
    // `(0)` never appears (`05-design.md`, "Rating delta"). A rating that moved down by less
    // than half a point is `-0`, which `>= 0` would otherwise call positive.
    expect(formatDelta(-0)).toBe('-0');
    expect(formatDelta(displayDelta(25.0, 24.999))).toBe('-0');
    expect(formatDelta(displayDelta(25.0, 25.001))).toBe('+0');
  });

  it('abbreviates damage over a thousand only', () => {
    expect(formatDamage(47_300)).toBe('47.3k');
    expect(formatDamage(1_000)).toBe('1.0k');
    expect(formatDamage(940)).toBe('940');
  });

  it('joins names with commas and a final "and"', () => {
    expect(joinNames(['Sara'])).toBe('Sara');
    expect(joinNames(['Sara', 'Deniz'])).toBe('Sara and Deniz');
    expect(joinNames(['Sara', 'Deniz', 'Ali'])).toBe('Sara, Deniz and Ali');
    expect(joinNames([])).toBe('');
  });

  it('renders a missing name as Someone and truncates a long one at 32', () => {
    expect(renderName(null)).toBe('Someone');
    expect(renderName('   ')).toBe('Someone');
    expect(renderName('Hana')).toBe('Hana');
    expect(renderName('x'.repeat(40))).toBe(`${'x'.repeat(31)}…`);
    expect(renderName('x'.repeat(32))).toBe('x'.repeat(32));
  });

  it('escapes the markdown a Riot ID can carry, so a name is text and not markup', () => {
    // One stray backtick closes the role's code span and swallows the rest of the field.
    expect(renderName('a`b')).toBe('a\\`b');
    expect(renderName('Dark_Wolf')).toBe('Dark\\_Wolf');
    expect(renderName('*bold*')).toBe('\\*bold\\*');
    expect(renderName('~x~')).toBe('\\~x\\~');
    expect(renderName('a|b')).toBe('a\\|b');
    expect(renderName('a\\b')).toBe('a\\\\b');
  });

  it('escapes last, so the escapes cannot be sliced away by the truncation', () => {
    // 32 underscores: what a reader counts is still 31 characters and an ellipsis, and every
    // backslash still has its character. Escaping first would cut one off mid-pair.
    const rendered = renderName('_'.repeat(40));
    expect(rendered).toBe(`${'\\_'.repeat(31)}…`);
    expect(rendered.replace(/\\/g, '')).toBe(`${'_'.repeat(31)}…`);
  });

  it('escapes the name in every line that prints one', () => {
    const base = workedTeamsInput({
      sitOut: { names: ['Dark_Wolf'], reason: 'most-games' },
      seats: [{ kind: 'swap', sitter: 'Dark_Wolf', mover: 'a`b' }],
    });
    const blue = base.blue.map((player, index) => (index === 0 ? { ...player, name: 'a`b' } : player));
    const embed = teamsEmbed({ ...base, blue }).embeds[0];

    expect(embed?.fields.find((field) => field.name === 'Sitting out')?.value).toBe(
      'Sitting out: Dark\\_Wolf — most games tonight.',
    );
    expect(embed?.fields.find((field) => field.name === 'Seats')?.value).toBe(
      'Swap: Dark\\_Wolf out, a\\`b in.',
    );
    expect(embed?.fields.find((field) => field.name.startsWith('Blue'))?.value.split('\n')[0]).toBe(
      '`top` a\\`b · 1434',
    );
  });
});
