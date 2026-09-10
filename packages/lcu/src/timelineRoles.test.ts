/**
 * M5.18: the `timeline.lane` / `timeline.role` table, and the cross-check it is built from, against the 16.17
 * fixtures. The first block is the acceptance check itself and grows with the fixtures: when a night's details
 * and end-of-game blocks land under `fixtures/<patch>/`, "zero mismatches" is what keeps a row in
 * `MATCH_TIMELINE_ROLES`, and the literal expectations below say what the evidence looked like when the table
 * was last touched (update them together).
 */

import { roleFromDetectedTeamPosition } from '@customs/db/schemas';
import { describe, expect, it } from 'vitest';
import { readFixture } from './fixtures.js';
import { mapMatchDetail } from './mapper.js';
import { type EogStatsBlock, MatchDetailSchema, type MatchGame } from './schemas.js';
import {
  crossCheckTimelineRoles,
  formatTimelineConfusion,
  MATCH_TIMELINE_ROLES,
  matchTimelineKey,
  readTimelineEvidence,
  roleFromMatchTimeline,
  timelinePairsSeen,
} from './timelineRoles.js';

const PATCH = '16.17';

/** Every pair the 16.17 fixtures carry, and the (lane, role) vocabulary they are made of. */
const PAIRS_SEEN_16_17 = [
  'BOTTOM+CARRY',
  'BOTTOM+SOLO',
  'BOTTOM+SUPPORT',
  'JUNGLE+NONE',
  'MIDDLE+DUO',
  'MIDDLE+SOLO',
  'MIDDLE+SUPPORT',
  'NONE+DUO',
  'NONE+SOLO',
  'NONE+SUPPORT',
  'TOP+DUO',
  'TOP+SOLO',
  'TOP+SUPPORT',
];

/** The pairs whose plain reading a fixture already contradicts; they must never be mapped on this evidence. */
const REFUTED_16_17 = ['JUNGLE+NONE', 'TOP+SOLO'];

/** The pairs nobody could read a role from even in principle. */
const AMBIGUOUS = [
  'BOTTOM+SOLO',
  'BOTTOM+DUO',
  'NONE+NONE',
  'NONE+SOLO',
  'NONE+SUPPORT',
  'NONE+DUO',
  'MIDDLE+DUO',
  'TOP+DUO',
];

