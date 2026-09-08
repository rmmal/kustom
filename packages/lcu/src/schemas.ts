/**
 * Response schemas for the endpoints in docs/03-lcu-reference.md.
 *
 * Every schema below marked "verified 16.17" was written from a real body captured on 2026-09-08
 * (`fixtures/16.17/<id>.json`) and is tested against that fixture in `schemas.test.ts`. The rule is
 * tolerant on unknown keys (`looseObject`, so a patch that adds fields never breaks the companion) and exact on
 * the fields this project reads. Anything still `unverified` in the reference doc is not here; nothing in the
 * companion may depend on a shape that has no fixture.
 */

import { z } from 'zod';

/** Any JSON value. */
export const JsonValueSchema = z.unknown();

/** Any JSON object. */
export const JsonObjectSchema = z.record(z.string(), z.unknown());
export type JsonObject = z.infer<typeof JsonObjectSchema>;

/** Any JSON array. */
export const JsonArraySchema = z.array(z.unknown());

/**
 * The body the client sends with a non-2xx status. Verified 16.17 on `lobby` (404 `LOBBY_NOT_FOUND`),
 * `eog-stats-block` (404 "No end of game stats available.") and the swagger paths (404 `RESOURCE_NOT_FOUND`).
 * `implementationDetails` is present on RPC errors and absent on routing errors.
 */
export const LcuErrorSchema = z.looseObject({
  errorCode: z.string(),
  httpStatus: z.number().int(),
  message: z.string(),
  implementationDetails: z.record(z.string(), z.unknown()).optional(),
});
export type LcuError = z.infer<typeof LcuErrorSchema>;

/** `100` blue, `200` red, matching the client (CLAUDE.md conventions). */
export const TeamIdSchema = z.union([z.literal(100), z.literal(200)]);
export type TeamId = z.infer<typeof TeamIdSchema>;

/**
 * `GET /lol-patch/v1/game-version`. Verified 16.17: a bare JSON string, but a long one:
 * `"16.17.8104348+branch.releases-16-17.code.public.content.release.anticheat.vanguard"`. Only the leading
 * `major.minor` is meaningful; `patchFromVersion` in fixtures.ts extracts it. The short `16.17.812.4632` form
 * lives in `/system/v1/builds`.
 */
export const GameVersionSchema = z.string().min(1);

/** `GET /system/v1/builds`. Verified 16.17. */
export const SystemBuildsSchema = z.looseObject({
  version: z.string().min(1),
  branch: z.string().optional(),
  buildType: z.string().optional(),
  patchline: z.string().optional(),
});
export type SystemBuilds = z.infer<typeof SystemBuildsSchema>;

/**
 * `GET /lol-summoner/v1/current-summoner` and `GET /lol-summoner/v2/summoners/puuid/{puuid}` share this shape.
 * Verified 16.17 on both (own puuid and another player's). `displayName`, `internalName` and `summonerName`
 * style fields are empty strings now; identity is `gameName#tagLine`, identity key is `puuid`, and `summonerId`
 * is what invites need.
 */
export const SummonerSchema = z.looseObject({
  puuid: z.string().min(1),
  summonerId: z.number().int(),
  accountId: z.number().int().optional(),
  gameName: z.string(),
  tagLine: z.string(),
  summonerLevel: z.number().int().optional(),
  profileIconId: z.number().int().optional(),
  privacy: z.string().optional(),
  unnamed: z.boolean().optional(),
});
export type Summoner = z.infer<typeof SummonerSchema>;
export const CurrentSummonerSchema = SummonerSchema;

/**
 * `GET /lol-summoner/v1/current-summoner`, minimal. What the smoke script needs to fill path templates; it
 * must keep working even when the full schema above drifts, so it stays separate and looser.
 */
export const CurrentSummonerMinimalSchema = z.looseObject({
  puuid: z.string().min(1),
  summonerId: z.number().optional(),
  gameName: z.string().optional(),
  tagLine: z.string().optional(),
});
export type CurrentSummonerMinimal = z.infer<typeof CurrentSummonerMinimalSchema>;

/** `GET /lol-summoner/v1/alias/lookup?gameName=&tagLine=`. Verified 16.17. */
export const AliasLookupSchema = z.looseObject({
  puuid: z.string().min(1),
  alias: z.looseObject({ gameName: z.string(), tagLine: z.string() }),
});
export type AliasLookup = z.infer<typeof AliasLookupSchema>;

