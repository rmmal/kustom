import { describe, expect, it } from 'vitest';
import { rosterFor, statsGame, tenPlayerGame } from '../testing/statsFixtures';
import { funFactsView } from './fun';
import {
  DOUBLE_TITLE,
  FIRST_BLOOD_EMPTY,
  FIRST_BLOOD_TAKEN_EMPTY,
  FIRST_BLOOD_TITLE,
  fearBanLine,
  funRoast,
  PENTA_EMPTY,
  PENTA_TITLE,
  QUADRA_TITLE,
  TRIPLE_TITLE,
  TURRET_TITLE,
  WON_UGLY,
} from './funCopy';
import { playerFacts, type RawGameFacts } from './rawFacts';

function loudLena() {
  return tenPlayerGame({
    at: '2026-09-02T20:00:00Z',
    durationS: 1_800,
    winner: 100,
    blue: [
      {
        key: 'lena',
        role: 'adc',
        kills: 18,
        deaths: 2,
        assists: 9,
        cs: 280,
        damageToChamps: 32_000,
        gold: 16_000,
      },
      {
        key: 'iris',
        role: 'top',
        kills: 4,
        deaths: 5,
        assists: 6,
        cs: 190,
        damageToChamps: 14_000,
        gold: 11_000,
      },
      {
        key: 'rami',
        role: 'jungle',
        kills: 6,
        deaths: 4,
        assists: 12,
        cs: 160,
        damageToChamps: 12_000,
        gold: 12_000,
      },
      {
        key: 'omar',
        role: 'mid',
        kills: 8,
        deaths: 3,
        assists: 7,
        cs: 220,
        damageToChamps: 18_000,
        gold: 13_000,
      },
      {
        key: 'theo',
        role: 'support',
        kills: 1,
        deaths: 6,
        assists: 20,
        cs: 40,
        damageToChamps: 4_000,
        gold: 8_000,
      },
    ],
    red: [
      {
        key: 'yuki',
        role: 'adc',
        kills: 2,
        deaths: 11,
        assists: 1,
        cs: 90,
        damageToChamps: 6_000,
        gold: 9_000,
      },
      {
        key: 'nadia',
        role: 'top',
        kills: 3,
        deaths: 7,
        assists: 2,
        cs: 140,
        damageToChamps: 8_000,
        gold: 9_500,
      },
      {
        key: 'karim',
        role: 'jungle',
        kills: 1,
        deaths: 8,
        assists: 3,
        cs: 80,
        damageToChamps: 5_000,
        gold: 8_500,
      },
      {
        key: 'hana',
        role: 'mid',
        kills: 4,
        deaths: 6,
        assists: 2,
        cs: 150,
        damageToChamps: 9_000,
        gold: 10_000,
      },
      {
        key: 'bilal',
        role: 'support',
        kills: 0,
        deaths: 9,
        assists: 4,
        cs: 18,
        damageToChamps: 2_000,
        gold: 7_000,
      },
    ],
  });
}