describe('the cross-check against the fixtures (acceptance check 1)', () => {
  const evidence = readTimelineEvidence(PATCH);
  const check = crossCheckTimelineRoles(evidence.games, evidence.blocks);

  it('reads the detail, both lists, the eog GET and the eog WebSocket events', () => {
    expect(evidence.files).toEqual([
      'eog-stats-block.json',
      'match-detail.json',
      'match-history--other.json',
      'match-history.json',
      'ws-events.ndjson',
    ]);
    expect(new Set(evidence.games.map((game) => game.gameId)).size).toBe(42);
    expect(new Set(evidence.blocks.map((block) => block.gameId))).toEqual(
      new Set([4_000_965_483, 4_000_969_091]),
    );
  });

  it('no mapped pair ever disagrees with a live detectedTeamPosition', () => {
    for (const row of check.rows) {
      expect(row.disagreed, `${row.pair} is in MATCH_TIMELINE_ROLES but a live capture said otherwise`).toBe(
        0,
      );
    }
    for (const observation of check.observations) {
      const mapped = roleFromMatchTimeline({
        lane: observation.pair.split('+')[0],
        role: observation.pair.split('+')[1],
      });
      expect(mapped === null || mapped === roleFromDetectedTeamPosition(observation.position)).toBe(true);
    }
  });

  it('16.17: the only overlapping game is the aborted one, one participant, NONE+SOLO against MIDDLE', () => {
    expect(check.overlappingGameIds).toEqual([4_000_965_483]);
    expect(check.observations).toEqual([
      {
        gameId: 4_000_965_483,
        puuid: '34151cbd-d9f8-5dad-9dc8-c6a8e253c0de',
        pair: 'NONE+SOLO',
        position: 'MIDDLE',
      },
    ]);
    expect(check.rows).toEqual([
      { pair: 'NONE+SOLO', positions: { MIDDLE: 1 }, total: 1, mapped: null, agreed: 0, disagreed: 0 },
    ]);
    expect(formatTimelineConfusion(check.rows)).toBe(
      [
        '| pair | live `detectedTeamPosition` (count) | mapped to | agreed | disagreed |',
        '|---|---|---|---|---|',
        '| `NONE+SOLO` | MIDDLE 1 | null | - | - |',
      ].join('\n'),
    );
  });

  it('16.17: every pair seen is in the documented list, and the table maps none of them yet', () => {
    expect(Object.keys(check.pairsSeen).sort()).toEqual(PAIRS_SEEN_16_17);
    expect(check.pairsSeen).toMatchObject({ 'JUNGLE+NONE': 9, 'MIDDLE+SOLO': 8, 'NONE+SUPPORT': 15 });
    expect(MATCH_TIMELINE_ROLES).toEqual({});
  });

  it('the full 5v5 detail carries the evidence against JUNGLE+NONE and TOP+SOLO', () => {
    const read = readFixture(PATCH, 'match-detail');
    if (!read.ok) throw new Error(read.reason);
    const detail = MatchDetailSchema.parse(read.envelope.body);
    const SMITE = 11;
    const byPair = (pair: string) =>
      detail.participants.filter(
        (participant) => matchTimelineKey(participant.timeline?.lane, participant.timeline?.role) === pair,
      );

    // Four participants labelled JUNGLE+NONE; only the two with Smite farmed the jungle.
    const junglers = byPair('JUNGLE+NONE');
    expect(junglers).toHaveLength(4);
    const withSmite = junglers.filter((p) => p.spell1Id === SMITE || p.spell2Id === SMITE);
    const withoutSmite = junglers.filter((p) => p.spell1Id !== SMITE && p.spell2Id !== SMITE);
    expect(withSmite.map((p) => p.stats.neutralMinionsKilled).sort()).toEqual([127, 247]);
    expect(withoutSmite.map((p) => p.stats.neutralMinionsKilled).sort()).toEqual([1, 4]);
    expect(withoutSmite.map((p) => p.stats.totalMinionsKilled).sort()).toEqual([244, 277]);

    // One participant labelled TOP+SOLO: 76 lane minions and 40 wards in a 49-minute game.
    const top = byPair('TOP+SOLO');
    expect(top).toHaveLength(1);
    expect(top[0]?.stats.totalMinionsKilled).toBe(76);
    expect(top[0]?.stats.wardsPlaced).toBe(40);
    expect(detail.gameDuration).toBe(2936);

    // Each team has two JUNGLE+NONE rows and team 100 has no TOP at all.
    const lanes = (teamId: number) =>
      detail.participants
        .filter((p) => p.teamId === teamId)
        .map((p) => p.timeline?.lane)
        .sort();
    expect(lanes(100)).toEqual(['BOTTOM', 'BOTTOM', 'JUNGLE', 'JUNGLE', 'MIDDLE']);
    expect(lanes(200)).toEqual(['BOTTOM', 'JUNGLE', 'JUNGLE', 'MIDDLE', 'TOP']);
  });
});

