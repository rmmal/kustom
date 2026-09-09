/**
 * The mapper against the 16.17 fixtures. The expected objects below are copied literally from
 * `packages/db/src/schemas/companion.contract.test.ts` (the specification): if the two ever disagree, the
 * contract test is right and this file and `mapper.ts` change together.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  companionGamePayloadSchema,
  companionLobbyPayloadSchema,
  companionRankPayloadSchema,
} from '@customs/db/schemas';
import { describe, expect, it } from 'vitest';
import { FIXTURES_DIR, readFixture } from './fixtures.js';
import {
  isEogBot,
  isLobbyBot,
  mapEog,
  mapLobby,
  mapMatchDetail,
  mapRank,
  matchDetailWinningSide,
  nameFromSummoner,
} from './mapper.js';
import {
  type EogStatsBlock,
  EogStatsBlockSchema,
  type Lobby,
  LobbySchema,
  type MatchDetail,
  MatchDetailSchema,
  MatchHistoryListSchema,
  RankedStatsSchema,
  SummonerSchema,
} from './schemas.js';
import { REDACTED } from './scrub.js';

const PATCH = '16.17';

function body(id: string): unknown {
  const read = readFixture(PATCH, id);
  if (!read.ok) {
    throw new Error(read.reason);
  }
  return read.envelope.body;
}

const lobbyFixture = (id: string): Lobby => LobbySchema.parse(body(id));

interface RecordedLine {
  ts: string;
  uri?: string;
  eventType?: 'Create' | 'Update' | 'Delete';
  data?: unknown;
  redacted?: boolean;
  dropped?: boolean;
}

function recordedEvents(uri: string): RecordedLine[] {
  const text = readFileSync(join(FIXTURES_DIR, PATCH, 'ws-events.ndjson'), 'utf8');
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as RecordedLine)
    .filter((line) => line.dropped !== true && line.uri === uri);
}

function wsEogBlock(gameId: number): EogStatsBlock {
  for (const line of recordedEvents('/lol-end-of-game/v1/eog-stats-block')) {
    if (line.eventType !== 'Create') continue;
    const parsed = EogStatsBlockSchema.safeParse(line.data);
    if (parsed.success && parsed.data.gameId === gameId) return parsed.data;
  }
  throw new Error(`no eog Create event for game ${gameId}`);
}

const PARTY = 'e3c69392-a134-43cb-97ae-8add18c72494';
const LEADER = '34151cbd-d9f8-5dad-9dc8-c6a8e253c0de';
const FRIEND = 'c04e977c-133a-5d94-9fd3-6202f8beec4c';

describe('mapLobby against the 16.17 lobby fixtures', () => {
  it('lobby.json: one member, side 100, not a spectator, the lobby name, no password', () => {
    const payload = mapLobby(lobbyFixture('lobby'));

    expect(payload).toEqual({
      partyId: PARTY,
      lobbyName: "PRT Empty's Game",
      lobbyPassword: null,
      members: [
        { puuid: LEADER, summonerId: 47890856, gameName: null, tagLine: null, side: 100, isSpectator: false },
      ],
    });
    const parsed = companionLobbyPayloadSchema.parse(payload);
    expect(parsed.members[0]?.summonerId).toBe('47890856');
    expect(parsed.droppedMembers).toBe(0);
  });

  it('lobby--two-players.json: two members, one on each side, neither a spectator (the contract literal)', () => {
    const parsed = companionLobbyPayloadSchema.parse(mapLobby(lobbyFixture('lobby--two-players')));

    expect(parsed.partyId).toBe(PARTY);
    expect(parsed.lobbyName).toBe("PRT Empty's Game");
    expect(parsed.lobbyPassword).toBeNull();
    expect(parsed.members).toEqual([
      { puuid: LEADER, summonerId: '47890856', gameName: null, tagLine: null, side: 100, isSpectator: false },
      { puuid: FRIEND, summonerId: '53574489', gameName: null, tagLine: null, side: 200, isSpectator: false },
    ]);
  });

  it('lobby--spectator.json: the spectator is side null + isSpectator true and stays in the roster', () => {
    const parsed = companionLobbyPayloadSchema.parse(mapLobby(lobbyFixture('lobby--spectator')));

    expect(parsed.members).toEqual([
      { puuid: LEADER, summonerId: '47890856', gameName: null, tagLine: null, side: 100, isSpectator: false },
      { puuid: FRIEND, summonerId: '53574489', gameName: null, tagLine: null, side: null, isSpectator: true },
    ]);
  });

  it('never reads teamId: every member is 0 in every fixture and the sides still come out', () => {
    for (const id of ['lobby', 'lobby--two-players', 'lobby--spectator']) {
      const lobby = lobbyFixture(id);
      expect(lobby.members.every((member) => member.teamId === 0)).toBe(true);
      const payload = mapLobby(lobby);
      expect(payload.members.some((member) => member.side !== null)).toBe(true);
    }
  });

  it('carries a name it already had and posts null for the rest, never waiting', () => {
    const names = new Map([[LEADER, { gameName: 'PRT Empty', tagLine: 'EUNE' }]]);
    const payload = mapLobby(lobbyFixture('lobby--two-players'), names);

    expect(payload.members[0]).toMatchObject({ gameName: 'PRT Empty', tagLine: 'EUNE' });
    expect(payload.members[1]).toMatchObject({ gameName: null, tagLine: null });
  });

  it('drops a bot in members[] and a bot puuid in a team array, and keeps the local player (check 5)', () => {
    const base = lobbyFixture('lobby');
    const bot = {
      ...base.members[0],
      puuid: '',
      summonerId: 0,
      isBot: true,
      botChampionId: 1,
    } as Lobby['members'][number];
    const lobby: Lobby = {
      ...base,
      members: [...base.members, bot],
      gameConfig: { ...base.gameConfig, customTeam100: [...base.gameConfig.customTeam100, bot] },
    };

    const payload = mapLobby(lobby);
    expect(payload.members.map((member) => member.puuid)).toEqual([LEADER]);
    expect(companionLobbyPayloadSchema.parse(payload).members).toHaveLength(1);
    expect(isLobbyBot(bot)).toBe(true);
    expect(isLobbyBot({ isBot: false, puuid: '00000000-0000-0000-0000-000000000000' })).toBe(true);
    expect(isLobbyBot({ isBot: false, puuid: LEADER })).toBe(false);
  });

  it('marks a member as spectator from customSpectators even when the member flag disagrees', () => {
    const base = lobbyFixture('lobby--spectator');
    const lobby: Lobby = {
      ...base,
      members: base.members.map((member) => ({ ...member, isSpectator: false })),
    };
    expect(mapLobby(lobby).members[1]).toMatchObject({ side: null, isSpectator: true });
  });

  it('gives side null to a member the client has not placed, and lobbyName null when absent', () => {
    const base = lobbyFixture('lobby');
    const lobby: Lobby = {
      ...base,
      gameConfig: {
        ...base.gameConfig,
        customLobbyName: undefined,
        customTeam100: [],
        customSpectators: undefined,
      },
    };
    expect(mapLobby(lobby)).toEqual({
      partyId: PARTY,
      lobbyName: null,
      lobbyPassword: null,
      members: [
        {
          puuid: LEADER,
          summonerId: 47890856,
          gameName: null,
          tagLine: null,
          side: null,
          isSpectator: false,
        },
      ],
    });
  });

  it('maps every recorded /lol-lobby/v2/lobby event to a payload the wire schema accepts (check 1)', () => {
    const events = recordedEvents('/lol-lobby/v2/lobby');
    const deletes = events.filter((event) => event.eventType === 'Delete');
    expect(events.length).toBeGreaterThan(40);
    expect(deletes).toHaveLength(2);
    expect(deletes.every((event) => event.data === null)).toBe(true);

    let mapped = 0;
    for (const event of events) {
      if (event.eventType === 'Delete') continue;
      const lobby = LobbySchema.parse(event.data);
      const parsed = companionLobbyPayloadSchema.parse(mapLobby(lobby));
      expect(parsed.partyId.length).toBeGreaterThan(0);
      expect(parsed.droppedMembers).toBe(0);
      // Every human in members[] got a side or a spectator flag, from that event alone.
      for (const member of parsed.members) {
        expect(
          member.side !== null || member.isSpectator || lobby.gameConfig.customTeam100.length === 0,
        ).toBe(true);
      }
      mapped += 1;
    }
    expect(mapped).toBe(events.length - 2);
  });

  it('reads current-summoner into the name cache shape, folding empty strings to null', () => {
    const summoner = SummonerSchema.parse(body('current-summoner'));
    expect(nameFromSummoner(summoner)).toEqual({ gameName: 'PRT Empty', tagLine: 'EUNE' });
    expect(nameFromSummoner({ gameName: '', tagLine: '' })).toEqual({ gameName: null, tagLine: null });
  });
});

describe('mapEog against fixtures/16.17/eog-stats-block.json', () => {
  const block = EogStatsBlockSchema.parse(body('eog-stats-block'));

  it('produces the contract literal: one human, bots dropped, derived startedAt', () => {
    const payload = mapEog(block, { partyId: PARTY });

    expect(block.teams.flatMap((team) => team.players)).toHaveLength(6);
    expect(payload).toMatchObject({
      phase: 'eog',
      gameId: 4_000_969_091,
      partyId: PARTY,
      gameType: 'CUSTOM_GAME',
      startedAt: '2026-09-08T16:37:47.672Z',
      durationS: 913,
      winningSide: 200,
    });
    expect(payload.participants).toEqual([
      {
        puuid: LEADER,
        side: 100,
        role: 'jungle',
        championId: 266,
        kills: 0,
        deaths: 1,
        assists: 0,
        gold: 2242,
        damageToChamps: 108,
        cs: 1,
        win: false,
        gameName: 'PRT Empty',
        tagLine: 'EUNE',
        summonerId: 47890856,
      },
    ]);

    const parsed = companionGamePayloadSchema.parse(payload);
    if (parsed.phase !== 'eog') throw new Error('unreachable');
    expect(parsed.participants).toHaveLength(1);
    expect(parsed.participants[0]).toMatchObject({ summonerId: '47890856', win: false });
    expect(parsed.winningSide).toBe(200);
    expect(Date.parse(parsed.startedAt)).toBe(1_788_885_467_672);
  });

  it('prefers the InProgress moment the companion observed', () => {
    const observed = '2026-09-08T16:37:40.000Z';
    expect(mapEog(block, { startedAt: observed }).startedAt).toBe(observed);
    expect(mapEog(block).partyId).toBeNull();
  });

  it('sums cs from both minion keys: the bot jungler has 0 + 64', () => {
    const jungler = block.teams
      .flatMap((team) => team.players)
      .find((player) => player.botPlayer && player.detectedTeamPosition === 'JUNGLE');
    expect(jungler?.stats.MINIONS_KILLED).toBe(0);
    expect(jungler?.stats.NEUTRAL_MINIONS_KILLED).toBe(64);

    // Run the same line through the mapper by pretending it is human.
    const humanised: EogStatsBlock = {
      ...block,
      teams: block.teams.map((team) => ({
        ...team,
        players: team.players.map((player) =>
          player === jungler ? { ...player, botPlayer: false, puuid: 'jungler-puuid' } : player,
        ),
      })),
    };
    const mapped = mapEog(humanised).participants.find(
      (participant) => participant.puuid === 'jungler-puuid',
    );
    expect(mapped).toMatchObject({ cs: 64, role: 'jungle', side: 200, win: true });
  });

  it('maps an unknown or empty detectedTeamPosition to null and a missing stat to 0', () => {
    const odd: EogStatsBlock = {
      ...block,
      teams: block.teams.map((team) => ({
        ...team,
        players: team.players.map((player) => ({
          ...player,
          detectedTeamPosition: '',
          stats: { ...player.stats, ASSISTS: undefined as unknown as number },
        })),
      })),
    };
    expect(mapEog(odd).participants[0]).toMatchObject({ role: null, assists: 0 });
    expect(isEogBot({ botPlayer: false, puuid: '00000000-0000-0000-0000-000000000000' })).toBe(true);
    expect(isEogBot({ botPlayer: true, puuid: LEADER })).toBe(true);
  });

  it('falls back to now minus gameLength only when the block has no endOfGameTimestamp', () => {
    const { endOfGameTimestamp: _dropped, ...rest } = block;
    const now = 1_788_886_380_672;
    expect(mapEog(rest as EogStatsBlock, { now: () => now }).startedAt).toBe('2026-09-08T16:37:47.672Z');
  });

  it('scrubs the chat credentials out of raw and keeps everything else', () => {
    const leaky = { ...block, mucJwtDto: { jwt: 'live-jwt' }, multiUserChatPassword: 'live-password' };
    const raw = mapEog(leaky as EogStatsBlock).raw;
    expect(raw.mucJwtDto).toBe(REDACTED);
    expect(raw.multiUserChatPassword).toBe(REDACTED);
    expect(JSON.stringify(raw)).not.toContain('live-jwt');
    expect(JSON.stringify(raw)).not.toContain('live-password');
    expect(raw.gameId).toBe(4_000_969_091);
    expect(raw.teams).toEqual(block.teams);
  });

  it('maps the real terminated block: no winner, one participant, derived start (the contract literal)', () => {
    const terminated = wsEogBlock(4_000_965_483);
    expect(terminated.gameType).toBe('CUSTOM_GAME');
    expect(terminated.teams.map((team) => [team.teamId, team.isWinningTeam])).toEqual([[100, false]]);

    const payload = mapEog(terminated);
    expect(payload).toMatchObject({
      phase: 'eog',
      gameId: 4_000_965_483,
      gameType: 'CUSTOM_GAME',
      startedAt: '2026-09-08T16:34:35.209Z',
      durationS: 100,
      winningSide: null,
    });
    expect(payload.participants).toHaveLength(1);
    // It still parses; the API is what refuses it (422), and M2.3 does not post it at all.
    const parsed = companionGamePayloadSchema.parse(payload);
    if (parsed.phase !== 'eog') throw new Error('unreachable');
    expect(parsed.winningSide).toBeNull();
  });
});

describe('mapRank against fixtures/16.17/ranked-stats-by-puuid--other.json', () => {
  const stats = RankedStatsSchema.parse(body('ranked-stats-by-puuid--other'));
  const puuid = 'aebd7c57-83d8-551d-a7b2-7caa7e8b1960';

  it('produces the contract literal and never carries wins or losses', () => {
    const payload = mapRank(stats, puuid);
    expect(payload).toEqual({
      puuid,
      tier: 'SILVER',
      division: 'II',
      lp: 1,
      queue: 'RANKED_SOLO_5x5',
      gameName: null,
      tagLine: null,
    });
    expect('losses' in payload).toBe(false);
    expect('wins' in payload).toBe(false);
    expect(companionRankPayloadSchema.parse(payload)).toEqual(payload);
  });

  it('passes an unranked queue through verbatim and the wire schema folds it to null', () => {
    const payload = mapRank(stats, puuid, { queue: 'RANKED_PREMADE_5x5' });
    expect(payload).toMatchObject({ tier: '', division: 'NA', lp: 0, queue: 'RANKED_PREMADE_5x5' });
    expect(companionRankPayloadSchema.parse(payload)).toEqual({
      puuid,
      tier: null,
      division: null,
      lp: null,
      queue: 'RANKED_PREMADE_5x5',
      gameName: null,
      tagLine: null,
    });
  });

  it('sends nulls for a queue the client does not list', () => {
    expect(mapRank(stats, puuid, { queue: 'NO_SUCH_QUEUE' })).toMatchObject({
      tier: null,
      division: null,
      lp: null,
    });
  });

  it('carries the name from the summoner lookup for the same puuid', () => {
    const summoner = SummonerSchema.parse(body('summoner-by-puuid--other'));
    expect(summoner.puuid).toBe(puuid);
    const parsed = companionRankPayloadSchema.parse(
      mapRank(stats, puuid, { name: nameFromSummoner(summoner) }),
    );
    expect(parsed).toMatchObject({ tier: 'SILVER', gameName: 'XETA', tagLine: 'EUNE' });
  });

  it('reads the local player the same way from current-ranked-stats', () => {
    const own = RankedStatsSchema.parse(body('current-ranked-stats'));
    expect(companionRankPayloadSchema.parse(mapRank(own, LEADER))).toMatchObject({
      tier: 'SILVER',
      division: 'IV',
      lp: 30,
    });
  });
});

describe('mapMatchDetail against fixtures/16.17/match-detail.json (M5.1 backfill)', () => {
  const detail: MatchDetail = MatchDetailSchema.parse(body('match-detail'));
  const XETA = 'aebd7c57-83d8-551d-a7b2-7caa7e8b1960';

  it('maps game 4000769615: ten participants, side from teamId, winner from teams[].win, start from gameCreation', () => {
    const payload = mapMatchDetail(detail);

    expect(payload).toMatchObject({
      phase: 'eog',
      gameId: 4_000_769_615,
      source: 'backfill',
      gameType: 'CUSTOM_GAME',
      startedAt: '2026-09-07T22:59:03.159Z',
      durationS: 2936,
      winningSide: 200,
    });
    // A backfilled game belongs to no lobby: the key is absent, not null.
    expect('partyId' in payload).toBe(false);
    expect(payload.participants).toHaveLength(10);
    expect(payload.participants[0]).toEqual({
      puuid: XETA,
      side: 100,
      role: null,
      championId: 516,
      kills: 7,
      deaths: 10,
      assists: 19,
      gold: 17704,
      damageToChamps: 36779,
      cs: 245,
      win: false,
      gameName: 'XETA',
      tagLine: 'EUNE',
      summonerId: 52699007,
    });
    expect(payload.participants.map((participant) => participant.side)).toEqual([
      100, 100, 100, 100, 100, 200, 200, 200, 200, 200,
    ]);
    expect(payload.participants.every((participant) => participant.role === null)).toBe(true);
    expect(payload.participants.every((participant) => participant.gameName !== null)).toBe(true);
    expect(payload.participants.map((participant) => participant.win)).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
      true,
      true,
      true,
      true,
    ]);
    // The local player of the capture is on the red side, participant 8.
    expect(payload.participants[7]).toMatchObject({
      puuid: LEADER,
      side: 200,
      cs: 176,
      summonerId: 47890856,
    });

    const parsed = companionGamePayloadSchema.parse(payload);
    if (parsed.phase !== 'eog') throw new Error('unreachable');
    expect(parsed.source).toBe('backfill');
    expect(parsed.partyId).toBeUndefined();
    expect(parsed.participants).toHaveLength(10);
    expect(parsed.participants[0]).toMatchObject({ summonerId: '52699007', role: null, win: false });
    expect(parsed.winningSide).toBe(200);
    expect(Date.parse(parsed.startedAt)).toBe(detail.gameCreation);
    expect(parsed.durationS).toBe(detail.gameDuration);
  });

  it('keeps raw as the whole detail (nothing to scrub here, but scrubbing is idempotent)', () => {
    const payload = mapMatchDetail(detail);
    expect(payload.raw.gameId).toBe(4_000_769_615);
    expect((payload.raw.participants as unknown[]).length).toBe(10);
    expect(JSON.stringify(payload.raw)).not.toContain(REDACTED);
    expect(payload.raw).toEqual(JSON.parse(JSON.stringify(detail)));
  });

  it('reads the winner from teams[].win only: no Win, or two, is null', () => {
    expect(matchDetailWinningSide(detail)).toBe(200);
    expect(
      matchDetailWinningSide({ teams: detail.teams.map((team) => ({ ...team, win: 'Fail' })) }),
    ).toBeNull();
    expect(
      matchDetailWinningSide({ teams: detail.teams.map((team) => ({ ...team, win: 'Win' })) }),
    ).toBeNull();
    expect(matchDetailWinningSide({ teams: [] })).toBeNull();
  });

  it('the aborted list entry (4000965483, Abort_TooFewPlayers) has one team, no winner, one participant', () => {
    const list = MatchHistoryListSchema.parse(body('match-history'));
    const aborted = list.games.games.find((game) => game.gameId === 4_000_965_483);
    if (aborted === undefined) throw new Error('fixture changed');
    expect(aborted.endOfGameResult).toBe('Abort_TooFewPlayers');
    const payload = mapMatchDetail(aborted);
    expect(payload.winningSide).toBeNull();
    expect(payload.participants).toHaveLength(1);
  });

  it('drops a participant with no identity row or a placeholder puuid, and reads a missing stat as 0', () => {
    const identities = detail.participantIdentities.map((identity) =>
      identity.participantId === 3
        ? { ...identity, player: { ...identity.player, puuid: '00000000-0000-0000-0000-000000000000' } }
        : identity,
    );
    const participants = detail.participants.map((participant) => {
      if (participant.participantId !== 1) return participant;
      const { neutralMinionsKilled: _dropped, ...rest } = participant.stats;
      return { ...participant, stats: rest as MatchDetail['participants'][number]['stats'] };
    });
    const trimmed: MatchDetail = {
      ...detail,
      participants,
      participantIdentities: identities.filter((identity) => identity.participantId !== 10),
    };
    const payload = mapMatchDetail(trimmed);
    expect(payload.participants).toHaveLength(8);
    expect(payload.participants.map((participant) => participant.summonerId)).not.toContain(2836230018958496);
    expect(payload.participants[0]).toMatchObject({ puuid: XETA, cs: 244 });
  });

  it('parses through the same wire schema as the eog mapper, with every participant key in common', () => {
    const fromDetail = companionGamePayloadSchema.parse(mapMatchDetail(detail));
    const fromBlock = companionGamePayloadSchema.parse(
      mapEog(EogStatsBlockSchema.parse(body('eog-stats-block'))),
    );
    if (fromDetail.phase !== 'eog' || fromBlock.phase !== 'eog') throw new Error('unreachable');
    expect(Object.keys(fromDetail.participants[0] ?? {}).sort()).toEqual(
      Object.keys(fromBlock.participants[0] ?? {}).sort(),
    );
    expect(fromBlock.source).toBe('eog');
    expect(fromDetail.source).toBe('backfill');
  });
});
