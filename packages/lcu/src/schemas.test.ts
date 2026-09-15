/**
 * Every verified schema parsed against the real bodies captured on patch 16.17 (2026-09-08, macOS client).
 * See fixtures/README.md "Captures" for which client state each file was taken in: the smoke fixtures are
 * from the end-of-game screen of a solo custom vs bots, `lobby.json` from the custom lobby afterwards,
 * `match-detail.json` pinned to a completed 5v5 custom, `--other` files for a non-friend puuid, and
 * `ws-events.ndjson` covers two custom games from lobby to end of game (first window, 16:33-16:53 UTC) and,
 * appended, a friend accepting an invite into the post-game lobby (second window, 17:31-17:32 UTC) that
 * `lobby--two-players.json` and `gameflow-session--in-lobby.json` were taken in. Pinned to that directory on
 * purpose: a later capture is taken in whatever state the client is in and gets its own tests when re-verified.
 *
 * Fixtures only; nothing here reaches a live client.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURES_DIR, type FixtureEnvelope, patchFromVersion, readFixture } from './fixtures.js';
import {
  AliasLookupSchema,
  BOT_PUUID,
  CustomGameQueuesSchema,
  EogStatsBlockSchema,
  GameflowPhaseSchema,
  GameflowSessionSchema,
  GameQueuesSchema,
  GameVersionSchema,
  KNOWN_GAMEFLOW_PHASES,
  KNOWN_TIERS,
  LcuErrorSchema,
  LobbyInvitationSchema,
  LobbyMembersSchema,
  LobbySchema,
  MatchDetailSchema,
  MatchHistoryListSchema,
  MatchHistoryMinimalSchema,
  RankedStatsSchema,
  SummonerSchema,
  SystemBuildsSchema,
} from './schemas.js';

const PATCH = '16.17';

function fixture(id: string): FixtureEnvelope {
  const read = readFixture(PATCH, id);
  if (!read.ok) {
    throw new Error(`fixture ${PATCH}/${id}: ${read.reason}`);
  }
  return read.envelope;
}

interface RecordedLine {
  ts: string;
  uri: string;
  eventType: 'Create' | 'Update' | 'Delete';
  data?: unknown;
  redacted?: boolean;
  dropped?: boolean;
}

/**
 * `ws-events.ndjson` holds three recording windows (fixtures/README.md "Captures"): the first covers two
 * custom games solo vs bots, the second a friend joining the post-game lobby, the third that friend moved to
 * the spectator slot and back. Tests that count lobbies or games are pinned to one window; shape tests run
 * over all of them.
 */
type Window = 'first' | 'second' | 'third' | 'all';
const WINDOWS: Record<Exclude<Window, 'all'>, { from: string; to: string }> = {
  first: { from: '2026-09-08T16:00:00.000Z', to: '2026-09-08T17:00:00.000Z' },
  second: { from: '2026-09-08T17:30:00.000Z', to: '2026-09-08T17:35:00.000Z' },
  third: { from: '2026-09-08T17:38:00.000Z', to: '2026-09-08T17:40:00.000Z' },
};

function recordedEvents(window: Window = 'all'): RecordedLine[] {
  const text = readFileSync(join(FIXTURES_DIR, PATCH, 'ws-events.ndjson'), 'utf8');
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as RecordedLine)
    .filter((line) => line.dropped !== true)
    .filter((line) => {
      if (window === 'all') {
        return true;
      }
      const { from, to } = WINDOWS[window];
      return line.ts.localeCompare(from) >= 0 && line.ts.localeCompare(to) < 0;
    });
}

function eventsFor(uri: string, window: Window = 'all'): RecordedLine[] {
  return recordedEvents(window).filter((line) => line.uri === uri);
}

/** Non-bot puuids of a lobby member list. */
function humanPuuids(members: readonly { puuid: string; isBot: boolean }[]): string[] {
  return members.filter((member) => !member.isBot).map((member) => member.puuid);
}

