/**
 * The one place that turns a client shape into a companion payload (M2.10, "One mapper, not two").
 *
 * `apps/companion` calls these and holds no copy of the rules. The rules themselves are written out, as
 * commented code against the 16.17 fixtures, in `packages/db/src/schemas/companion.contract.test.ts`; this
 * file is correct when it produces, field for field, what that file's `mapLobby`/`mapEog`/`mapRank` produce,
 * and `mapper.test.ts` pins that with literal expected objects. If a rule is wrong, fix the contract test
 * first, then this.
 *
 * Nothing here does I/O. The name cache a lobby is mapped with is whatever the caller already knows; a lobby
 * post never waits on a lookup (M2.10, point 2).
 */

import {
  type CompanionGameEogPayloadInput,
  type CompanionGameParticipantInput,
  type CompanionLobbyMemberInput,
  type CompanionLobbyPayloadInput,
  type CompanionRankPayloadInput,
  isPlaceholderPuuid,
  roleFromDetectedTeamPosition,
  type SideValue,
} from '@customs/db/schemas';
import {
  type EogPlayer,
  type EogStatsBlock,
  type Lobby,
  type LobbyMember,
  type MatchDetail,
  type RankedQueueEntry,
  RankedQueueEntrySchema,
  type RankedStats,
} from './schemas.js';
import { scrubValue } from './scrub.js';
import { matchTimelineKey, roleFromMatchTimeline } from './timelineRoles.js';

/** A Riot ID as the companion knows it: from `current-summoner` or a `summoners/puuid/{puuid}` lookup. */
export interface RiotIdName {
  readonly gameName: string | null;
  readonly tagLine: string | null;
}

/** Names the companion already has, by puuid. The mapper reads it and never fills it. */
export type NameCache = ReadonlyMap<string, RiotIdName>;

/** `""` (the client's "no name") becomes null; a `Summoner` fits this directly. */
export function nameFromSummoner(summoner: { gameName: string; tagLine: string }): RiotIdName {
  return { gameName: summoner.gameName || null, tagLine: summoner.tagLine || null };
}

/**
 * Is this lobby entry a bot or an empty slot rather than a person? `isBot` is the flag the client sets;
 * the puuid check catches a slot that carries no flag (`04-decisions.md`: bots are filtered by the flag,
 * the placeholder puuid is the value check behind it).
 */
export function isLobbyBot(member: Pick<LobbyMember, 'isBot' | 'puuid'>): boolean {
  return member.isBot || isPlaceholderPuuid(member.puuid);
}

/** The same question for an end-of-game line: `botPlayer`, and the all-zero puuid behind it. */
export function isEogBot(player: Pick<EogPlayer, 'botPlayer' | 'puuid'>): boolean {
  return player.botPlayer || isPlaceholderPuuid(player.puuid);
}

function hasPuuid(entries: readonly { puuid: string }[] | undefined, puuid: string): boolean {
  return entries?.some((entry) => entry.puuid === puuid) ?? false;
}

/**
 * `GET /lol-lobby/v2/lobby` (or its WebSocket event) -> the body of `POST /api/companion/lobby`.
 *
 * - `members` come from `members[]` only, humans only. Bots live in the team arrays and never in
 *   `members[]` on 16.17, but they are filtered on the way past anyway. `invitations[]` is not a roster.
 * - `side` is membership of `gameConfig.customTeam100` (100) / `customTeam200` (200) by puuid. Never
 *   `members[].teamId`, which is always `0` in a custom lobby (reference, question 3). In neither: `null`,
 *   which is a spectator or an unplaced member, and both are valid states.
 * - `isSpectator` is `members[].isSpectator` **or** membership of `customSpectators` (question 9: the two
 *   always agree on 16.17; the `or` survives the day they do not).
 * - `summonerId` goes out as the client's number; the wire schema turns it into a decimal string.
 * - `gameName`/`tagLine` come from `names`, null otherwise. The lobby carries no Riot ID at all.
 * - `partyId` verbatim; `lobbyName` is `gameConfig.customLobbyName`; `lobbyPassword` is always `null`
 *   (there is no password in the 16.17 lobby body; M4.1 fills it when the companion set it).
 */
