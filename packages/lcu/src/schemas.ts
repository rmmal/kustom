/**
 * Response schemas.
 *
 * TODO(M0.3): replace every placeholder below with the real shape derived from the fixtures under
 * `fixtures/<patch>/`, and test each schema against its fixture. Until then only what the smoke and
 * record-ws scripts themselves need is pinned down, and even that is loose (`looseObject` keeps unknown keys).
 *
 * Nothing in the companion may depend on a placeholder. See docs/03-lcu-reference.md status column.
 */

import { z } from 'zod';

/** Any JSON value. The placeholder for endpoints whose shape is still `unverified`. */
export const JsonValueSchema = z.unknown();

/** Any JSON object. */
export const JsonObjectSchema = z.record(z.string(), z.unknown());
export type JsonObject = z.infer<typeof JsonObjectSchema>;

/** Any JSON array. */
export const JsonArraySchema = z.array(z.unknown());

/**
 * `GET /lol-patch/v1/game-version`. Believed to be a bare JSON string such as `"16.17.812.4632"`.
 * Unverified; the smoke script falls back to `/system/v1/builds` when this fails.
 */
export const GameVersionSchema = z.string().min(1);

/** `GET /system/v1/builds`. Believed to carry `{ version: "..." }` among other keys. Unverified. */
export const SystemBuildsSchema = z.looseObject({ version: z.string().min(1) });

/**
 * `GET /lol-summoner/v1/current-summoner`, minimal. The smoke script needs `puuid` to fill path templates and
 * `gameName`/`tagLine` for the alias lookup; anything else stays untyped until M0.3.
 */
export const CurrentSummonerMinimalSchema = z.looseObject({
  puuid: z.string().min(1),
  summonerId: z.number().optional(),
  gameName: z.string().optional(),
  tagLine: z.string().optional(),
});
export type CurrentSummonerMinimal = z.infer<typeof CurrentSummonerMinimalSchema>;

/**
 * `GET /lol-match-history/v1/products/lol/{puuid}/matches`, minimal. Only what the smoke script needs to pick
 * a `gameId` for the match-detail probe (preferring a `CUSTOM_GAME`). Unverified.
 */
export const MatchHistoryMinimalSchema = z.looseObject({
  games: z.looseObject({
    games: z.array(
      z.looseObject({
        gameId: z.number(),
        gameType: z.string().optional(),
      }),
    ),
  }),
});
export type MatchHistoryMinimal = z.infer<typeof MatchHistoryMinimalSchema>;

/**
 * Gameflow phases from docs/03-lcu-reference.md. Kept as a plain string for now: an unexpected phase must not
 * make the companion drop the event. TODO(M0.3): decide whether to enum this after seeing the fixtures.
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
] as const;