describe(`schemas against fixtures/${PATCH}`, () => {
  it('game-version is a bare string whose major.minor names the fixture directory', () => {
    const envelope = fixture('game-version');
    expect(envelope.status).toBe(200);
    const version = GameVersionSchema.parse(envelope.body);
    expect(patchFromVersion(version)).toBe(PATCH);
    expect(envelope.clientVersion).toBe(version);
  });

  it('system-builds carries the short version', () => {
    const envelope = fixture('system-builds');
    expect(envelope.status).toBe(200);
    const builds = SystemBuildsSchema.parse(envelope.body);
    expect(builds.version).toMatch(/^16\.17\.\d+\.\d+$/);
    expect(patchFromVersion(builds.version)).toBe(PATCH);
  });

  it('current-summoner and summoner-by-puuid share the summoner shape', () => {
    const self = SummonerSchema.parse(fixture('current-summoner').body);
    expect(self.puuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(self.summonerId).toBeGreaterThan(0);
    expect(self.gameName.length).toBeGreaterThan(0);
    expect(self.tagLine.length).toBeGreaterThan(0);

    const byPuuid = SummonerSchema.parse(fixture('summoner-by-puuid').body);
    expect(byPuuid.puuid).toBe(self.puuid);
    expect(byPuuid.summonerId).toBe(self.summonerId);

    const other = SummonerSchema.parse(fixture('summoner-by-puuid--other').body);
    expect(other.puuid).not.toBe(self.puuid);
    expect(other.summonerId).toBeGreaterThan(0);
  });

  it('alias-lookup resolves the local Riot ID to the local puuid', () => {
    const self = SummonerSchema.parse(fixture('current-summoner').body);
    const alias = AliasLookupSchema.parse(fixture('alias-lookup').body);
    expect(alias.puuid).toBe(self.puuid);
    expect(alias.alias).toMatchObject({ gameName: self.gameName, tagLine: self.tagLine });
  });

  it('ranked stats parse for self, and ranked-stats/{puuid} returns real data for another player', () => {
    const self = RankedStatsSchema.parse(fixture('current-ranked-stats').body);
    const solo = self.queueMap.RANKED_SOLO_5x5;
    expect(solo).toBeDefined();
    expect(KNOWN_TIERS).toContain(solo?.tier);
    expect(solo?.queueType).toBe('RANKED_SOLO_5x5');
    expect(self.queueMap.RANKED_FLEX_SR?.queueType).toBe('RANKED_FLEX_SR');

    const same = RankedStatsSchema.parse(fixture('ranked-stats-by-puuid').body);
    expect(same.queueMap.RANKED_SOLO_5x5).toEqual(solo);

    const other = RankedStatsSchema.parse(fixture('ranked-stats-by-puuid--other').body);
    expect(other.queueMap.RANKED_SOLO_5x5?.tier).not.toBe('');
    expect(KNOWN_TIERS).toContain(other.queueMap.RANKED_SOLO_5x5?.tier);
    expect(other.queueMap.RANKED_SOLO_5x5?.wins).toBeGreaterThan(0);
  });

  it('gameflow-phase is a bare string from the known list', () => {
    const envelope = fixture('gameflow-phase');
    expect(envelope.status).toBe(200);
    const phase = GameflowPhaseSchema.parse(envelope.body);
    expect(KNOWN_GAMEFLOW_PHASES).toContain(phase);
  });

  it('gameflow-session carries the game id and custom flag on the end-of-game screen', () => {
    const envelope = fixture('gameflow-session');
    expect(envelope.status).toBe(200);
    const session = GameflowSessionSchema.parse(envelope.body);
    expect(session.phase).toBe('EndOfGame');
    expect(session.gameData.gameId).toBeGreaterThan(0);
    expect(session.gameData.isCustomGame).toBe(true);
    expect(session.gameData.queue.isCustom).toBe(true);
    expect(session.map.id).toBe(11);
    const self = SummonerSchema.parse(fixture('current-summoner').body);
    const members = [...session.gameData.teamOne, ...session.gameData.teamTwo];
    expect(members.map((member) => member.puuid)).toContain(self.puuid);
    // The body went through scrubValue like every fixture: the lobby password and spectator key are gone.
    const raw = envelope.body as { gameData: Record<string, unknown> };
    expect(raw.gameData.password).toBe('[redacted]');
    expect(raw.gameData.spectatorKey).toBe('[redacted]');
  });

  // The root .gitignore drops swagger-*.json / openapi-*.json (they are multi-MB when the client serves them),
  // so these envelopes exist only on the machine that ran the smoke script.
  it.skipIf(!readFixture(PATCH, 'swagger-v2').ok)(
    'the swagger paths answer 404 with the client error body',
    () => {
      const swagger = fixture('swagger-v2');
      expect(swagger.status).toBe(404);
      expect(LcuErrorSchema.parse(swagger.body).errorCode).toBe('RESOURCE_NOT_FOUND');
      const openapi = fixture('openapi-v3');
      expect(openapi.status).toBe(404);
      expect(LcuErrorSchema.parse(openapi.body).errorCode).toBe('RESOURCE_NOT_FOUND');
    },
  );

  // No committed fixture carries a 404 body (lobby and eog were captured as 200s), so the RPC error shape seen
  // on 16.17 for lobby (LOBBY_NOT_FOUND) and eog ("No end of game stats available.") is pinned as a literal.
  it('the RPC error body shape parses', () => {
    expect(
      LcuErrorSchema.parse({
        errorCode: 'RPC_ERROR',
        httpStatus: 404,
        implementationDetails: {},
        message: 'LOBBY_NOT_FOUND',
      }),
    ).toMatchObject({ httpStatus: 404 });
  });

  it('lobby (GET, in a custom lobby) parses, with chat credentials scrubbed', () => {
    const envelope = fixture('lobby');
    expect(envelope.status).toBe(200);
    const lobby = LobbySchema.parse(envelope.body);
    expect(lobby.gameConfig.isCustom).toBe(true);
    expect(lobby.gameConfig.queueId).toBe(3100);
    expect(lobby.gameConfig.mapId).toBe(11);
    const self = SummonerSchema.parse(fixture('current-summoner').body);
    expect(lobby.localMember.puuid).toBe(self.puuid);
    expect(lobby.members.map((member) => member.puuid)).toContain(self.puuid);
    const raw = envelope.body as Record<string, unknown>;
    expect(raw.mucJwtDto).toBe('[redacted]');
    expect(raw.multiUserChatPassword).toBe('[redacted]');
  });

  it('match history lists custom games, with only the local player per game', () => {
    const envelope = fixture('match-history');
    expect(envelope.status).toBe(200);
    const history = MatchHistoryListSchema.parse(envelope.body);
    expect(MatchHistoryMinimalSchema.safeParse(envelope.body).success).toBe(true);
    const games = history.games.games;
    expect(games.length).toBe(history.games.gameCount);
    expect(games.length).toBeGreaterThan(0);

    const customs = games.filter((game) => game.gameType === 'CUSTOM_GAME');
    expect(customs.length).toBeGreaterThan(0);

    const self = SummonerSchema.parse(fixture('current-summoner').body);
    for (const game of games) {
      // The list is the local player's perspective: one participant, never the whole lobby.
      expect(game.participants).toHaveLength(1);
      expect(game.participantIdentities).toHaveLength(1);
      expect(game.participantIdentities[0]?.player.puuid).toBe(self.puuid);
      // A game aborted before both sides loaded lists a single team; a played game lists both.
      expect(game.teams.length).toBeGreaterThanOrEqual(1);
      expect(game.teams.length).toBeLessThanOrEqual(2);
      expect(new Set(game.teams.map((team) => team.teamId)).size).toBe(game.teams.length);
    }
  });

  it('match history for another puuid parses the same way', () => {
    const other = MatchHistoryListSchema.parse(fixture('match-history--other').body);
    expect(other.games.games.length).toBeGreaterThan(0);
    expect(other.games.games.every((game) => game.participants.length === 1)).toBe(true);
  });

  it('match detail of a completed 5v5 custom carries all ten participants with puuids', () => {
    const envelope = fixture('match-detail');
    expect(envelope.status).toBe(200);
    const detail = MatchDetailSchema.parse(envelope.body);
    expect(detail.gameType).toBe('CUSTOM_GAME');
    expect(detail.endOfGameResult).toBe('GameComplete');
    expect(detail.participants).toHaveLength(10);
    expect(detail.participantIdentities).toHaveLength(10);

    const puuids = new Set(detail.participantIdentities.map((identity) => identity.player.puuid));
    expect(puuids.size).toBe(10);

    const ids = detail.participants.map((participant) => participant.participantId).sort((a, b) => a - b);
    expect(ids).toEqual(
      detail.participantIdentities.map((identity) => identity.participantId).sort((a, b) => a - b),
    );

    expect(detail.participants.filter((participant) => participant.teamId === 100)).toHaveLength(5);
    expect(detail.participants.filter((participant) => participant.teamId === 200)).toHaveLength(5);
    expect(detail.teams.map((team) => team.win).sort()).toEqual(['Fail', 'Win']);

    const winners = detail.teams.find((team) => team.win === 'Win')?.teamId;
    for (const participant of detail.participants) {
      expect(participant.stats.win).toBe(participant.teamId === winners);
    }

    // The same game in the list view has only the local player.
    const listed = MatchHistoryListSchema.parse(fixture('match-history').body).games.games.find(
      (game) => game.gameId === detail.gameId,
    );
    expect(listed?.participants).toHaveLength(1);
  });
});

describe(`end-of-game block from fixtures/${PATCH}`, () => {
  function checkBlock(block: unknown): void {
    const eog = EogStatsBlockSchema.parse(block);
    expect(eog.gameType).toBe('CUSTOM_GAME');
    // There is no queueId key on the block at all; the queue is only implied by gameType/queueType.
    expect(eog.queueId).toBeUndefined();
    expect(eog.gameLength).toBeGreaterThan(0);
    // A game the server dropped before the other side loaded lists one team and no winner.
    expect(eog.teams.length).toBeGreaterThanOrEqual(1);
    expect(eog.teams.length).toBeLessThanOrEqual(2);
    expect(new Set(eog.teams.map((team) => team.teamId)).size).toBe(eog.teams.length);
    expect(eog.teams.filter((team) => team.isWinningTeam).length).toBeLessThanOrEqual(1);

    const players = eog.teams.flatMap((team) => team.players);
    expect(players.length).toBeGreaterThan(0);
    const humans = players.filter((player) => !player.botPlayer);
    const bots = players.filter((player) => player.botPlayer);
    expect(humans.length).toBeGreaterThan(0);
    for (const human of humans) {
      expect(human.puuid).toMatch(/^[0-9a-f-]{36}$/);
      expect(human.puuid).not.toBe(BOT_PUUID);
      expect(human.summonerId).toBeGreaterThan(0);
    }
    for (const bot of bots) {
      expect(bot.puuid).toBe(BOT_PUUID);
      expect(bot.summonerId).toBe(0);
      expect(bot.riotIdTagLine).toBe('BOT');
    }
    for (const team of eog.teams) {
      for (const player of team.players) {
        expect(player.teamId).toBe(team.teamId);
        expect(player.stats.WIN).toBe(team.isWinningTeam ? 1 : 0);
        if (player.stats.kills !== undefined) {
          expect(player.stats.kills).toBe(player.stats.CHAMPIONS_KILLED);
        }
      }
    }

    const local = players.find((player) => player.isLocalPlayer);
    expect(local?.puuid).toBe(eog.localPlayer.puuid);
    const self = SummonerSchema.parse(fixture('current-summoner').body);
    expect(eog.localPlayer.puuid).toBe(self.puuid);
    expect(eog.localPlayer.botPlayer).toBe(false);
  }

  it('parses the block the GET returned on the end-of-game screen, with chat credentials scrubbed', () => {
    const envelope = fixture('eog-stats-block');
    expect(envelope.status).toBe(200);
    checkBlock(envelope.body);
    const raw = envelope.body as Record<string, unknown>;
    expect(raw.mucJwtDto).toBe('[redacted]');
    expect(raw.multiUserChatPassword).toBe('[redacted]');
    const session = GameflowSessionSchema.parse(fixture('gameflow-session').body);
    expect((raw as { gameId: number }).gameId).toBe(session.gameData.gameId);
  });

  it('parses the blocks delivered by the WebSocket; the errored game got a Delete, the played one did not', () => {
    const eogEvents = eventsFor('/lol-end-of-game/v1/eog-stats-block');
    expect(eogEvents.map((event) => event.eventType)).toEqual([
      'Create',
      'Update',
      'Delete',
      'Create',
      'Update',
    ]);
    for (const event of eogEvents) {
      if (event.eventType === 'Delete') {
        expect(event.data).toBeNull();
      } else {
        checkBlock(event.data);
      }
    }
    const playedGame = GameflowSessionSchema.parse(fixture('gameflow-session').body).gameData.gameId;
    const lastCreate = eogEvents.filter((event) => event.eventType === 'Create').at(-1);
    expect(EogStatsBlockSchema.parse(lastCreate?.data).gameId).toBe(playedGame);

    // The block arrives right after WaitingForStats, before the phase reaches EndOfGame.
    const phases = eventsFor('/lol-gameflow/v1/gameflow-phase');
    const endOfGame = phases.find((entry) => entry.data === 'EndOfGame');
    expect(endOfGame).toBeDefined();
    expect((lastCreate?.ts ?? '').localeCompare(endOfGame?.ts ?? '')).toBeLessThan(0);
  });
});

describe(`gameflow phases from fixtures/${PATCH}/ws-events.ndjson`, () => {
  it('walks the documented sequence for a custom game, and every value is a known phase', () => {
    const phases = eventsFor('/lol-gameflow/v1/gameflow-phase').map((entry) =>
      GameflowPhaseSchema.parse(entry.data),
    );
    for (const phase of phases) {
      expect(KNOWN_GAMEFLOW_PHASES).toContain(phase);
    }
    // Game 1 was dropped by the server; game 2 was played out.
    expect(phases).toEqual([
      'Lobby',
      'Matchmaking',
      'ReadyCheck',
      'ChampSelect',
      'GameStart',
      'InProgress',
      'WaitingForStats',
      'TerminatedInError',
      'None',
      'TerminatedInError',
      'None',
      'Lobby',
      'Matchmaking',
      'ReadyCheck',
      'ChampSelect',
      'GameStart',
      'InProgress',
      'WaitingForStats',
      'PreEndOfGame',
      'EndOfGame',
    ]);
  });

  it('session events carry the game id from the end of champion select onward', () => {
    const sessions = eventsFor('/lol-gameflow/v1/session', 'first').map((entry) =>
      GameflowSessionSchema.parse(entry.data),
    );
    expect(sessions.length).toBeGreaterThan(20);
    const ids = new Set<number>();
    for (const session of sessions) {
      if (
        ['GameStart', 'InProgress', 'WaitingForStats', 'PreEndOfGame', 'EndOfGame'].includes(session.phase)
      ) {
        expect(session.gameData.gameId).toBeGreaterThan(0);
        ids.add(session.gameData.gameId);
      }
      // A lobby created from idle: no game yet.
      if (session.phase === 'Lobby') {
        expect(session.gameData.gameId).toBe(0);
      }
    }
    expect(ids.size).toBe(2);
    const detailGame = MatchDetailSchema.parse(fixture('match-detail').body);
    const lastGame = GameflowSessionSchema.parse(fixture('gameflow-session').body).gameData.gameId;
    expect(ids).toContain(lastGame);
    expect(ids).not.toContain(detailGame.gameId);
  });

  it('in the lobby after a game, Lobby-phase sessions still carry the previous game id and roster', () => {
    const previousGame = GameflowSessionSchema.parse(fixture('gameflow-session').body).gameData.gameId;
    const self = SummonerSchema.parse(fixture('current-summoner').body);

    const envelope = fixture('gameflow-session--in-lobby');
    expect(envelope.status).toBe(200);
    const session = GameflowSessionSchema.parse(envelope.body);
    expect(session.phase).toBe('Lobby');
    expect(session.gameData.gameId).toBe(previousGame);
    expect(session.gameData.isCustomGame).toBe(true);
    // The session is not the lobby roster: one human on each side of the lobby at this moment, and the
    // session lists only the local player, on team one, with the champion from the previous game.
    expect(session.gameData.teamOne.map((member) => member.puuid)).toEqual([self.puuid]);
    expect(session.gameData.teamTwo).toEqual([]);
    expect(session.gameData.teamOne[0]?.championId).toBeGreaterThan(0);
    expect(session.gameClient?.running).toBe(false);
    const raw = envelope.body as { gameData: Record<string, unknown> };
    expect(raw.gameData.password).toBe('[redacted]');
    expect(raw.gameData.spectatorKey).toBe('[redacted]');

    const events = eventsFor('/lol-gameflow/v1/session', 'second');
    expect(events.length).toBeGreaterThan(5);
    for (const event of events) {
      const fromEvent = GameflowSessionSchema.parse(event.data);
      expect(fromEvent.phase).toBe('Lobby');
      expect(fromEvent.gameData.gameId).toBe(previousGame);
      expect(fromEvent.gameData.teamTwo).toEqual([]);
    }
  });
});

describe(`lobby events from fixtures/${PATCH}/ws-events.ndjson`, () => {
  it('Create/Update carry the lobby, Delete carries null, and partyId is stable per lobby', () => {
    const events = eventsFor('/lol-lobby/v2/lobby', 'first');
    expect(events.length).toBeGreaterThan(10);
    expect(events[0]?.eventType).toBe('Create');
    const partyIds: string[] = [];
    for (const event of events) {
      if (event.eventType === 'Delete') {
        expect(event.data).toBeNull();
        continue;
      }
      const lobby = LobbySchema.parse(event.data);
      expect(lobby.gameConfig.isCustom).toBe(true);
      expect(lobby.gameConfig.queueId).toBe(3100);
      const raw = event.data as Record<string, unknown>;
      expect(raw.mucJwtDto).toBe('[redacted]');
      expect(raw.multiUserChatPassword).toBe('[redacted]');
      if (partyIds.at(-1) !== lobby.partyId) {
        partyIds.push(lobby.partyId);
      }
    }
    expect(partyIds).toHaveLength(2);
    expect(events.filter((event) => event.eventType === 'Delete')).toHaveLength(2);
    expect(events.filter((event) => event.eventType === 'Create')).toHaveLength(2);

    // The lobby is deleted when the game starts.
    const gameStarts = eventsFor('/lol-gameflow/v1/gameflow-phase', 'first').filter(
      (entry) => entry.data === 'GameStart',
    );
    const deletes = events.filter((event) => event.eventType === 'Delete');
    expect(gameStarts).toHaveLength(2);
    for (let i = 0; i < 2; i += 1) {
      expect((gameStarts[i]?.ts ?? '').localeCompare(deletes[i]?.ts ?? '')).toBeLessThan(0);
    }
  });

  it('sides live in gameConfig.customTeam100/200, not in members[].teamId (question 3)', () => {
    const self = SummonerSchema.parse(fixture('current-summoner').body);
    const lobbies = eventsFor('/lol-lobby/v2/lobby')
      .filter((event) => event.eventType !== 'Delete')
      .map((event) => LobbySchema.parse(event.data));
    const onRed = lobbies.filter((lobby) =>
      lobby.gameConfig.customTeam200.some((member) => member.puuid === self.puuid),
    );
    const onBlue = lobbies.filter((lobby) =>
      lobby.gameConfig.customTeam100.some((member) => member.puuid === self.puuid),
    );
    expect(onRed.length).toBeGreaterThan(0);
    expect(onBlue.length).toBeGreaterThan(0);
    for (const lobby of [...onRed, ...onBlue]) {
      // teamId never moved, on either side.
      for (const member of lobby.members) {
        expect(member.teamId).toBe(0);
      }
      expect(lobby.localMember.teamId).toBe(0);
    }
  });

  it('bots are lobby members with isBot and an empty puuid', () => {
    const lobbies = eventsFor('/lol-lobby/v2/lobby')
      .filter((event) => event.eventType !== 'Delete')
      .map((event) => LobbySchema.parse(event.data));
    const withBots = lobbies.filter((lobby) => lobby.gameConfig.customTeam200.some((member) => member.isBot));
    expect(withBots.length).toBeGreaterThan(0);
    const last = withBots.at(-1);
    expect(last?.gameConfig.customTeam200.filter((member) => member.isBot)).toHaveLength(5);
    for (const bot of last?.gameConfig.customTeam200 ?? []) {
      expect(bot.isBot).toBe(true);
      expect(bot.puuid).toBe('');
      expect(bot.summonerId).toBe(0);
      expect(bot.botChampionId).toBeGreaterThan(0);
    }
    // Bots are not in members[]; only humans are.
    expect(last?.members.every((member) => !member.isBot)).toBe(true);
  });

  it('the members event is the members array on its own', () => {
    const events = eventsFor('/lol-lobby/v2/lobby/members');
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      const members = LobbyMembersSchema.parse(event.data);
      expect(members.length).toBeGreaterThan(0);
    }
  });

  it('every human in members[] is on exactly one of customTeam100/200/customSpectators, in every event', () => {
    // The invariant M2.2's side derivation rests on: a member is never listed without a side, on either
    // window, before or after a join, before or after a side switch.
    const lobbies = eventsFor('/lol-lobby/v2/lobby')
      .filter((event) => event.eventType !== 'Delete')
      .map((event) => LobbySchema.parse(event.data));
    expect(lobbies.length).toBeGreaterThan(30);
    for (const lobby of lobbies) {
      const sides = [
        ...humanPuuids(lobby.gameConfig.customTeam100),
        ...humanPuuids(lobby.gameConfig.customTeam200),
        ...humanPuuids(lobby.gameConfig.customSpectators ?? []),
      ];
      expect(new Set(sides).size).toBe(sides.length);
      expect([...sides].sort()).toEqual([...humanPuuids(lobby.members)].sort());
    }
  });
});