/**
 * One queue's entry in ranked stats. Verified 16.17. Unranked queues carry `tier: ""` and `division: "NA"`;
 * `RANKED_SOLO_5x5` / `RANKED_FLEX_SR` carry `SILVER` / `IV` style values. `losses` reads `0` for players
 * other than the local one on 16.17 while `wins` looks real, so do not trust `losses` from `ranked-stats/{puuid}`.
 */
export const RankedQueueEntrySchema = z.looseObject({
  queueType: z.string(),
  tier: z.string(),
  division: z.string(),
  leaguePoints: z.number().int(),
  wins: z.number().int(),
  losses: z.number().int(),
  isProvisional: z.boolean(),
  highestTier: z.string().optional(),
  highestDivision: z.string().optional(),
  previousSeasonEndTier: z.string().optional(),
  previousSeasonEndDivision: z.string().optional(),
});
export type RankedQueueEntry = z.infer<typeof RankedQueueEntrySchema>;

/** Tiers seen or documented, highest last. Empty string means unranked. */
export const KNOWN_TIERS = [
  '',
  'IRON',
  'BRONZE',
  'SILVER',
  'GOLD',
  'PLATINUM',
  'EMERALD',
  'DIAMOND',
  'MASTER',
  'GRANDMASTER',
  'CHALLENGER',
] as const;

/**
 * `GET /lol-ranked/v1/current-ranked-stats` and `GET /lol-ranked/v1/ranked-stats/{puuid}` share this shape.
 * Verified 16.17 on own puuid, a friend and a non-friend (both returned real tiers). `queueMap` also holds
 * TFT and other queues whose shapes are not pinned; only the two Summoner's Rift queues are typed.
 */
export const RankedStatsSchema = z.looseObject({
  queueMap: z.looseObject({
    RANKED_SOLO_5x5: RankedQueueEntrySchema.optional(),
    RANKED_FLEX_SR: RankedQueueEntrySchema.optional(),
  }),
  highestRankedEntry: RankedQueueEntrySchema.optional(),
  highestRankedEntrySR: RankedQueueEntrySchema.optional(),
  highestCurrentSeasonReachedTierSR: z.string().optional(),
});
export type RankedStats = z.infer<typeof RankedStatsSchema>;

/**
 * `GET /lol-gameflow/v1/gameflow-phase`: a bare JSON string. Verified 16.17: `"EndOfGame"` by GET and, over
 * the WebSocket, the full custom-game sequence `Lobby, Matchmaking, ReadyCheck, ChampSelect, GameStart,
 * InProgress, WaitingForStats, PreEndOfGame, EndOfGame` (a custom vs bots still passes through Matchmaking
 * and ReadyCheck for a few milliseconds) plus `TerminatedInError` -> `None` for a game the server dropped.
 * Kept as a plain string so an unlisted phase is logged, not dropped; compare against `KNOWN_GAMEFLOW_PHASES`
 * at the use site.
 */
export const GameflowPhaseSchema = z.string();
export const KNOWN_GAMEFLOW_PHASES = [
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
  'TerminatedInError',
] as const;
export type KnownGameflowPhase = (typeof KNOWN_GAMEFLOW_PHASES)[number];

/** A member of `gameData.teamOne` / `teamTwo` in the gameflow session. Verified 16.17. */
export const GameflowTeamMemberSchema = z.looseObject({
  puuid: z.string().min(1),
  summonerId: z.number().int().optional(),
  championId: z.number().int().optional(),
  teamParticipantId: z.number().int().optional(),
  selectedPosition: z.string().optional(),
});
export type GameflowTeamMember = z.infer<typeof GameflowTeamMemberSchema>;

/**
 * `GET /lol-gameflow/v1/session` and its WebSocket event. Verified 16.17 by GET on the end-of-game screen and
 * by 58 events across two custom games: `gameData.gameId` is `0` in `Lobby` and becomes the real id (the one
 * match history uses) on the last `ChampSelect` update, just before `GameStart`; `gameData.queue.id` is `-1`
 * in `None`, 3100 ("SR Blind Pick Custom") in a blind custom; `queue.type` is `NORMAL` even for customs, so
 * use `isCustomGame`. `gameData.password` exists (empty here); never persist it. 404 when idle (from the
 * user's first smoke run; the 404 body is not in the fixtures).
 */