describe('funFactsView', () => {
  it('uses the same counted-game gate as /stats — a remake is not a record', () => {
    const remake = statsGame({
      at: '2026-09-02T20:00:00Z',
      durationS: 120,
      blue: ['lena:adc', 'iris:top', 'rami:jungle', 'omar:mid', 'theo:support'],
      red: ['yuki:adc', 'nadia:top', 'karim:jungle', 'hana:mid', 'bilal:support'],
    });
    const facts = funFactsView([remake], rosterFor([remake]));
    expect(facts.games).toBe(0);
    expect(facts.records.find((record) => record.id === 'kills')?.holders).toEqual([]);
  });

  it('names the highest and lowest CS at a role in one counted game', () => {
    const game = loudLena();
    const facts = funFactsView([game], rosterFor([game]));
    const adc = facts.csByRole.find((pair) => pair.role === 'adc');
    expect(adc?.highest?.name).toBe('Lena');
    expect(adc?.highest?.valueLabel).toContain('280 CS');
    expect(adc?.lowest?.name).toBe('Yuki');
  });

  it('roasts the English titles in Egyptian 3ameya, not a translation', () => {
    expect(funRoast(FIRST_BLOOD_TITLE)).toBe('مين فتحها');
    expect(funRoast(PENTA_TITLE)).toBe('كنسهم كنس');
    expect(funRoast(WON_UGLY)).toBe('كسب وهو زبالة');
    expect(funRoast('not a /fun title')).toBeNull();
  });

  it('crowns one-game combat records from the stored scoreboard', () => {
    const game = loudLena();
    const facts = funFactsView([game], rosterFor([game]));
    const kills = facts.records.find((record) => record.id === 'kills')?.holders[0];
    expect(kills?.name).toBe('Lena');
    expect(kills?.game?.blue.seats.some((seat) => seat.puuid === 'u-lena')).toBe(true);
    expect(kills?.game?.red.seats.length).toBe(5);
    expect(facts.deathHall.find((record) => record.id === 'deaths')?.holders[0]?.name).toBe('Yuki');
    expect(facts.records.find((record) => record.id === 'assists')?.holders[0]?.name).toBe('Theo');
    expect(facts.records.find((record) => record.id === 'damage')?.holders[0]?.name).toBe('Lena');
  });

  it('leaves the museum empty when the stored block named no killer', () => {
    const game = loudLena();
    const facts = funFactsView([game], rosterFor([game]));
    expect(facts.museum.rows).toEqual([]);
    expect(facts.museum.empty).toBe(FIRST_BLOOD_EMPTY);
    expect(facts.donated.rows).toEqual([]);
    expect(facts.donated.empty).toBe(FIRST_BLOOD_TAKEN_EMPTY);
    expect(facts.notes).toEqual([]);
    expect(facts.halls.map((hall) => hall.title)).toEqual([
      PENTA_TITLE,
      QUADRA_TITLE,
      TRIPLE_TITLE,
      DOUBLE_TITLE,
      TURRET_TITLE,
    ]);
    expect(facts.halls.every((hall) => hall.rows.length === 0)).toBe(true);
    expect(facts.halls[0]?.empty).toBe(PENTA_EMPTY);
    expect(facts.records.find((record) => record.id === 'spree')?.holders).toEqual([]);
  });

  it('names the first-blood killer, their champion, and the night', () => {
    const game = tenPlayerGame({
      at: '2026-09-02T20:00:00Z',
      durationS: 1_800,
      winner: 100,
      blue: [{ key: 'lena', role: 'adc', championId: 103, kills: 4, deaths: 1, assists: 6 }],
      rawFacts: rawFacts({
        players: { 'u-lena': { firstBloodKill: true, championName: 'Ahri' } },
      }),
    });
    const facts = funFactsView([game], rosterFor([game]));
    expect(facts.museum.rows[0]?.taker).toEqual({ puuid: 'u-lena', name: 'Lena' });
    expect(facts.museum.rows[0]?.countLabel).toBe('1 first blood');
    expect(facts.museum.rows[0]?.openings[0]).toMatchObject({
      champion: 'Ahri',
      victim: null,
      when: expect.stringContaining('Sep'),
    });
    expect(facts.donated.rows).toEqual([]);
  });

  it('names who donated first blood only when the block flagged the death', () => {
    const named = tenPlayerGame({
      id: 'fb-named',
      at: '2026-09-02T20:00:00Z',
      durationS: 1_800,
      winner: 100,
      blue: [{ key: 'lena', role: 'adc', championId: 103, kills: 4, deaths: 0, assists: 6 }],
      red: [{ key: 'yuki', role: 'adc', championId: 22, kills: 1, deaths: 4, assists: 1 }],
      rawFacts: rawFacts({
        players: {
          'u-lena': { firstBloodKill: true, championName: 'Ahri' },
          'u-yuki': { firstBloodDeath: true, championName: 'Ashe' },
        },
      }),
    });
    const guessed = tenPlayerGame({
      id: 'fb-guess',
      at: '2026-09-03T20:00:00Z',
      durationS: 1_800,
      winner: 100,
      blue: [{ key: 'lena', role: 'adc', championId: 103, kills: 3, deaths: 0, assists: 2 }],
      red: [{ key: 'yuki', role: 'adc', championId: 22, kills: 0, deaths: 8, assists: 1 }],
      rawFacts: rawFacts({
        players: {
          'u-lena': { firstBloodKill: true },
          'u-yuki': { longestLivedS: 40 },
        },
      }),
    });
    const facts = funFactsView([named, guessed], rosterFor([named, guessed]));
    expect(facts.donated.rows).toHaveLength(1);
    expect(facts.donated.rows[0]?.taker).toEqual({ puuid: 'u-yuki', name: 'Yuki' });
    expect(facts.donated.rows[0]?.countLabel).toBe('1 first blood taken');
    expect(facts.donated.rows[0]?.openings[0]).toMatchObject({
      champion: 'Ashe',
      victim: { puuid: 'u-lena', name: 'Lena' },
      foeVerb: 'to',
    });
    expect(facts.museum.rows[0]?.openings.map((row) => row.victim?.puuid ?? null)).toEqual([null, 'u-yuki']);
  });

  it('crowns a deathless streak and a steal from the stored extras', () => {
    const clean = (id: string, at: string) =>
      tenPlayerGame({
        id,
        at,
        durationS: 1_800,
        winner: 100,
        blue: [{ key: 'lena', role: 'adc', deaths: 0, kills: 3, assists: 4 }],
        red: [{ key: 'yuki', role: 'adc', deaths: 4, kills: 1, assists: 1 }],
        rawFacts: rawFacts({
          players: {
            'u-lena': { longestLivedS: 1_800, objectivesStolen: 2, dragonKills: 1 },
            'u-yuki': { longestLivedS: 90 },
          },
        }),
      });
    const games = [
      othersDied(clean('g-a', '2026-09-01T20:00:00Z'), 'lena'),
      othersDied(clean('g-b', '2026-09-02T20:00:00Z'), 'lena'),
      othersDied(
        tenPlayerGame({
          id: 'g-c',
          at: '2026-09-03T20:00:00Z',
          durationS: 1_800,
          winner: 200,
          blue: [{ key: 'lena', role: 'adc', deaths: 3, kills: 1, assists: 1 }],
          rawFacts: rawFacts({ players: { 'u-lena': { longestLivedS: 400 } } }),
        }),
        'yuki',
      ),
    ];
    const facts = funFactsView(games, rosterFor(games));
    expect(facts.deathHall.find((record) => record.id === 'deathless-streak')?.holders[0]?.name).toBe('Lena');
    expect(facts.deathHall.find((record) => record.id === 'shortest-life')?.holders[0]?.name).toBe('Yuki');
    expect(facts.thieves.find((record) => record.id === 'steals')?.holders[0]?.name).toBe('Lena');
    expect(facts.thieves.find((record) => record.id === 'steals')?.holders[0]?.valueLabel).toBe(
      '2 dragon steals',
    );
    expect(
      facts.deathHall.find((record) => record.id === 'deathless-games')?.holders[0]?.openings,
    ).toHaveLength(2);
    expect(facts.thieves.find((record) => record.id === 'steals-window')?.holders[0]?.openings.length).toBe(
      2,
    );
  });

  it('groups first bloods by the taker and ranks the lobby champions', () => {
    const first = (id: string, at: string, key: 'lena' | 'omar', championId: number) =>
      tenPlayerGame({
        id,
        at,
        durationS: 1_800,
        winner: 100,
        blue: [{ key, role: 'adc', championId, kills: 3, deaths: 1, assists: 2 }],
        rawFacts: rawFacts({
          players: { [`u-${key}`]: { firstBloodKill: true } },
          bans: [{ championId: 35, teamId: 200 }],
        }),
      });
    const games = [
      first('fb-a', '2026-09-01T20:00:00Z', 'lena', 103),
      first('fb-b', '2026-09-02T20:00:00Z', 'lena', 103),
      first('fb-c', '2026-09-03T20:00:00Z', 'omar', 35),
    ];
    const facts = funFactsView(games, rosterFor(games));
    expect(facts.museum.rows.map((row) => [row.taker.name, row.count])).toEqual([
      ['Lena', 2],
      ['Omar', 1],
    ]);
    expect(facts.museum.rows[0]?.openings).toHaveLength(2);
    expect(facts.mostBanned.rows[0]).toMatchObject({ champion: 'Shaco', valueLabel: '3 bans' });
    expect(facts.mostPicked.rows[0]).toMatchObject({ champion: 'Ahri', valueLabel: '2 picks' });
  });

  it('counts Master Yi and Zac from stored draft bans, one per team per game', () => {
    const game = tenPlayerGame({
      id: 'bans-yi-zac',
      at: '2026-09-12T20:00:00Z',
      durationS: 1_800,
      winner: 100,
      blue: [{ key: 'lena', role: 'adc', championId: 103, kills: 4, deaths: 1, assists: 2 }],
      rawFacts: rawFacts({
        bans: [
          { championId: 11, teamId: 100 },
          { championId: 154, teamId: 200 },
        ],
      }),
    });
    const facts = funFactsView([game], rosterFor([game]));
    expect(facts.mostBanned.rows.map((row) => [row.champion, row.count])).toEqual([
      ['Master Yi', 1],
      ['Zac', 1],
    ]);
  });

  it('sums stored multi-kills per person and does not invent a penta from KDA', () => {
    const games = [
      tenPlayerGame({
        id: 'mk-a',
        at: '2026-09-01T20:00:00Z',
        durationS: 1_800,
        winner: 100,
        blue: [
          { key: 'lena', role: 'adc', championId: 103, kills: 18, deaths: 1, assists: 4 },
          { key: 'omar', role: 'mid', championId: 35, kills: 8, deaths: 2, assists: 6 },
        ],
        rawFacts: rawFacts({
          players: {
            'u-lena': { tripleKills: 2, doubleKills: 3, largestKillingSpree: 8, championName: 'Ahri' },
            'u-omar': { tripleKills: 1, firstTowerKill: true, championName: 'Shaco' },
          },
        }),
      }),
      tenPlayerGame({
        id: 'mk-b',
        at: '2026-09-02T20:00:00Z',
        durationS: 1_800,
        winner: 100,
        blue: [{ key: 'lena', role: 'adc', championId: 103, kills: 12, deaths: 2, assists: 5 }],
        rawFacts: rawFacts({
          players: {
            'u-lena': { pentaKills: 1, quadraKills: 1, tripleKills: 1, championName: 'Ahri' },
          },
        }),
      }),
    ];
    const facts = funFactsView(games, rosterFor(games));
    const pentas = facts.halls.find((hall) => hall.title === PENTA_TITLE);
    const quadras = facts.halls.find((hall) => hall.title === QUADRA_TITLE);
    const triples = facts.halls.find((hall) => hall.title === TRIPLE_TITLE);
    const doubles = facts.halls.find((hall) => hall.title === DOUBLE_TITLE);
    const turrets = facts.halls.find((hall) => hall.title === TURRET_TITLE);
    expect(pentas?.rows.map((row) => [row.taker.name, row.count, row.countLabel])).toEqual([
      ['Lena', 1, '1 penta'],
    ]);
    expect(quadras?.rows[0]?.countLabel).toBe('1 quadra');
    expect(triples?.rows.map((row) => [row.taker.name, row.count, row.countLabel])).toEqual([
      ['Lena', 3, '3 triples'],
      ['Omar', 1, '1 triple'],
    ]);
    expect(triples?.rows[0]?.openings.map((row) => row.haul)).toEqual([null, '2 triples']);
    expect(doubles?.rows[0]).toMatchObject({ taker: { name: 'Lena' }, count: 3, countLabel: '3 doubles' });
    expect(turrets?.rows[0]).toMatchObject({
      taker: { name: 'Omar' },
      countLabel: '1 first turret',
      openings: [{ champion: 'Shaco', haul: null }],
    });
    expect(facts.records.find((record) => record.id === 'spree')?.holders[0]).toMatchObject({
      name: 'Lena',
      valueLabel: '8 kill streak',
    });
  });

  it('writes a fear-ban sentence from enemy draft bans', () => {
    const games = [1, 2, 3, 4, 5].map((n) =>
      tenPlayerGame({
        id: `g-fear-${n}`,
        at: `2026-09-0${n}T20:00:00Z`,
        durationS: 1_800,
        winner: 100,
        blue: [{ key: 'omar', role: 'mid', championId: 35 }],
        rawFacts: rawFacts({
          bans: n <= 3 ? [{ championId: 35, teamId: 200 }] : [],
        }),
      }),
    );
    const facts = funFactsView(games, rosterFor(games));
    expect(facts.fearBans.rows[0]?.line).toBe(fearBanLine('Omar', 'Shaco', 60, 3, 5));
  });

  it('names a fountain resident only when CS and takedowns are both that low', () => {
    const farmed = { kills: 4, deaths: 3, assists: 5, cs: 180 };
    const game = tenPlayerGame({
      at: '2026-09-02T20:00:00Z',
      durationS: 1_400,
      winner: 100,
      blue: [
        { key: 'lena', role: 'adc', kills: 0, deaths: 4, assists: 1, cs: 12 },
        { key: 'iris', role: 'top', ...farmed },
        { key: 'rami', role: 'jungle', ...farmed },
        { key: 'omar', role: 'mid', ...farmed },
        { key: 'theo', role: 'support', ...farmed },
      ],
      red: [
        { key: 'yuki', role: 'adc', ...farmed },
        { key: 'nadia', role: 'top', ...farmed },
        { key: 'karim', role: 'jungle', ...farmed },
        { key: 'hana', role: 'mid', ...farmed },
        { key: 'bilal', role: 'support', ...farmed },
      ],
    });
    const facts = funFactsView([game], rosterFor([game]));
    expect(facts.records.find((record) => record.id === 'fountain')?.holders[0]?.name).toBe('Lena');
  });
});

function othersDied(
  game: ReturnType<typeof tenPlayerGame>,
  except: string,
): ReturnType<typeof tenPlayerGame> {
  return {
    ...game,
    rows: game.rows.map((row) =>
      row.playerId === `p-${except}` ? row : { ...row, deaths: Math.max(1, row.deaths) },
    ),
  };
}

function rawFacts(spec: {
  players?: Record<string, Partial<RawGameFacts['byPuuid'][string]>>;
  bans?: RawGameFacts['bans'];
}): RawGameFacts {
  const byPuuid: RawGameFacts['byPuuid'] = {};
  for (const [puuid, extras] of Object.entries(spec.players ?? {})) {
    byPuuid[puuid] = playerFacts(extras);
  }
  return { byPuuid, bans: spec.bans ?? [] };
}