describe(`two-player lobby from fixtures/${PATCH} (second capture window)`, () => {
  function twoPlayerLobby() {
    const envelope = fixture('lobby--two-players');
    expect(envelope.status).toBe(200);
    return { envelope, lobby: LobbySchema.parse(envelope.body) };
  }

  it('GET in a lobby with two humans parses; both are in members[] with distinct ids, one per side', () => {
    const { envelope, lobby } = twoPlayerLobby();
    const self = SummonerSchema.parse(fixture('current-summoner').body);
    expect(lobby.gameConfig.isCustom).toBe(true);
    expect(lobby.gameConfig.queueId).toBe(3100);

    expect(lobby.members).toHaveLength(2);
    expect(new Set(lobby.members.map((member) => member.puuid)).size).toBe(2);
    expect(new Set(lobby.members.map((member) => member.summonerId)).size).toBe(2);
    for (const member of lobby.members) {
      expect(member.puuid).toMatch(/^[0-9a-f-]{36}$/);
      expect(member.summonerId).toBeGreaterThan(0);
      expect(member.isBot).toBe(false);
      expect(member.isSpectator).toBe(false);
      // Question 3 again, now with a second human: teamId is 0 for both.
      expect(member.teamId).toBe(0);
    }
    const friend = lobby.members.find((member) => member.puuid !== self.puuid);
    expect(friend).toBeDefined();
    expect(lobby.localMember.puuid).toBe(self.puuid);
    expect(lobby.localMember.isLeader).toBe(true);
    expect(friend?.isLeader).toBe(false);
    // The leader is listed first.
    expect(lobby.members[0]?.puuid).toBe(self.puuid);
    // An open party lets a non-leader invite but not start.
    expect(lobby.partyType).toBe('open');
    expect(friend?.allowedInviteOthers).toBe(true);
    expect(friend?.allowedStartActivity).toBe(false);

    expect(lobby.gameConfig.customTeam100.map((member) => member.puuid)).toEqual([self.puuid]);
    expect(lobby.gameConfig.customTeam200.map((member) => member.puuid)).toEqual([friend?.puuid]);
    expect(lobby.gameConfig.customSpectators).toEqual([]);
    expect(lobby.canStartActivity).toBe(true);

    const raw = envelope.body as Record<string, unknown>;
    expect(raw.mucJwtDto).toBe('[redacted]');
    expect(raw.multiUserChatPassword).toBe('[redacted]');
  });

  it('is the same party as lobby.json (solo, 28 minutes earlier): partyId survives an invite and a join', () => {
    const { lobby } = twoPlayerLobby();
    const solo = LobbySchema.parse(fixture('lobby').body);
    expect(solo.members).toHaveLength(1);
    expect(lobby.partyId).toBe(solo.partyId);
    expect(
      fixture('lobby--two-players').capturedAt.localeCompare(fixture('lobby').capturedAt),
    ).toBeGreaterThan(0);
  });

  it('invitations[] lists every member as Accepted and an outstanding invite as Pending', () => {
    const { lobby } = twoPlayerLobby();
    const invitations = (lobby.invitations ?? []).map((entry) => LobbyInvitationSchema.parse(entry));
    expect(invitations).toHaveLength(3);
    const memberPuuids = lobby.members.map((member) => member.puuid);
    for (const puuid of memberPuuids) {
      const entry = invitations.find((invitation) => invitation.toPuuid === puuid);
      expect(entry?.state).toBe('Accepted');
      expect(entry?.timestamp).toBe('0');
      expect(entry?.toSummonerId).toBe(lobby.members.find((member) => member.puuid === puuid)?.summonerId);
    }
    const pending = invitations.filter((invitation) => invitation.state === 'Pending');
    expect(pending).toHaveLength(1);
    expect(memberPuuids).not.toContain(pending[0]?.toPuuid);
    // Epoch milliseconds as a string, sent before this capture.
    expect(pending[0]?.timestamp).toMatch(/^\d{13}$/);
    expect(Number(pending[0]?.timestamp)).toBeLessThan(Date.parse(fixture('lobby--two-players').capturedAt));
    // summonerId is not a 32-bit number on newer accounts; it must still be a safe integer for the schema.
    expect(pending[0]?.toSummonerId).toBeGreaterThan(2 ** 31);
    expect(Number.isSafeInteger(pending[0]?.toSummonerId)).toBe(true);
    // Neither field identifies an invite; toPuuid does.
    for (const invitation of invitations) {
      expect(invitation.invitationId).toBe('');
      expect(invitation.invitationType).toBe('invalid');
    }
    // The same Pending row was already in the solo lobby.
    const solo = LobbySchema.parse(fixture('lobby').body);
    expect(solo.invitations?.map((entry) => entry.toPuuid)).toContain(pending[0]?.toPuuid);
  });

  it('WS: the friend enters members[] and customTeam200[] in the same Update, then the members event follows', () => {
    const self = SummonerSchema.parse(fixture('current-summoner').body);
    const { lobby: snapshot } = twoPlayerLobby();
    const friend = snapshot.members.find((member) => member.puuid !== self.puuid)?.puuid ?? '';

    const events = eventsFor('/lol-lobby/v2/lobby', 'second');
    expect(events.length).toBeGreaterThan(5);
    expect(events.every((event) => event.eventType === 'Update')).toBe(true);
    const lobbies = events.map((event) => ({ ts: event.ts, lobby: LobbySchema.parse(event.data) }));
    for (const { lobby } of lobbies) {
      expect(lobby.partyId).toBe(snapshot.partyId);
      expect(lobby.gameConfig.customSpectators).toEqual([]);
      for (const member of lobby.members) {
        expect(member.teamId).toBe(0);
        expect(member.isSpectator).toBe(false);
      }
    }

    // Before the join: one member, the friend's invite Pending, nobody on red.
    const before = lobbies[0];
    expect(before?.lobby.members.map((member) => member.puuid)).toEqual([self.puuid]);
    expect(before?.lobby.gameConfig.customTeam200).toEqual([]);
    expect(before?.lobby.invitations?.find((invitation) => invitation.toPuuid === friend)?.state).toBe(
      'Pending',
    );

    // The join: the first event that lists the friend anywhere lists them in members[] and customTeam200[]
    // together. There is no event where one has them and the other does not.
    const firstInMembers = lobbies.findIndex(({ lobby }) =>
      lobby.members.some((member) => member.puuid === friend),
    );
    const firstOnSide = lobbies.findIndex(({ lobby }) =>
      [...lobby.gameConfig.customTeam100, ...lobby.gameConfig.customTeam200].some(
        (member) => member.puuid === friend,
      ),
    );
    expect(firstInMembers).toBeGreaterThan(0);
    expect(firstOnSide).toBe(firstInMembers);
    const join = lobbies[firstInMembers];
    expect(join?.lobby.members.map((member) => member.puuid)).toEqual([self.puuid, friend]);
    expect(join?.lobby.gameConfig.customTeam100.map((member) => member.puuid)).toEqual([self.puuid]);
    expect(join?.lobby.gameConfig.customTeam200.map((member) => member.puuid)).toEqual([friend]);
    expect(join?.lobby.invitations?.find((invitation) => invitation.toPuuid === friend)?.state).toBe(
      'Accepted',
    );
    // The friend stays in members[] from then on.
    for (const { lobby } of lobbies.slice(firstInMembers)) {
      expect(lobby.members.map((member) => member.puuid)).toEqual([self.puuid, friend]);
    }

    // The members event comes after that Update, with the same two humans.
    const memberEvents = eventsFor('/lol-lobby/v2/lobby/members', 'second');
    expect(memberEvents.length).toBeGreaterThan(0);
    expect((memberEvents[0]?.ts ?? '').localeCompare(join?.ts ?? '')).toBeGreaterThan(0);
    expect(LobbyMembersSchema.parse(memberEvents[0]?.data).map((member) => member.puuid)).toEqual([
      self.puuid,
      friend,
    ]);
  });

  it('WS: a non-leader can move to the other side; members[] order does not change and teamId stays 0', () => {
    const self = SummonerSchema.parse(fixture('current-summoner').body);
    const { lobby: snapshot } = twoPlayerLobby();
    const friend = snapshot.members.find((member) => member.puuid !== self.puuid)?.puuid ?? '';
    const lobbies = eventsFor('/lol-lobby/v2/lobby', 'second').map((event) => LobbySchema.parse(event.data));

    const sides = lobbies
      .map((lobby) => {
        if (lobby.gameConfig.customTeam100.some((member) => member.puuid === friend)) {
          return 100;
        }
        if (lobby.gameConfig.customTeam200.some((member) => member.puuid === friend)) {
          return 200;
        }
        return null;
      })
      .filter((side, index, all) => index === 0 || side !== all[index - 1]);
    // Not in the lobby, joined on red, switched to blue, switched back to red.
    expect(sides).toEqual([null, 200, 100, 200]);

    const bothOnBlue = lobbies.find((lobby) => lobby.gameConfig.customTeam100.length === 2);
    expect(bothOnBlue?.gameConfig.customTeam100.map((member) => member.puuid)).toEqual([self.puuid, friend]);
    expect(bothOnBlue?.gameConfig.customTeam200).toEqual([]);
    expect(bothOnBlue?.members.map((member) => member.puuid)).toEqual([self.puuid, friend]);
    expect(bothOnBlue?.members.every((member) => member.teamId === 0)).toBe(true);
    // The local player never moved.
    for (const lobby of lobbies) {
      expect(lobby.gameConfig.customTeam100.map((member) => member.puuid)).toContain(self.puuid);
    }
  });
});