export function mapLobby(lobby: Lobby, names: NameCache = new Map()): CompanionLobbyPayloadInput {
  const { customTeam100, customTeam200, customSpectators } = lobby.gameConfig;
  const sideOf = (puuid: string): SideValue | null => {
    if (hasPuuid(customTeam100, puuid)) return 100;
    if (hasPuuid(customTeam200, puuid)) return 200;
    return null;
  };

  const members: CompanionLobbyMemberInput[] = lobby.members
    .filter((member) => !isLobbyBot(member))
    .map((member) => ({
      puuid: member.puuid,
      summonerId: member.summonerId,
      gameName: names.get(member.puuid)?.gameName ?? null,
      tagLine: names.get(member.puuid)?.tagLine ?? null,
      side: sideOf(member.puuid),
      isSpectator: member.isSpectator || hasPuuid(customSpectators, member.puuid),
    }));

  return {
    partyId: lobby.partyId,
    lobbyName: lobby.gameConfig.customLobbyName ?? null,
    lobbyPassword: null,
    members,
  };
}

export interface MapEogOptions {
  /** The `partyId` the companion held for this game, or null when it never saw the lobby. */
  readonly partyId?: string | null;
  /**
   * The moment the companion observed gameflow `InProgress` for this game (ISO 8601). Preferred for
   * `startedAt`; when absent, `endOfGameTimestamp - gameLength * 1000` is used, which is not optional: a
   * companion that reconnected at `EndOfGame` has no `InProgress` moment.
   */
  readonly startedAt?: string | null;
  /** Only used when the block has no `endOfGameTimestamp` (never seen on 16.17). Default `Date.now`. */
  readonly now?: () => number;
}