export const GameflowSessionSchema = z.looseObject({
  phase: GameflowPhaseSchema,
  gameData: z.looseObject({
    gameId: z.number().int(),
    isCustomGame: z.boolean(),
    gameName: z.string().optional(),
    queue: z.looseObject({
      id: z.number().int(),
      type: z.string().optional(),
      gameMode: z.string().optional(),
      name: z.string().optional(),
      isCustom: z.boolean().optional(),
      mapId: z.number().int().optional(),
    }),
    teamOne: z.array(GameflowTeamMemberSchema),
    teamTwo: z.array(GameflowTeamMemberSchema),
  }),
  map: z.looseObject({
    id: z.number().int(),
    gameMode: z.string().optional(),
    name: z.string().optional(),
  }),
  gameClient: z.looseObject({ running: z.boolean(), visible: z.boolean() }).optional(),
});
export type GameflowSession = z.infer<typeof GameflowSessionSchema>;

/** Per-participant stats in match history. Verified 16.17; the full object has ~118 keys, these are the ones we read. */
export const MatchParticipantStatsSchema = z.looseObject({
  participantId: z.number().int(),
  win: z.boolean(),
  kills: z.number().int(),
  deaths: z.number().int(),
  assists: z.number().int(),
  goldEarned: z.number().int(),
  totalDamageDealtToChampions: z.number().int(),
  totalMinionsKilled: z.number().int(),
  neutralMinionsKilled: z.number().int(),
  champLevel: z.number().int(),
  visionScore: z.number().int().optional(),
  gameEndedInEarlySurrender: z.boolean().optional(),
});
export type MatchParticipantStats = z.infer<typeof MatchParticipantStatsSchema>;

/** Verified 16.17. `timeline.role`/`lane` are the server's guess (`SOLO`/`NONE`, `NONE`/`JUNGLE`), not reliable. */
export const MatchParticipantSchema = z.looseObject({
  participantId: z.number().int(),
  teamId: TeamIdSchema,
  championId: z.number().int(),
  spell1Id: z.number().int().optional(),
  spell2Id: z.number().int().optional(),
  stats: MatchParticipantStatsSchema,
  timeline: z.looseObject({ role: z.string().optional(), lane: z.string().optional() }).optional(),
});
export type MatchParticipant = z.infer<typeof MatchParticipantSchema>;

/** Verified 16.17. `player.summonerName` is empty; identity is `gameName#tagLine`, key is `puuid`. */
export const MatchParticipantIdentitySchema = z.looseObject({
  participantId: z.number().int(),
  player: z.looseObject({
    puuid: z.string().min(1),
    summonerId: z.number().int(),
    gameName: z.string(),
    tagLine: z.string(),
    platformId: z.string().optional(),
  }),
});
export type MatchParticipantIdentity = z.infer<typeof MatchParticipantIdentitySchema>;

/** Verified 16.17. `win` is the string `"Win"` or `"Fail"`, not a boolean. */
export const MatchTeamSchema = z.looseObject({
  teamId: TeamIdSchema,
  win: z.string(),
  bans: z.array(z.looseObject({ championId: z.number().int(), pickTurn: z.number().int() })).optional(),
});
export type MatchTeam = z.infer<typeof MatchTeamSchema>;

/**
 * One game, as returned by both the match history list (`games.games[]`) and the detail endpoint. Verified
 * 16.17. Differences between the two, confirmed on the same game id: the list carries only the local player in
 * `participants`/`participantIdentities` (length 1, even for a full 5v5), the detail carries all ten. `teams`
 * is complete in both. `gameType` is `CUSTOM_GAME` for customs; `queueId` 3100 (blind), 3110 (draft), 3270
 * (custom Kiwi/mapId 12) seen; `endOfGameResult` is `GameComplete` or `Abort_TooFewPlayers`.
 */
export const MatchGameSchema = z.looseObject({
  gameId: z.number().int(),
  gameType: z.string(),
  queueId: z.number().int(),
  gameMode: z.string(),
  mapId: z.number().int(),
  gameCreation: z.number().int(),
  gameCreationDate: z.string().optional(),
  gameDuration: z.number().int(),
  gameVersion: z.string().optional(),
  platformId: z.string(),
  endOfGameResult: z.string().optional(),
  participants: z.array(MatchParticipantSchema),
  participantIdentities: z.array(MatchParticipantIdentitySchema),
  teams: z.array(MatchTeamSchema),
});
export type MatchGame = z.infer<typeof MatchGameSchema>;

/**
 * `GET /lol-match-history/v1/products/lol/{puuid}/matches?begIndex=0&endIndex=20`. Verified 16.17 for the local
 * player and for another puuid. `gameCount` was 21 for `endIndex=20` (inclusive window). Whether the client can
 * page further back than the default window is not yet tested.
 */
