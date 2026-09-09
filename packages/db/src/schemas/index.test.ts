import { describe, expect, it } from 'vitest';
import {
  companionGamePayloadSchema,
  companionLobbyPayloadSchema,
  companionLobbyResponseSchema,
  companionMeResponseSchema,
  companionRankPayloadSchema,
  DETECTED_TEAM_POSITION_ROLES,
  lcuGameIdSchema,
  lobbyStatusSchema,
  puuidSchema,
  roleFromDetectedTeamPosition,
  roleSchema,
  sideSchema,
  summonerIdSchema,
  ZERO_PUUID,
} from './index';

const PUUID_A = 'f1a2b3c4-d5e6-7890-abcd-ef1234567890';
const PUUID_B = '0f0e0d0c-0b0a-0908-0706-050403020100';

describe('puuidSchema', () => {
  it('accepts a client-shaped puuid', () => {
    expect(puuidSchema.parse(PUUID_A)).toBe(PUUID_A);
  });

  it('rejects an empty string', () => {
    expect(puuidSchema.safeParse('').success).toBe(false);
    expect(puuidSchema.safeParse('   ').success).toBe(false);
  });

  it('rejects the all-zero puuid every bot shares (M2.10)', () => {
    // PUUID is the identity. One `players` row keyed on this would be every bot that has ever
    // played, in every game, forever.
    expect(puuidSchema.safeParse(ZERO_PUUID).success).toBe(false);
    expect(puuidSchema.safeParse('00000000-0000-0000-0000-000000000000').success).toBe(false);
    expect(puuidSchema.safeParse('00000000-0000-0000-0000-000000000001').success).toBe(true);
  });
});

