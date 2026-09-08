import { describe, expect, it } from 'vitest';
import {
  companionGamePayloadSchema,
  companionLobbyPayloadSchema,
  companionRankPayloadSchema,
  lcuGameIdSchema,
  lobbyStatusSchema,
  puuidSchema,
  roleSchema,
  sideSchema,
} from './index';

const PUUID_A = 'f1a2b3c4-d5e6-7890-abcd-ef1234567890';
const PUUID_B = '0f0e0d0c-0b0a-0908-0706-050403020100';

describe('puuidSchema', () => {
  it('accepts a client-shaped puuid', () => {
    expect(puuidSchema.parse(PUUID_A)).toBe(PUUID_A);
  });

  it('rejects an empty string', () => {
    expect(puuidSchema.safeParse('').success).toBe(false);
  });
});

describe('vocabulary schemas', () => {
  it('accepts the five roles and rejects anything else', () => {
    expect(roleSchema.parse('jungle')).toBe('jungle');
    expect(roleSchema.safeParse('bot').success).toBe(false);
  });

  it('accepts only the client side numbers', () => {
    expect(sideSchema.parse(100)).toBe(100);
    expect(sideSchema.parse(200)).toBe(200);
    expect(sideSchema.safeParse(0).success).toBe(false);
    expect(sideSchema.safeParse('100').success).toBe(false);
  });

  it('accepts every lobby status and rejects an invented one', () => {
    expect(lobbyStatusSchema.parse('in_game')).toBe('in_game');
    expect(lobbyStatusSchema.safeParse('inGame').success).toBe(false);
  });

  it('normalises a stringified game id and rejects a non-numeric one', () => {
    expect(lcuGameIdSchema.parse(7412345678)).toBe(7412345678);
    expect(lcuGameIdSchema.parse('7412345678')).toBe(7412345678);
    expect(lcuGameIdSchema.safeParse('NA1_7412345678').success).toBe(false);
    expect(lcuGameIdSchema.safeParse(-1).success).toBe(false);
  });
});

describe('companionLobbyPayloadSchema', () => {
  const valid = {
    partyId: '2c9f1a1b-0000-4000-8000-000000000001',
    lobbyName: 'customs night',
    lobbyPassword: '1234',
    members: [
      {
        puuid: PUUID_A,
        summonerId: '12345',
        gameName: 'Hana',
        tagLine: 'EUW',
        side: 100,
        isSpectator: false,
      },
      { puuid: PUUID_B, gameName: 'Omar', tagLine: 'EUW', side: null, isSpectator: true },
    ],
  };

  it('accepts a lobby the companion would post', () => {
    const parsed = companionLobbyPayloadSchema.parse(valid);
    expect(parsed.members).toHaveLength(2);
    expect(parsed.members[0]?.side).toBe(100);
    expect(parsed.members[1]?.side).toBeNull();
    expect(parsed.members[1]?.summonerId).toBeNull();
  });

  it('defaults isSpectator and empty text to null', () => {
    const parsed = companionLobbyPayloadSchema.parse({
      partyId: 'p1',
      lobbyName: '',
      members: [{ puuid: PUUID_A }],
    });
    expect(parsed.lobbyName).toBeNull();
    expect(parsed.lobbyPassword).toBeNull();
    expect(parsed.members[0]?.isSpectator).toBe(false);
  });

  it('rejects an empty party id, a bad side and a member without a puuid', () => {
    expect(companionLobbyPayloadSchema.safeParse({ ...valid, partyId: '' }).success).toBe(false);
    expect(
      companionLobbyPayloadSchema.safeParse({
        ...valid,
        members: [{ puuid: PUUID_A, side: 300, isSpectator: false }],
      }).success,
    ).toBe(false);
    expect(companionLobbyPayloadSchema.safeParse({ ...valid, members: [{ gameName: 'Hana' }] }).success).toBe(
      false,
    );
  });
});

describe('companionGamePayloadSchema', () => {
  const eog = {
    phase: 'eog',
    gameId: 7412345678,
    partyId: 'p1',
    gameType: 'CUSTOM_GAME',
    startedAt: '2026-09-08T20:00:00.000Z',
    durationS: 1834,
    winningSide: 100,
    participants: [
      {
        puuid: PUUID_A,
        side: 100,
        role: 'mid',
        championId: 103,
        kills: 9,
        deaths: 2,
        assists: 7,
        gold: 14200,
        damageToChamps: 31000,
        cs: 214,
      },
    ],
    raw: { gameId: 7412345678, teams: [] },
  };

  it('accepts the in-progress marker', () => {
    const parsed = companionGamePayloadSchema.parse({ phase: 'in_progress', gameId: '7412345678' });
    expect(parsed.phase).toBe('in_progress');
    expect(parsed.gameId).toBe(7412345678);
  });

  it('accepts an end-of-game block and keeps raw verbatim', () => {
    const parsed = companionGamePayloadSchema.parse(eog);
    expect(parsed.phase).toBe('eog');
    if (parsed.phase !== 'eog') throw new Error('unreachable');
    expect(parsed.source).toBe('eog');
    expect(parsed.winningSide).toBe(100);
    expect(parsed.raw).toEqual({ gameId: 7412345678, teams: [] });
    expect(parsed.participants[0]?.cs).toBe(214);
  });

  it('fills participant stat defaults', () => {
    const parsed = companionGamePayloadSchema.parse({
      ...eog,
      participants: [{ puuid: PUUID_A, side: 200 }],
    });
    if (parsed.phase !== 'eog') throw new Error('unreachable');
    expect(parsed.participants[0]).toMatchObject({
      side: 200,
      role: null,
      championId: null,
      kills: 0,
      deaths: 0,
      assists: 0,
      gold: 0,
      damageToChamps: 0,
      cs: 0,
    });
  });

  it('rejects an unknown phase, a missing winner and a non-object raw', () => {
    expect(companionGamePayloadSchema.safeParse({ ...eog, phase: 'lobby' }).success).toBe(false);
    expect(companionGamePayloadSchema.safeParse({ ...eog, winningSide: undefined }).success).toBe(false);
    expect(companionGamePayloadSchema.safeParse({ ...eog, raw: 'not an object' }).success).toBe(false);
    expect(companionGamePayloadSchema.safeParse({ ...eog, startedAt: 'last night' }).success).toBe(false);
    expect(companionGamePayloadSchema.safeParse({ ...eog, durationS: -5 }).success).toBe(false);
  });
});

describe('companionRankPayloadSchema', () => {
  it('accepts a rank reading', () => {
    const parsed = companionRankPayloadSchema.parse({
      puuid: PUUID_A,
      tier: 'GOLD',
      division: 'II',
      lp: 43,
      queue: 'RANKED_SOLO_5x5',
    });
    expect(parsed).toMatchObject({ tier: 'GOLD', division: 'II', lp: 43 });
  });

  it('accepts an unranked reading and defaults the queue', () => {
    const parsed = companionRankPayloadSchema.parse({ puuid: PUUID_A, tier: null, division: null });
    expect(parsed).toMatchObject({ tier: null, division: null, lp: null, queue: 'RANKED_SOLO_5x5' });
  });

  it('rejects a missing puuid and a negative lp', () => {
    expect(companionRankPayloadSchema.safeParse({ tier: 'GOLD' }).success).toBe(false);
    expect(companionRankPayloadSchema.safeParse({ puuid: PUUID_A, lp: -1 }).success).toBe(false);
  });
});