/** `stats.WIN`, `stats.CHAMPIONS_KILLED` and friends: the uppercase keys, a missing one is 0. */
function stat(stats: Record<string, unknown>, key: string): number {
  const value = stats[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * The end-of-game block (WebSocket `Create`/`Update` for `/lol-end-of-game/v1/eog-stats-block`, or the
 * GET) -> the body of `POST /api/companion/game`, `phase: 'eog'`.
 *
 * - `gameId` is the block's own. Never `gameflow-session.gameData.gameId` read in phase `Lobby`.
 * - `winningSide` is the `teamId` of the team with `isWinningTeam`; `null` when nobody won, which is what a
 *   `TerminatedInError` block looks like. The caller (M2.3) does not post a null; the API refuses one.
 * - `side` is the team's `teamId`, not anything on the player row. Role is `detectedTeamPosition` through the
 *   published table, `null` for anything else, never inferred from the champion.
 * - Bots (`botPlayer`, the all-zero puuid) are dropped before validation.
 * - Stats are the uppercase keys; `cs` is `MINIONS_KILLED + NEUTRAL_MINIONS_KILLED`; `win` is `WIN === 1`.
 * - `raw` is the whole block, scrubbed of chat credentials here as well as on the server (M2.10, point 11).
 */
export function mapEog(block: EogStatsBlock, options: MapEogOptions = {}): CompanionGameEogPayloadInput {
  const participants: CompanionGameParticipantInput[] = block.teams.flatMap((team) =>
    team.players
      .filter((player) => !isEogBot(player))
      .map((player) => ({
        puuid: player.puuid,
        side: team.teamId,
        role: roleFromDetectedTeamPosition(player.detectedTeamPosition),
        championId: player.championId,
        kills: stat(player.stats, 'CHAMPIONS_KILLED'),
        deaths: stat(player.stats, 'NUM_DEATHS'),
        assists: stat(player.stats, 'ASSISTS'),
        gold: stat(player.stats, 'GOLD_EARNED'),
        damageToChamps: stat(player.stats, 'TOTAL_DAMAGE_DEALT_TO_CHAMPIONS'),
        cs: stat(player.stats, 'MINIONS_KILLED') + stat(player.stats, 'NEUTRAL_MINIONS_KILLED'),
        win: stat(player.stats, 'WIN') === 1,
        gameName: player.riotIdGameName || null,
        tagLine: player.riotIdTagLine || null,
        summonerId: player.summonerId,
      })),
  );

  const winner = block.teams.find((team) => team.isWinningTeam);
  const endedAtMs = block.endOfGameTimestamp ?? (options.now ?? Date.now)();
  const startedAt = options.startedAt ?? new Date(endedAtMs - block.gameLength * 1000).toISOString();

  return {
    phase: 'eog',
    gameId: block.gameId,
    partyId: options.partyId ?? null,
    gameType: block.gameType,
    startedAt,
    durationS: block.gameLength,
    winningSide: winner === undefined ? null : winner.teamId,
    participants,
    raw: scrubValue(block) as Record<string, unknown>,
  };
}

/** `teams[].win` of the team that won a match-history game. The eog block says `isWinningTeam: true` instead. */
export const MATCH_TEAM_WIN = 'Win';

/**
 * The side that won a match-history game: the one team whose `win` is `"Win"`. `null` when no team has it
 * (an aborted game has one team, `"Fail"`) or when both do (never seen; not a game we can rate).
 */
export function matchDetailWinningSide(detail: Pick<MatchDetail, 'teams'>): SideValue | null {
  const winners = detail.teams.filter((team) => team.win === MATCH_TEAM_WIN);
  const winner = winners[0];
  return winners.length === 1 && winner !== undefined ? winner.teamId : null;
}

/** A `timeline.lane` / `timeline.role` pair `MATCH_TIMELINE_ROLES` does not know, as the client spelled it. */
export interface UnmappedTimelinePair {
  readonly lane: string | null;
  readonly role: string | null;
  /** `matchTimelineKey(lane, role)`: the row a future fixture pass would add. */
  readonly key: string;
}

export interface MapMatchDetailOptions {
  /**
   * Called once per participant whose pair mapped to null, with the values. The mapper never logs; the
   * companion keeps a set and logs each distinct pair once, so the next fixture pass can add it.
   */
  readonly onUnmappedRole?: (pair: UnmappedTimelinePair) => void;
}

/**
 * `GET /lol-match-history/v1/games/{gameId}` -> the body of `POST /api/companion/game`, `phase: 'eog'`,
 * `source: 'backfill'` (M5.1). Same payload as `mapEog`, different rules, because the detail is a different
 * shape: camelCase stats, `teams[].win` as a string, a real start time, no `detectedTeamPosition`.
 *
 * - `gameId` is the detail's own. `partyId` is **absent**: a backfilled game belongs to no lobby.
 * - `startedAt` is `gameCreation` (epoch ms) as ISO 8601; no arithmetic. `durationS` is `gameDuration`.
 * - `winningSide` is `matchDetailWinningSide`; `null` means the caller drops the game and never posts it.
 * - Participants are `participants[]` joined to `participantIdentities[]` on `participantId`; `side` is the
 *   participant's `teamId`; names come from `player.gameName`/`tagLine`. A participant with no identity row,
 *   or a placeholder puuid (a bot), is dropped before validation.
 * - `role` is `timeline.lane` + `timeline.role` through `MATCH_TIMELINE_ROLES` (`timelineRoles.ts`, M5.18):
 *   the detail has no `detectedTeamPosition`, and that pair is the server's guess in another vocabulary, so a
 *   pair maps only once the fixtures have proved it against a live capture of the same game. A pair the table
 *   does not know is `null` and is reported to `options.onUnmappedRole` (the companion logs each distinct pair
 *   once). The table is empty on 16.17, so today every role is still `null` (`04-decisions.md`, 2026-09-10).
 * - Stats are the camelCase keys; `cs` is `totalMinionsKilled + neutralMinionsKilled`; `win` is `stats.win`.
 * - `raw` is the whole detail, scrubbed: it carries no chat credentials, but `scrubValue` is idempotent and
 *   `games.raw` is public-read, so this is not the place for an exception.
 */
export function mapMatchDetail(
  detail: MatchDetail,
  options: MapMatchDetailOptions = {},
): CompanionGameEogPayloadInput {
  const players = new Map(
    detail.participantIdentities.map((identity) => [identity.participantId, identity.player] as const),
  );
  const participants: CompanionGameParticipantInput[] = [];
  for (const participant of detail.participants) {
    const player = players.get(participant.participantId);
    if (player === undefined || isPlaceholderPuuid(player.puuid)) {
      continue;
    }
    const stats: Record<string, unknown> = participant.stats;
    const role = roleFromMatchTimeline(participant.timeline);
    if (role === null) {
      options.onUnmappedRole?.({
        lane: participant.timeline?.lane ?? null,
        role: participant.timeline?.role ?? null,
        key: matchTimelineKey(participant.timeline?.lane, participant.timeline?.role),
      });
    }
    participants.push({
      puuid: player.puuid,
      side: participant.teamId,
      role,
      championId: participant.championId,
      kills: stat(stats, 'kills'),
      deaths: stat(stats, 'deaths'),
      assists: stat(stats, 'assists'),
      gold: stat(stats, 'goldEarned'),
      damageToChamps: stat(stats, 'totalDamageDealtToChampions'),
      cs: stat(stats, 'totalMinionsKilled') + stat(stats, 'neutralMinionsKilled'),
      win: participant.stats.win === true,
      gameName: player.gameName || null,
      tagLine: player.tagLine || null,
      summonerId: player.summonerId,
    });
  }

  return {
    phase: 'eog',
    gameId: detail.gameId,
    source: 'backfill',
    gameType: detail.gameType,
    startedAt: new Date(detail.gameCreation).toISOString(),
    durationS: detail.gameDuration,
    winningSide: matchDetailWinningSide(detail),
    participants,
    raw: scrubValue(detail) as Record<string, unknown>,
  };
}

/** The one queue a rating is seeded from. Flex is not our ladder and the TFT queues are noise. */
export const RANK_QUEUE = 'RANKED_SOLO_5x5';

export interface MapRankOptions {
  /** The `queueMap` key to read. Default `RANKED_SOLO_5x5`. */
  readonly queue?: string;
  /** The Riot ID from the lookup the sweep did for this puuid (M2.4); omitted when it did none. */
  readonly name?: RiotIdName | null;
}

/**
 * `GET /lol-ranked/v1/ranked-stats/{puuid}` (or `current-ranked-stats`) -> the body of
 * `POST /api/companion/rank`.
 *
 * The response carries no puuid, so the caller supplies the one it asked about. Tier, division and lp are
 * passed through verbatim; the wire schema folds `""`/`"NA"` to null. `wins` and `losses` are never sent:
 * `losses` reads `0` for everyone but the local player, and our own `games` rows are the record.
 */
export function mapRank(
  stats: RankedStats,
  puuid: string,
  options: MapRankOptions = {},
): CompanionRankPayloadInput {
  const queue = options.queue ?? RANK_QUEUE;
  const parsed = RankedQueueEntrySchema.safeParse(stats.queueMap[queue]);
  const entry: RankedQueueEntry | undefined = parsed.success ? parsed.data : undefined;
  return {
    puuid,
    tier: entry?.tier ?? null,
    division: entry?.division ?? null,
    lp: entry?.leaguePoints ?? null,
    queue,
    gameName: options.name?.gameName ?? null,
    tagLine: options.name?.tagLine ?? null,
  };
}
