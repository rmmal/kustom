import { describe, expect, it } from 'vitest';
import type { PoolMember, SeatMove } from '../ingest/selection';
import { workedBalance, workedNames, workedPool, workedPuuid } from '../testing/workedExample';
import type { NameLookup } from './assemble';
import {
  buildResultInput,
  buildTeamsInput,
  type ResultSource,
  readAssignments,
  type TeamsSource,
  teamsPuuids,
} from './assemble';

/**
 * The assembler: rows and events in, embed inputs out. Everything here is the pure half —
 * the queries have their own coverage in `discord.integration.test.ts`.
 */

const CONTEXT = { url: 'https://customs.example', timestamp: '2026-09-08T20:15:00.000Z' };

function teamsSource(overrides: Partial<TeamsSource> = {}): TeamsSource {
  const result = workedBalance();
  const split = result.splits[0];
  const explanation = result.explanations[0];
  if (split === undefined || explanation === undefined) throw new Error('no split');

  return {
    split,
    explanation,
    lobbyName: 'customs-night',
    lobbyPassword: null,
    playing: workedPool(),
    sitters: [],
    seatMoves: [],
    tiedOnGames: false,
    ...overrides,
  };
}

function sitter(puuid: string, gamesTonight = 4, lastSitOutAt: number | null = null): PoolMember {
  return {
    playerId: `player-${puuid}`,
    puuid,
    name: puuid,
    side: null,
    isSpectator: true,
    mainRole: null,
    secondaryRole: null,
    roleOverride: null,
    mu: 20,
    sigma: 10,
    gamesTonight,
    lastSitOutAt,
  };
}

describe('buildTeamsInput', () => {
  it('turns the chosen split into two sides of five with display ratings', () => {
    const input = buildTeamsInput(teamsSource(), workedNames(), CONTEXT);
    expect(input.blue.map((player) => [player.role, player.name, player.rating])).toEqual([
      ['top', 'Hana', 1434],
      ['jungle', 'Iris', 1578],
      ['mid', 'Karim', 1551],
      ['adc', 'Bilal', 1713],
      ['support', 'Theo', 1419],
    ]);
    expect(input.red).toHaveLength(5);
    expect(input.blue.every((player) => player.offRole === false)).toBe(true);
  });

  it('takes the explanation as given and never rebuilds it', () => {
    const input = buildTeamsInput(teamsSource({ explanation: 'whatever core said.' }), new Map(), CONTEXT);
    expect(input.explanation).toBe('whatever core said.');
  });

  it('marks off-role with core’s rule, not a copy of it', () => {
    // Hana mains top; putting her on support in the source makes her line off-role.
    const source = teamsSource();
    const split = {
      blue: source.split.blue.map((assignment) =>
        assignment.puuid === workedPuuid('Hana') ? { ...assignment, role: 'support' as const } : assignment,
      ),
      red: source.split.red,
    };
    const input = buildTeamsInput({ ...source, split }, workedNames(), CONTEXT);
    expect(input.blue.find((player) => player.name === 'Hana')?.offRole).toBe(true);
    expect(input.blue.filter((player) => player.offRole)).toHaveLength(1);
  });

  it('leaves a name we do not have as null, for the renderer to call Someone', () => {
    const names: NameLookup = new Map([[workedPuuid('Hana'), null]]);
    const input = buildTeamsInput(teamsSource(), names, CONTEXT);
    expect(input.blue.every((player) => player.name === null)).toBe(true);
  });

  it('says nothing about sitting out when nobody sits', () => {
    expect(buildTeamsInput(teamsSource(), workedNames(), CONTEXT).sitOut).toBeNull();
  });

  it('names the sitters and picks the reason clause from tiedOnGames', () => {
    const sitters = [sitter('puuid-sara'), sitter('puuid-deniz')];
    const names = new Map([...workedNames(), ['puuid-sara', 'Sara'], ['puuid-deniz', 'Deniz']]);

    const most = buildTeamsInput(teamsSource({ sitters }), names, CONTEXT);
    expect(most.sitOut).toEqual({ names: ['Sara', 'Deniz'], reason: 'most-games' });

    // Tied on games, and one of the ten has sat out before: that history is the reason.
    const playing = workedPool();
    const withHistory = playing.map((member, index) =>
      index === 0 ? { ...member, lastSitOutAt: 1_757_000_000_000 } : member,
    );
    const tied = buildTeamsInput(
      teamsSource({ sitters, tiedOnGames: true, playing: withHistory }),
      names,
      CONTEXT,
    );
    expect(tied.sitOut?.reason).toBe('longest-since');
  });

  /**
   * M3.12. The three clauses, and the boundary between the last two: `longest-since` is only
   * true once somebody around has actually sat out, and on the first balance of a night that
   * is nobody.
   */
  it('says nobody has sat out before when the pool is tied and carries no sit-out at all', () => {
    const sitters = [sitter('puuid-sara', 0)];
    const names = new Map([...workedNames(), ['puuid-sara', 'Sara']]);

    const first = buildTeamsInput(teamsSource({ sitters, tiedOnGames: true }), names, CONTEXT);
    expect(first.sitOut).toEqual({ names: ['Sara'], reason: 'first-sit-out' });

    // One sit-out anywhere in the pool — here the sitter's own — and the clause goes back.
    const sat = buildTeamsInput(
      teamsSource({ sitters: [sitter('puuid-sara', 0, 1_757_000_000_000)], tiedOnGames: true }),
      names,
      CONTEXT,
    );
    expect(sat.sitOut?.reason).toBe('longest-since');
  });

  it('never reaches for the first-night clause when somebody has played more tonight', () => {
    // Not tied is answered before any history is looked at: M3.12 only refines the tie.
    const sitters = [sitter('puuid-sara', 3)];
    const names = new Map([...workedNames(), ['puuid-sara', 'Sara']]);
    expect(buildTeamsInput(teamsSource({ sitters }), names, CONTEXT).sitOut?.reason).toBe('most-games');
  });

  it('turns a seat move with a sitter into a swap and one without into an open slot', () => {
    const mover = sitter('puuid-nadia');
    const out = sitter('puuid-omar');
    const seatMoves: SeatMove[] = [
      { sitter: out, mover },
      { sitter: null, mover },
    ];
    const names = new Map([
      ['puuid-nadia', 'Nadia'],
      ['puuid-omar', 'Omar'],
    ]);
    const input = buildTeamsInput(teamsSource({ seatMoves }), names, CONTEXT);
    expect(input.seats).toEqual([
      { kind: 'swap', sitter: 'Omar', mover: 'Nadia' },
      { kind: 'open-slot', mover: 'Nadia' },
    ]);
  });

  it('throws rather than inventing a rating for somebody who is not among the ten', () => {
    const source = teamsSource({ playing: workedPool().slice(1) });
    expect(() => buildTeamsInput(source, workedNames(), CONTEXT)).toThrow(/not among the ten/);
  });
});