describe('roleFromMatchTimeline', () => {
  it('maps every row of the table (one case per mapped pair)', () => {
    for (const [pair, role] of Object.entries(MATCH_TIMELINE_ROLES)) {
      const [lane, roleName] = pair.split('+');
      expect(roleFromMatchTimeline({ lane, role: roleName }), pair).toBe(role);
      expect(REFUTED_16_17, `${pair} is refuted by the 16.17 detail fixture`).not.toContain(pair);
      expect(AMBIGUOUS, `${pair} cannot be read as one role`).not.toContain(pair);
    }
  });

  it('leaves the refuted pairs null', () => {
    for (const pair of REFUTED_16_17) {
      const [lane, role] = pair.split('+');
      expect(roleFromMatchTimeline({ lane, role }), pair).toBeNull();
    }
  });

  it('leaves the ambiguous pairs null', () => {
    for (const pair of AMBIGUOUS) {
      const [lane, role] = pair.split('+');
      expect(roleFromMatchTimeline({ lane, role }), pair).toBeNull();
    }
  });

  it('leaves the bottom-lane pairs null until a live 5v5 capture proves them', () => {
    expect(roleFromMatchTimeline({ lane: 'BOTTOM', role: 'CARRY' })).toBeNull();
    expect(roleFromMatchTimeline({ lane: 'BOTTOM', role: 'SUPPORT' })).toBeNull();
    expect(roleFromMatchTimeline({ lane: 'BOTTOM', role: 'DUO_CARRY' })).toBeNull();
    expect(roleFromMatchTimeline({ lane: 'BOTTOM', role: 'DUO_SUPPORT' })).toBeNull();
  });

  it('is null for a missing timeline, a missing half, an unknown value, and never throws', () => {
    expect(roleFromMatchTimeline(undefined)).toBeNull();
    expect(roleFromMatchTimeline({})).toBeNull();
    expect(roleFromMatchTimeline({ lane: 'TOP' })).toBeNull();
    expect(roleFromMatchTimeline({ role: 'SOLO' })).toBeNull();
    expect(roleFromMatchTimeline({ lane: 'MOON', role: 'SOLO' })).toBeNull();
    expect(roleFromMatchTimeline({ lane: '', role: '' })).toBeNull();
  });

  it('keys are upper-cased and trimmed, a missing half is empty', () => {
    expect(matchTimelineKey(' middle ', 'solo')).toBe('MIDDLE+SOLO');
    expect(matchTimelineKey(undefined, 'SOLO')).toBe('+SOLO');
    expect(matchTimelineKey('TOP', undefined)).toBe('TOP+');
    expect(matchTimelineKey(undefined, undefined)).toBe('+');
  });
});

describe('crossCheckTimelineRoles on synthetic input', () => {
  const human = (n: number) => `puuid-${n}`;
  const game = (gameId: number, rows: readonly { n: number; lane: string; role: string }[]): MatchGame => ({
    gameId,
    gameType: 'CUSTOM_GAME',
    queueId: 3110,
    gameMode: 'CLASSIC',
    mapId: 11,
    gameCreation: 0,
    gameDuration: 1800,
    platformId: 'EUN1',
    participants: rows.map((row) => ({
      participantId: row.n,
      teamId: row.n <= 5 ? 100 : 200,
      championId: 1,
      stats: {
        participantId: row.n,
        win: row.n <= 5,
        kills: 0,
        deaths: 0,
        assists: 0,
        goldEarned: 0,
        totalDamageDealtToChampions: 0,
        totalMinionsKilled: 0,
        neutralMinionsKilled: 0,
        champLevel: 1,
      },
      timeline: { lane: row.lane, role: row.role },
    })),
    participantIdentities: rows.map((row) => ({
      participantId: row.n,
      player: { puuid: human(row.n), summonerId: row.n, gameName: `p${row.n}`, tagLine: 'T' },
    })),
    teams: [
      { teamId: 100, win: 'Win' },
      { teamId: 200, win: 'Fail' },
    ],
  });
  const block = (
    gameId: number,
    rows: readonly { n: number; position: string; bot?: boolean }[],
  ): EogStatsBlock =>
    ({
      gameId,
      gameLength: 1800,
      gameType: 'CUSTOM_GAME',
      teams: [
        {
          teamId: 100,
          isWinningTeam: true,
          players: rows.map((row) => ({
            puuid: row.bot ? '00000000-0000-0000-0000-000000000000' : human(row.n),
            summonerId: row.n,
            championId: 1,
            teamId: 100,
            botPlayer: row.bot ?? false,
            detectedTeamPosition: row.position,
            stats: {},
          })),
        },
      ],
    }) as unknown as EogStatsBlock;

  it('joins on gameId and puuid, counts each participant once, drops bots, and sorts pairs', () => {
    const games = [
      game(1, [
        { n: 1, lane: 'MIDDLE', role: 'SOLO' },
        { n: 2, lane: 'JUNGLE', role: 'NONE' },
        { n: 3, lane: 'BOTTOM', role: 'CARRY' },
      ]),
      // The list entry of the same game: the local player again, must not double-count.
      game(1, [{ n: 1, lane: 'MIDDLE', role: 'SOLO' }]),
      game(2, [{ n: 1, lane: 'TOP', role: 'SOLO' }]),
    ];
    const blocks = [
      block(1, [
        { n: 1, position: 'MIDDLE' },
        { n: 2, position: 'TOP' },
        { n: 9, position: 'BOTTOM', bot: true },
      ]),
      // A second block for game 1 (the Update after the Create) changes nothing.
      block(1, [{ n: 1, position: 'JUNGLE' }]),
    ];
    const check = crossCheckTimelineRoles(games, blocks);
    expect(check.overlappingGameIds).toEqual([1]);
    expect(check.observations).toEqual([
      { gameId: 1, puuid: 'puuid-1', pair: 'MIDDLE+SOLO', position: 'MIDDLE' },
      { gameId: 1, puuid: 'puuid-2', pair: 'JUNGLE+NONE', position: 'TOP' },
    ]);
    expect(check.rows.map((row) => row.pair)).toEqual(['JUNGLE+NONE', 'MIDDLE+SOLO']);
    expect(check.rows[0]).toEqual({
      pair: 'JUNGLE+NONE',
      positions: { TOP: 1 },
      total: 1,
      mapped: null,
      agreed: 0,
      disagreed: 0,
    });
    expect(check.pairsSeen).toEqual({ 'MIDDLE+SOLO': 2, 'JUNGLE+NONE': 1, 'BOTTOM+CARRY': 1, 'TOP+SOLO': 1 });
    expect(timelinePairsSeen(games)).toEqual(check.pairsSeen);
  });

  it('a block with no detectedTeamPosition records an empty position, shown as (empty)', () => {
    const check = crossCheckTimelineRoles(
      [game(1, [{ n: 1, lane: 'MIDDLE', role: 'SOLO' }])],
      [block(1, [{ n: 1, position: '' }])],
    );
    expect(check.rows[0]?.positions).toEqual({ '': 1 });
    expect(formatTimelineConfusion(check.rows)).toContain('| `MIDDLE+SOLO` | (empty) 1 | null | - | - |');
  });
});