export const MatchHistoryListSchema = z.looseObject({
  accountId: z.number().int().optional(),
  platformId: z.string().optional(),
  games: z.looseObject({
    gameCount: z.number().int(),
    gameIndexBegin: z.number().int(),
    gameIndexEnd: z.number().int(),
    games: z.array(MatchGameSchema),
  }),
});
export type MatchHistoryList = z.infer<typeof MatchHistoryListSchema>;

/** `GET /lol-match-history/v1/games/{gameId}`. Verified 16.17 (10 participants for a completed 5v5 custom). */
export const MatchDetailSchema = MatchGameSchema;
export type MatchDetail = z.infer<typeof MatchDetailSchema>;

/**
 * Match history list, minimal. Only what the smoke script needs to pick a `gameId` for the match-detail probe.
 * Separate from the full schema so the smoke script still runs when the full shape drifts on a patch.
 */
export const MatchHistoryMinimalSchema = z.looseObject({
  games: z.looseObject({
    games: z.array(
      z.looseObject({
        gameId: z.number(),
        gameType: z.string().optional(),
        endOfGameResult: z.string().optional(),
      }),
    ),
  }),
});
export type MatchHistoryMinimal = z.infer<typeof MatchHistoryMinimalSchema>;

/**
 * Per-player stats in the end-of-game block. Verified 16.17. Two spellings coexist: the uppercase legacy keys
 * (`CHAMPIONS_KILLED`, `NUM_DEATHS`, `ASSISTS`, `WIN` as 0/1) and camelCase duplicates (`kills`, `deaths`,
 * `assists`, `win` absent). The uppercase ones are what community tooling has read for years, so they are the
 * pinned set; the camelCase ones are optional.
 */
export const EogPlayerStatsSchema = z.looseObject({
  CHAMPIONS_KILLED: z.number().int(),
  NUM_DEATHS: z.number().int(),
  ASSISTS: z.number().int(),
  GOLD_EARNED: z.number().int(),
  TOTAL_DAMAGE_DEALT_TO_CHAMPIONS: z.number().int(),
  MINIONS_KILLED: z.number().int(),
  NEUTRAL_MINIONS_KILLED: z.number().int(),
  LEVEL: z.number().int(),
  VISION_SCORE: z.number().int(),
  WIN: z.number().int(),
  kills: z.number().int().optional(),
  deaths: z.number().int().optional(),
  assists: z.number().int().optional(),
  goldEarned: z.number().int().optional(),
  totalMinionsKilled: z.number().int().optional(),
  champLevel: z.number().int().optional(),
});
export type EogPlayerStats = z.infer<typeof EogPlayerStatsSchema>;

/** The all-zero puuid the client gives bot players in the end-of-game block. */
export const BOT_PUUID = '00000000-0000-0000-0000-000000000000';

/**
 * One player in `teams[].players[]` and `localPlayer`. Verified 16.17. Bots have `botPlayer: true`,
 * `puuid` equal to `BOT_PUUID`, `summonerId: 0` and `riotIdTagLine: "BOT"`: filter on `botPlayer` before
 * keying anything by puuid. Names are `riotIdGameName#riotIdTagLine`; `summonerName` still carries the game
 * name here (unlike match history, where it is empty).
 */
export const EogPlayerSchema = z.looseObject({
  puuid: z.string(),
  summonerId: z.number().int(),
  teamId: TeamIdSchema,
  championId: z.number().int(),
  championName: z.string().optional(),
  riotIdGameName: z.string(),
  riotIdTagLine: z.string(),
  summonerName: z.string().optional(),
  isLocalPlayer: z.boolean(),
  botPlayer: z.boolean(),
  leaver: z.boolean().optional(),
  wasAfk: z.boolean().optional(),
  detectedTeamPosition: z.string().optional(),
  selectedPosition: z.string().optional(),
  stats: EogPlayerStatsSchema,
});
export type EogPlayer = z.infer<typeof EogPlayerSchema>;

/** Verified 16.17. `players` is only the players that were on that side (1 for a solo human vs 5 bots). */
export const EogTeamSchema = z.looseObject({
  teamId: TeamIdSchema,
  isWinningTeam: z.boolean(),
  isPlayerTeam: z.boolean().optional(),
  players: z.array(EogPlayerSchema),
});
export type EogTeam = z.infer<typeof EogTeamSchema>;

