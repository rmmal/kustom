import { describe, expect, it } from 'vitest';
import type { PoolMember, SeatMove } from '../ingest/selection';
import { workedBalance, workedNames, workedPool, workedPuuid } from '../testing/workedExample';
import type { NameLookup } from './assemble';
import { buildTeamsInput, readAssignments, type TeamsSource, teamsPuuids } from './assemble';

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

function sitter(puuid: string, gamesTonight = 4): PoolMember {
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
    lastSitOutAt: null,
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

    const tied = buildTeamsInput(teamsSource({ sitters, tiedOnGames: true }), names, CONTEXT);
    expect(tied.sitOut?.reason).toBe('longest-since');
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