describe('teamsPuuids', () => {
  it('asks for the ten, the sitters and both halves of every seat move', () => {
    const out = sitter('puuid-sara');
    const mover = sitter('puuid-deniz');
    const puuids = teamsPuuids(
      teamsSource({
        sitters: [out],
        seatMoves: [
          { sitter: out, mover },
          { sitter: null, mover },
        ],
      }),
    );
    expect(new Set(puuids).size).toBe(12);
    expect(puuids).toContain('puuid-sara');
    expect(puuids).toContain('puuid-deniz');
  });
});

function resultSource(overrides: Partial<ResultSource> = {}): ResultSource {
  const players = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((letter, index) => ({
    puuid: `puuid-${letter}`,
    name: letter.toUpperCase(),
    side: (index < 5 ? 100 : 200) as 100 | 200,
    role: null,
    damage: 1_000 * (index + 1),
    muBefore: 25,
    muAfter: index < 5 ? 24.5 : 25.5,
  }));

  return {
    winningSide: 200,
    durationS: 1_800,
    seasonName: 'Season 1',
    gameNumber: 3,
    blueWinProb: 0.5,
    endedAt: '2026-09-08T21:00:00.000Z',
    players,
    ...overrides,
  };
}

describe('buildResultInput', () => {
  it('rounds both ratings before subtracting, so the row adds up', () => {
    const input = buildResultInput(resultSource(), CONTEXT);
    expect(input?.blue[0]).toMatchObject({ rating: 1470, delta: -30 });
    expect(input?.red[0]).toMatchObject({ rating: 1530, delta: 30 });
    for (const player of [...(input?.blue ?? []), ...(input?.red ?? [])]) {
      expect(player.rating - player.delta).toBe(1500);
    }
  });

  it('is null for a game the fold did not rate: there is nothing to say', () => {
    const source = resultSource();
    const players = source.players.map((player, index) =>
      index === 0 ? { ...player, muBefore: null, muAfter: null } : player,
    );
    expect(buildResultInput({ ...source, players }, CONTEXT)).toBeNull();
    expect(buildResultInput({ ...source, players: [] }, CONTEXT)).toBeNull();
  });

  it('picks the single highest damage, and says nothing when the block carried none', () => {
    expect(buildResultInput(resultSource(), CONTEXT)?.topDamage).toEqual({ name: 'J', damage: 10_000 });

    const source = resultSource();
    const players = source.players.map((player) => ({ ...player, damage: 0 }));
    expect(buildResultInput({ ...source, players }, CONTEXT)?.topDamage).toBeNull();
  });

  it('breaks a damage tie on puuid, so the same game always names the same player', () => {
    const source = resultSource();
    const players = source.players.map((player) => ({ ...player, damage: 5_000 }));
    expect(buildResultInput({ ...source, players }, CONTEXT)?.topDamage?.name).toBe('A');
  });

  it('timestamps the game, not the post', () => {
    const input = buildResultInput(resultSource(), { ...CONTEXT, timestamp: '2026-09-08T21:00:00.000Z' });
    expect(input?.timestamp).toBe('2026-09-08T21:00:00.000Z');
  });
});

describe('readAssignments', () => {
  it('reads a stored split side and drops anything it does not recognise', () => {
    expect(
      readAssignments([
        { puuid: 'a', role: 'top' },
        { puuid: 'b', role: 'coach' },
        { puuid: '', role: 'mid' },
        null,
        'nonsense',
      ]),
    ).toEqual([{ puuid: 'a', role: 'top' }]);
    expect(readAssignments(null)).toEqual([]);
    expect(readAssignments({ puuid: 'a' })).toEqual([]);
  });
});