/**
 * `GET /lol-end-of-game/v1/eog-stats-block` and the `OnJsonApiEvent` for the same URI. Verified 16.17 from a
 * solo custom game against bots (one human): the WebSocket `Create` event arrived 0.3 s after
 * `gameflow-phase` became `WaitingForStats` and 0.9 s before it became `EndOfGame`, and the GET still
 * answered 200 with the same block while the client sat on the end-of-game screen. There is no `queueId` key
 * (use `gameType === "CUSTOM_GAME"`); `queueType` reads `NORMAL`. `gameLength` is seconds. The
 * block also carries `mucJwtDto` and `multiUserChatPassword` (post-game chat credentials): never persist the
 * raw block; fixtures and recordings go through `scrubValue`. The 5v5 human shape is still to be captured.
 */
export const EogStatsBlockSchema = z.looseObject({
  gameId: z.number().int(),
  gameType: z.string(),
  gameMode: z.string().optional(),
  gameLength: z.number().int(),
  queueId: z.number().int().nullable().optional(),
  queueType: z.string().optional(),
  ranked: z.boolean().optional(),
  invalid: z.boolean().optional(),
  gameEndedInEarlySurrender: z.boolean().optional(),
  teamEarlySurrendered: z.boolean().optional(),
  endOfGameTimestamp: z.number().optional(),
  teams: z.array(EogTeamSchema),
  localPlayer: EogPlayerSchema,
});
export type EogStatsBlock = z.infer<typeof EogStatsBlockSchema>;

/**
 * A lobby member, as found in `members[]`, `localMember` and `gameConfig.customTeam100/200[]`. Verified 16.17
 * from the WebSocket lobby events and a GET. Bots are members too: `isBot: true`, `puuid: ""`,
 * `summonerId: 0`, `botChampionId`, `botDifficulty`. **`teamId` is `0` for everyone in a custom lobby, even
 * after switching sides**; the side is which of `gameConfig.customTeam100` / `customTeam200` the puuid is in.
 * `summonerName` is empty (Riot IDs); there is no `gameName` here, so names come from a summoner lookup.
 */
export const LobbyMemberSchema = z.looseObject({
  puuid: z.string(),
  summonerId: z.number().int(),
  summonerName: z.string().optional(),
  summonerLevel: z.number().int().optional(),
  summonerIconId: z.number().int().optional(),
  isBot: z.boolean(),
  isLeader: z.boolean(),
  isSpectator: z.boolean(),
  ready: z.boolean().optional(),
  teamId: z.number().int(),
  botChampionId: z.number().int().optional(),
  botDifficulty: z.string().optional(),
  firstPositionPreference: z.string().optional(),
  secondPositionPreference: z.string().optional(),
  allowedInviteOthers: z.boolean().optional(),
  allowedStartActivity: z.boolean().optional(),
});
export type LobbyMember = z.infer<typeof LobbyMemberSchema>;

/**
 * `GET /lol-lobby/v2/lobby` (200) and the `OnJsonApiEvent` for the same URI. Verified 16.17: a blind-pick
 * custom lobby created from the client (`gameConfig.queueId` 3100, `isCustom` true, `mapId` 11,
 * `customMutatorName` "SimulPickStrategy", `customLobbyName` "<name>'s Game"). `partyId` is stable for the
 * life of the lobby and changes when a new one is created (two lobbies, two ids); the WebSocket sends
 * `Create` on creation, `Update` on every change (two per change), `Delete` with `data: null` at
 * `GameStart`. The body also carries `mucJwtDto` and `multiUserChatPassword` (lobby chat credentials): never
 * persist the raw body. `restrictions`, `invitations`, `warnings` are untyped.
 */
export const LobbySchema = z.looseObject({
  partyId: z.string().min(1),
  partyType: z.string().optional(),
  canStartActivity: z.boolean().optional(),
  gameConfig: z.looseObject({
    queueId: z.number().int(),
    gameMode: z.string(),
    isCustom: z.boolean(),
    mapId: z.number().int(),
    customLobbyName: z.string().optional(),
    customMutatorName: z.string().optional(),
    customSpectatorPolicy: z.string().optional(),
    maxTeamSize: z.number().int().optional(),
    isLobbyFull: z.boolean().optional(),
    customTeam100: z.array(LobbyMemberSchema),
    customTeam200: z.array(LobbyMemberSchema),
    customSpectators: z.array(LobbyMemberSchema).optional(),
  }),
  members: z.array(LobbyMemberSchema),
  localMember: LobbyMemberSchema,
  invitations: z.array(z.unknown()).optional(),
});
export type Lobby = z.infer<typeof LobbySchema>;

/** `OnJsonApiEvent` for `/lol-lobby/v2/lobby/members`: the members array on its own. Verified 16.17 (5 events). */
export const LobbyMembersSchema = z.array(LobbyMemberSchema);