describe('summonerIdSchema', () => {
  it('takes the client number and stores digits', () => {
    // `members[].summonerId` is a JSON number on 16.17; `players.summoner_id` is text.
    expect(summonerIdSchema.parse(47890856)).toBe('47890856');
    expect(summonerIdSchema.parse('47890856')).toBe('47890856');
    // Not 32-bit: an invitee's id read 2686822975473024.
    expect(summonerIdSchema.parse(2686822975473024)).toBe('2686822975473024');
  });

  it('treats absent, empty and zero as not known', () => {
    expect(summonerIdSchema.parse(undefined)).toBeNull();
    expect(summonerIdSchema.parse(null)).toBeNull();
    expect(summonerIdSchema.parse('')).toBeNull();
    // A bot slot reports 0; storing it would make every bot the same summoner.
    expect(summonerIdSchema.parse(0)).toBeNull();
    expect(summonerIdSchema.parse('0')).toBeNull();
  });

  it('rejects anything that is not a run of digits', () => {
    expect(summonerIdSchema.safeParse('BR1_478').success).toBe(false);
    expect(summonerIdSchema.safeParse(-1).success).toBe(false);
    expect(summonerIdSchema.safeParse(1.5).success).toBe(false);
    expect(summonerIdSchema.safeParse(2 ** 53).success).toBe(false);
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
        summonerId: 12345,
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
    // The client's number, stored as text.
    expect(parsed.members[0]?.summonerId).toBe('12345');
    expect(parsed.droppedMembers).toBe(0);
  });

  it('drops a bot or placeholder member instead of refusing the whole roster (M2.10)', () => {
    const parsed = companionLobbyPayloadSchema.parse({
      ...valid,
      members: [
        ...valid.members,
        { puuid: '', summonerId: 0, isSpectator: false },
        { puuid: ZERO_PUUID, isSpectator: false },
        { puuid: 'bot-1', isBot: true },
      ],
    });

    expect(parsed.members).toHaveLength(2);
    expect(parsed.droppedMembers).toBe(3);
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
    // M5.1: a backfilled match-history detail is the same body with `source: 'backfill'`.
    const backfilled = companionGamePayloadSchema.parse({ ...eog, source: 'backfill' });
    expect(backfilled.phase === 'eog' && backfilled.source).toBe('backfill');
    expect(companionGamePayloadSchema.safeParse({ ...eog, source: 'manual' }).success).toBe(false);
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

  it('accepts an explicit "nobody won" and fills win from the winning side', () => {
    // A block with no winning team is a remake or a TerminatedInError. It parses — the key is
    // a statement, not a forgotten field — and the route refuses it 422 (M2.10, point 6).
    const parsed = companionGamePayloadSchema.parse({ ...eog, winningSide: null });
    if (parsed.phase !== 'eog') throw new Error('unreachable');
    expect(parsed.winningSide).toBeNull();
    expect(parsed.participants[0]?.win).toBeNull();

    const won = companionGamePayloadSchema.parse(eog);
    if (won.phase !== 'eog') throw new Error('unreachable');
    expect(won.participants[0]?.win).toBe(true);
  });

  it('rejects a bot participant, because a bot is not a player', () => {
    expect(
      companionGamePayloadSchema.safeParse({
        ...eog,
        participants: [{ puuid: ZERO_PUUID, side: 100 }],
      }).success,
    ).toBe(false);
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

  it("normalises the client's unranked strings and never carries losses", () => {
    // 16.17 unranked: tier "", division "NA". A null tier forces a null division and lp.
    const parsed = companionRankPayloadSchema.parse({
      puuid: PUUID_A,
      tier: '',
      division: 'NA',
      lp: 0,
      losses: 41,
    });
    expect(parsed).toEqual({
      puuid: PUUID_A,
      tier: null,
      division: null,
      lp: null,
      queue: 'RANKED_SOLO_5x5',
      // The name pair rides along with the rank (M2.4) and is null when the sweep did not
      // look one up. Always present in the output, so ingest never has to check for the key.
      gameName: null,
      tagLine: null,
    });
    expect('losses' in parsed).toBe(false);
  });

  it('carries the Riot ID the name sweep looked up, and trims an empty one to null', () => {
    // One POST per puuid carries both the rank and the name, because a lobby member has no
    // Riot ID at all on 16.17 and the sweep visits exactly those PUUIDs (M2.4).
    const parsed = companionRankPayloadSchema.parse({
      puuid: PUUID_A,
      tier: 'SILVER',
      division: 'II',
      gameName: '  XETA  ',
      tagLine: 'EUNE',
    });
    expect(parsed).toMatchObject({ gameName: 'XETA', tagLine: 'EUNE' });

    const blank = companionRankPayloadSchema.parse({ puuid: PUUID_A, gameName: '', tagLine: '' });
    expect(blank).toMatchObject({ gameName: null, tagLine: null });
  });

  it('rejects a missing puuid and a negative lp', () => {
    expect(companionRankPayloadSchema.safeParse({ tier: 'GOLD' }).success).toBe(false);
    expect(companionRankPayloadSchema.safeParse({ puuid: PUUID_A, lp: -1 }).success).toBe(false);
  });
});

describe('companionLobbyResponseSchema', () => {
  const answer = {
    ok: true as const,
    lobbyId: '0c3f8b3a-5f4a-4a5c-9a0e-4f0a2e1d7b11',
    status: 'open' as const,
    created: true,
    memberCount: 10,
    rosterFrozen: false,
    recheckInMs: null,
    ranksNeeded: [],
  };

  it('carries the two fields the companion acts on, and neither is optional', () => {
    // A companion that cannot see `recheckInMs` never knocks again and the ten-second
    // stability window is never observed (M2.2/M2.5); one that cannot see `ranksNeeded` never
    // fetches a rank (M2.4). Both are required so a route cannot forget them.
    expect(companionLobbyResponseSchema.parse(answer)).toEqual(answer);

    const { recheckInMs, ...withoutRecheck } = answer;
    expect(companionLobbyResponseSchema.safeParse(withoutRecheck).success).toBe(false);
    const { ranksNeeded, ...withoutRanks } = answer;
    expect(companionLobbyResponseSchema.safeParse(withoutRanks).success).toBe(false);
  });

  it('takes a knock in milliseconds and a list of puuids', () => {
    const parsed = companionLobbyResponseSchema.parse({
      ...answer,
      recheckInMs: 7_000,
      ranksNeeded: [PUUID_A, PUUID_B],
    });

    expect(parsed.recheckInMs).toBe(7_000);
    expect(parsed.ranksNeeded).toEqual([PUUID_A, PUUID_B]);
  });

  it('refuses a negative delay and an empty puuid', () => {
    expect(companionLobbyResponseSchema.safeParse({ ...answer, recheckInMs: -1 }).success).toBe(false);
    expect(companionLobbyResponseSchema.safeParse({ ...answer, ranksNeeded: [''] }).success).toBe(false);
  });
});

describe('companionMeResponseSchema', () => {
  it('is the identity the token carries, and a display name that may be missing', () => {
    const parsed = companionMeResponseSchema.parse({
      ok: true,
      puuid: PUUID_A,
      playerId: '0c3f8b3a-5f4a-4a5c-9a0e-4f0a2e1d7b11',
      displayName: null,
    });

    expect(parsed).toMatchObject({ puuid: PUUID_A, displayName: null });
    // `ok: false` is the error envelope's shape, never this one's.
    expect(companionMeResponseSchema.safeParse({ ...parsed, ok: false }).success).toBe(false);
  });
});

describe('roleFromDetectedTeamPosition', () => {
  it('maps the five positions the client reports', () => {
    // The eog block's own vocabulary. `BOTTOM` is our `adc` and `UTILITY` is our `support`;
    // getting either backwards would put every marksman on the support line of the embed.
    expect(roleFromDetectedTeamPosition('TOP')).toBe('top');
    expect(roleFromDetectedTeamPosition('JUNGLE')).toBe('jungle');
    expect(roleFromDetectedTeamPosition('MIDDLE')).toBe('mid');
    expect(roleFromDetectedTeamPosition('BOTTOM')).toBe('adc');
    expect(roleFromDetectedTeamPosition('UTILITY')).toBe('support');
    // The published table is the only copy; the mapper in packages/lcu imports it.
    expect(Object.keys(DETECTED_TEAM_POSITION_ROLES)).toEqual([
      'TOP',
      'JUNGLE',
      'MIDDLE',
      'BOTTOM',
      'UTILITY',
    ]);
  });

  it('is null for everything else, and never guesses', () => {
    // `role` is nullable everywhere for exactly this reason (M2.10, point 7). A role is never
    // inferred from the champion: a Teemo in the jungle is a Teemo in the jungle.
    for (const position of ['', 'NONE', 'BOT', 'SUPPORT', 'ADC', 'unknown-to-us']) {
      expect(roleFromDetectedTeamPosition(position)).toBeNull();
    }
    expect(roleFromDetectedTeamPosition(null)).toBeNull();
    expect(roleFromDetectedTeamPosition(undefined)).toBeNull();
  });

  it('tolerates the casing and padding a client patch might add', () => {
    expect(roleFromDetectedTeamPosition(' middle ')).toBe('mid');
    expect(roleFromDetectedTeamPosition('Utility')).toBe('support');
  });
});