describe(`spectator from fixtures/${PATCH} (third capture window, M2.13)`, () => {
  it('a spectator stays in members[] with isSpectator true and is listed in customSpectators, on no team', () => {
    const self = SummonerSchema.parse(fixture('current-summoner').body);
    const envelope = fixture('lobby--spectator');
    expect(envelope.status).toBe(200);
    expect(envelope.method).toBe('WS');
    const lobby = LobbySchema.parse(envelope.body);
    expect(lobby.partyId).toBe(LobbySchema.parse(fixture('lobby--two-players').body).partyId);

    expect(lobby.members).toHaveLength(2);
    const friend = lobby.members.find((member) => member.puuid !== self.puuid);
    expect(friend).toBeDefined();
    expect(friend?.isSpectator).toBe(true);
    expect(friend?.isBot).toBe(false);
    expect(friend?.teamId).toBe(0);
    expect(lobby.localMember.isSpectator).toBe(false);
    expect(lobby.members.find((member) => member.puuid === self.puuid)?.isSpectator).toBe(false);

    expect(lobby.gameConfig.customSpectators?.map((member) => member.puuid)).toEqual([friend?.puuid]);
    expect(lobby.gameConfig.customSpectators?.[0]?.isSpectator).toBe(true);
    expect(lobby.gameConfig.customTeam100.map((member) => member.puuid)).toEqual([self.puuid]);
    expect(lobby.gameConfig.customTeam200).toEqual([]);
    expect(lobby.gameConfig.customSpectatorPolicy).toBe('AllAllowed');
    // The M1.8 caller-in-members check needs no widening: the spectating companion's own puuid is in members[].
    expect(lobby.members.map((member) => member.puuid)).toContain(friend?.puuid);
    const raw = envelope.body as Record<string, unknown>;
    expect(raw.mucJwtDto).toBe('[redacted]');
    expect(raw.multiUserChatPassword).toBe('[redacted]');
  });

  it('WS: team -> spectator -> team, with the members event mirroring isSpectator each time', () => {
    const self = SummonerSchema.parse(fixture('current-summoner').body);
    const friend =
      LobbySchema.parse(fixture('lobby--two-players').body).members.find(
        (member) => member.puuid !== self.puuid,
      )?.puuid ?? '';
    const events = eventsFor('/lol-lobby/v2/lobby', 'third');
    expect(events.length).toBeGreaterThan(4);
    const lobbies = events.map((event) => ({ ts: event.ts, lobby: LobbySchema.parse(event.data) }));

    const where = lobbies
      .map(({ lobby }) => {
        if (lobby.gameConfig.customSpectators?.some((member) => member.puuid === friend)) {
          return 'spectator';
        }
        if (lobby.gameConfig.customTeam100.some((member) => member.puuid === friend)) {
          return 100;
        }
        if (lobby.gameConfig.customTeam200.some((member) => member.puuid === friend)) {
          return 200;
        }
        return null;
      })
      .filter((side, index, all) => index === 0 || side !== all[index - 1]);
    expect(where).toEqual([100, 200, 'spectator', 200]);

    for (const { lobby } of lobbies) {
      const member = lobby.members.find((entry) => entry.puuid === friend);
      const spectating = lobby.gameConfig.customSpectators?.some((entry) => entry.puuid === friend) ?? false;
      // members[] always lists the friend, and its isSpectator flag agrees with customSpectators.
      expect(member).toBeDefined();
      expect(member?.isSpectator).toBe(spectating);
      expect(member?.teamId).toBe(0);
      expect(lobby.members.map((entry) => entry.puuid)).toEqual([self.puuid, friend]);
      expect(lobby.canStartActivity).toBe(true);
    }

    const spectatorEvent = lobbies.find(({ lobby }) => (lobby.gameConfig.customSpectators?.length ?? 0) > 0);
    expect(spectatorEvent?.ts).toBe(fixture('lobby--spectator').capturedAt);

    const memberEvents = eventsFor('/lol-lobby/v2/lobby/members', 'third');
    expect(memberEvents).toHaveLength(2);
    const flags = memberEvents.map(
      (event) => LobbyMembersSchema.parse(event.data).find((member) => member.puuid === friend)?.isSpectator,
    );
    expect(flags).toEqual([true, false]);
  });

  it("the client pushes another player's ranked stats over the socket in the ranked-stats shape", () => {
    const self = SummonerSchema.parse(fixture('current-summoner').body);
    const friend =
      LobbySchema.parse(fixture('lobby--two-players').body).members.find(
        (member) => member.puuid !== self.puuid,
      )?.puuid ?? '';
    const envelope = fixture('ranked-stats-by-puuid--ws-cached');
    expect(envelope.method).toBe('WS');
    expect(envelope.path).toBe(`/lol-ranked/v1/cached-ranked-stats/${friend}`);
    const stats = RankedStatsSchema.parse(envelope.body);
    const solo = stats.queueMap.RANKED_SOLO_5x5;
    expect(solo?.queueType).toBe('RANKED_SOLO_5x5');
    expect(KNOWN_TIERS).toContain(solo?.tier);
    // This friend is unranked: the same "" / "NA" pair as the GET.
    expect(solo?.tier).toBe('');
    expect(solo?.division).toBe('NA');
  });
});