describe('mapMatchDetail carries the table through (acceptance check 2)', () => {
  const read = readFixture(PATCH, 'match-detail');
  if (!read.ok) throw new Error(read.reason);
  const detail = MatchDetailSchema.parse(read.envelope.body);

  it('gives every participant roleFromMatchTimeline of its own timeline', () => {
    const payload = mapMatchDetail(detail);
    detail.participants.forEach((participant, index) => {
      expect(payload.participants[index]?.role).toBe(roleFromMatchTimeline(participant.timeline));
    });
  });

  it('reports each unmapped participant once, with the values as the client spelled them', () => {
    const reported: string[] = [];
    mapMatchDetail(detail, {
      onUnmappedRole: (pair) => reported.push(`${pair.lane}/${pair.role}=${pair.key}`),
    });
    const unmapped = detail.participants.filter((p) => roleFromMatchTimeline(p.timeline) === null);
    expect(reported).toHaveLength(unmapped.length);
    expect(reported[0]).toBe('JUNGLE/NONE=JUNGLE+NONE');
    expect(new Set(reported)).toEqual(
      new Set(
        unmapped.map(
          (p) =>
            `${p.timeline?.lane}/${p.timeline?.role}=${matchTimelineKey(p.timeline?.lane, p.timeline?.role)}`,
        ),
      ),
    );
  });

  it('reports a participant with no timeline as null/null and the empty key', () => {
    const reported: { lane: string | null; role: string | null; key: string }[] = [];
    const stripped = {
      ...detail,
      participants: detail.participants.map((p, index) => (index === 0 ? { ...p, timeline: undefined } : p)),
    };
    mapMatchDetail(stripped, { onUnmappedRole: (pair) => reported.push(pair) });
    expect(reported[0]).toEqual({ lane: null, role: null, key: '+' });
  });
});
