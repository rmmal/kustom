/**
 * `packages/db` owns the Supabase migrations, the generated database types and the zod
 * schemas shared by the API, the companion and the bot.
 *
 * Import boundary schemas from `@customs/db/schemas` (or from here), row types from here,
 * and nothing else. This package holds no client: `apps/web` creates the Supabase client
 * with the service role key and passes `Database` as its generic.
 */

import type { Tables, TablesInsert, TablesUpdate } from './types.js';

export * from './rosterKey.js';
export * from './schemas/index.js';
export type { Database, Enums, Json, Tables, TablesInsert, TablesUpdate } from './types.js';
export { Constants } from './types.js';

/** Rows, as `select()` returns them. */
export type SeasonRow = Tables<'seasons'>;
export type PlayerRow = Tables<'players'>;
export type RatingRow = Tables<'ratings'>;
export type LobbyRow = Tables<'lobbies'>;
export type LobbyMemberRow = Tables<'lobby_members'>;
export type SplitRow = Tables<'splits'>;
export type GameRow = Tables<'games'>;
export type GamePlayerRow = Tables<'game_players'>;
export type CompanionTokenRow = Tables<'companion_tokens'>;
export type CompanionCommandRow = Tables<'companion_commands'>;
export type DiscordConfigRow = Tables<'discord_config'>;

/**
 * `players` without `discord_id`. This is the only players relation anon and authenticated
 * can read, so every public page and the bot must select from it (see `0001_init.sql`).
 */
export type PlayerPublicRow = Tables<'players_public'>;

/** Insert shapes: optional where the column has a default. */
export type SeasonInsert = TablesInsert<'seasons'>;
export type PlayerInsert = TablesInsert<'players'>;
export type RatingInsert = TablesInsert<'ratings'>;
export type LobbyInsert = TablesInsert<'lobbies'>;
export type LobbyMemberInsert = TablesInsert<'lobby_members'>;
export type SplitInsert = TablesInsert<'splits'>;
export type GameInsert = TablesInsert<'games'>;
export type GamePlayerInsert = TablesInsert<'game_players'>;
export type CompanionTokenInsert = TablesInsert<'companion_tokens'>;
export type CompanionCommandInsert = TablesInsert<'companion_commands'>;
export type DiscordConfigInsert = TablesInsert<'discord_config'>;

/** Update shapes. */
export type PlayerUpdate = TablesUpdate<'players'>;
export type RatingUpdate = TablesUpdate<'ratings'>;
export type LobbyUpdate = TablesUpdate<'lobbies'>;
export type SplitUpdate = TablesUpdate<'splits'>;
export type CompanionCommandUpdate = TablesUpdate<'companion_commands'>;
export type DiscordConfigUpdate = TablesUpdate<'discord_config'>;

/** The season every rating and game hangs off before an admin starts a new one (M5.3). */
export const SEASON_ONE_ID = '00000000-0000-0000-0000-000000000001';