describe('fixture guard', () => {
  // Keys the client uses for credentials. The regex accepts both `"key": "value"` and the `\"key\":\"value\"`
  // form inside a JSON string; a value that is empty or `[redacted]` is fine, anything else fails the build.
  const SECRET_KEY_VALUE =
    /(encryptionKey|spectatorKey|observerEncryptionKey|mucJwtDto|multiUserChatPassword|[Pp]assword|Token)\\?"\s*:\s*\\?"([^"\\]*)/g;
  const SECRET_KEY_OBJECT =
    /(encryptionKey|spectatorKey|observerEncryptionKey|mucJwtDto|multiUserChatPassword|[Pp]assword)\\?"\s*:\s*[{[]/;

  function listFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    });
  }

  it('no file under fixtures/ carries a credential value', () => {
    const files = listFiles(FIXTURES_DIR).filter(
      (file) => file.endsWith('.json') || file.endsWith('.ndjson'),
    );
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(SECRET_KEY_VALUE)) {
        const value = match[2] ?? '';
        if (value.length > 0 && value !== '[redacted]') {
          offenders.push(`${file}: ${match[1]} = ${value.slice(0, 12)}...`);
        }
      }
      if (SECRET_KEY_OBJECT.test(text)) {
        offenders.push(`${file}: credential key with an object/array value`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * The two dialog-data fixtures from the 16.18 `--verify-commands` run that pinned `create_lobby` (Bug 1/2,
 * reviewer-caught, 2026-09-13): `custom-game-queues.json` has `gameServerRegions: null`, not absent, and
 * every dialog mutator is wordless; `game-queues.json` is what names them. Pinned on 16.18 specifically
 * (not `PATCH`/16.17, which never captured either endpoint by GET).
 */
describe('custom-game-queues.json and game-queues.json from fixtures/16.18', () => {
  it('CustomGameQueuesSchema parses the real capture, including the null gameServerRegions', () => {
    const read = readFixture('16.18', 'custom-game-queues');
    if (!read.ok) {
      throw new Error(`fixture 16.18/custom-game-queues: ${read.reason}`);
    }
    const body = read.envelope.body as Record<string, unknown>;
    expect(body.gameServerRegions).toBeNull();
    const parsed = CustomGameQueuesSchema.parse(body);
    expect(parsed.gameServerRegions).toBeNull();
    expect(parsed.subcategories.length).toBeGreaterThan(0);
  });

  it("GameQueuesSchema parses the real queue list and names the Summoner's Rift customs", () => {
    const read = readFixture('16.18', 'game-queues');
    if (!read.ok) {
      throw new Error(`fixture 16.18/game-queues: ${read.reason}`);
    }
    const parsed = GameQueuesSchema.parse(read.envelope.body);
    const byId = new Map(parsed.map((queue) => [queue.id, queue]));
    expect(byId.get(3100)?.name).toBe('SR Blind Pick Custom');
    expect(byId.get(3110)?.name).toBe('SR Draft Pick Custom');
    expect(byId.get(3120)?.name).toBe('SR All Random');
    expect(byId.get(3130)?.name).toBe('SR Tournament Draft');
  });
});

describe(`ws-events.ndjson from fixtures/${PATCH}`, () => {
  it('every recorded line is the documented event or dropped-frame shape', () => {
    const text = readFileSync(join(FIXTURES_DIR, PATCH, 'ws-events.ndjson'), 'utf8');
    const lines = text.split('\n').filter((line) => line.length > 0);
    expect(lines.length).toBeGreaterThan(0);
    let events = 0;
    for (const line of lines) {
      const record = JSON.parse(line) as Record<string, unknown>;
      expect(typeof record.ts).toBe('string');
      if (record.dropped === true) {
        expect(typeof record.reason).toBe('string');
        continue;
      }
      events += 1;
      expect(record.topic).toBe('OnJsonApiEvent');
      expect(typeof record.uri).toBe('string');
      expect(['Create', 'Update', 'Delete']).toContain(record.eventType);
      if (record.redacted === true) {
        expect(record).not.toHaveProperty('data');
      }
    }
    expect(events).toBeGreaterThan(0);
  });
});
