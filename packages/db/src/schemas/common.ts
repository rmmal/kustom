import { type LobbyStatus, ROLES, type Role, type Side } from '@customs/core';
import { z } from 'zod';

/**
 * The primitives every other schema is built from. The literal values here are the same
 * values the database enums use (`0001_init.sql`) and the same unions `@customs/core`
 * declares, so a drift is a compile error rather than a runtime surprise.
 */

/**
 * A Riot PUUID. This is the identity for a player everywhere in the system; never a summoner
 * name, a Riot ID or a Discord ID (CLAUDE.md "Hard rules").
 *
 * Deliberately loose: the client is the only source of PUUIDs and we do not want a length
 * assumption to drop a real player.
 */
export const puuidSchema = z.string().min(1).brand<'Puuid'>();

export type Puuid = z.infer<typeof puuidSchema>;

/** `'top' | 'jungle' | 'mid' | 'adc' | 'support'`, straight from `@customs/core`. */
export const roleSchema = z.enum(ROLES);

/** Team side, matching the League client: 100 blue, 200 red. */
export const sideSchema = z.union([z.literal(100), z.literal(200)]);

/** Every lobby status, in lifecycle order. Pinned against `LobbyStatus` from core. */
export const LOBBY_STATUSES = [
  'open',
  'balanced',
  'in_game',
  'finished',
  'abandoned',
] as const satisfies readonly LobbyStatus[];

export const lobbyStatusSchema = z.enum(LOBBY_STATUSES);

/** How a game reached us: the companion's end-of-game block, or a match-history backfill. */
export const gameSourceSchema = z.enum(['eog', 'backfill']);

/** Commands the server queues for a companion to execute (M4.1). */
export const companionCommandKindSchema = z.enum(['create_lobby', 'invite', 'switch_side']);

/** Lifecycle of a queued command. */
export const companionCommandStatusSchema = z.enum(['pending', 'sent', 'acked', 'failed']);

/**
 * An LCU game id. The client sends a number; some transports stringify it. Both are
 * accepted and normalised to a number, which is what `games.lcu_game_id` (bigint) holds.
 */
export const lcuGameIdSchema = z.union([
  z.number().int().positive(),
  z
    .string()
    .regex(/^\d+$/)
    .transform((value) => Number(value))
    .refine((value) => Number.isSafeInteger(value) && value > 0, 'game id is out of range'),
]);

/**
 * An arbitrary JSON object we keep verbatim (`games.raw`, `companion_commands.payload`).
 * Passthrough by design: we assert it is an object and nothing more, so a client patch
 * that adds fields never drops a game.
 */
export const jsonObjectSchema = z.record(z.string(), z.unknown());

/** An OpenSkill rating as stored on `ratings` and `game_players`. */
export const ratingSchema = z.object({
  mu: z.number().finite(),
  sigma: z.number().finite().positive(),
});

export type RoleValue = z.infer<typeof roleSchema>;
export type SideValue = z.infer<typeof sideSchema>;
export type LobbyStatusValue = z.infer<typeof lobbyStatusSchema>;
export type GameSourceValue = z.infer<typeof gameSourceSchema>;
export type CompanionCommandKind = z.infer<typeof companionCommandKindSchema>;
export type CompanionCommandStatus = z.infer<typeof companionCommandStatusSchema>;
export type JsonObject = z.infer<typeof jsonObjectSchema>;

// The schemas above are the database's and core's vocabulary or they are nothing. These
// three lines fail the build if any of them drifts.
type _RoleMatchesCore = RoleValue extends Role ? (Role extends RoleValue ? true : never) : never;
type _SideMatchesCore = SideValue extends Side ? (Side extends SideValue ? true : never) : never;
type _LobbyStatusMatchesCore = LobbyStatusValue extends LobbyStatus
  ? LobbyStatus extends LobbyStatusValue
    ? true
    : never
  : never;

export const SCHEMA_VOCABULARY_MATCHES_CORE: [_RoleMatchesCore, _SideMatchesCore, _LobbyStatusMatchesCore] = [
  true,
  true,
  true,
];
