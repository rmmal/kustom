import { describe, expect, it } from 'vitest';
import { workedBalance, workedNames, workedPool } from '../testing/workedExample';
import { buildTeamsInput } from './assemble';
import { ACCENT_COLOR, joinNames, renderName, type TeamsEmbedInput, teamsEmbed } from './embeds';

/**
 * The teams embed against the worked example (`docs/00-product.md`), which is also the layout
 * in `docs/05-design.md`, "Discord embeds".
 *
 * Nothing here is hand-computed: the split and the explanation come from `balance()` and the
 * display ratings from `displayRating`.
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

  it('orders the fields Blue, Red, Sitting out, Seats, Lobby', () => {
    const embed = teamsEmbed(
      workedTeamsInput({
        sitOut: { names: ['Omar'], reason: 'most-games' },
        seats: [{ kind: 'swap', sitter: 'Omar', mover: 'Nadia' }],
      }),
    ).embeds[0];
    expect(embed?.fields.map((field) => field.name)).toEqual([
      'Blue · 7695',
      'Red · 7595',
      'Sitting out',
      'Seats',
      'Lobby',
    ]);
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

describe('the small formatters', () => {
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
});
