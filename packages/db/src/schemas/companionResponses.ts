import { z } from 'zod';
import { lobbyStatusSchema } from './common';

/**
 * What `/api/companion/*` answers. These live here, beside the request schemas, so
 * `apps/companion` parses the same definition the route validated its answer against
 * (M2.1): a response the companion cannot parse is a bug we want at compile time, not at
 * three in the morning in a friend's tray.
 *
 * Every route answers the same envelope: `{ ok: true, ... }` or `{ ok: false, error, issues? }`
 * (`apps/web/lib/http.ts`), so the companion branches on `ok` and nothing else. The error
 * half is the same for every route and is not repeated per response.
 */

/** The `{ ok: false }` half of every companion answer, whatever the status code. */
export const companionErrorResponseSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});

/**
 * `GET /api/companion/me`: who the bearer token says the caller is. The companion calls this
 * on first run to check the token it was pasted, and on start to log which player it is
 * reporting as. It writes nothing.
 */
export const companionMeResponseSchema = z.object({
  ok: z.literal(true),
  /** The identity. Everything the companion posts is attributed to this PUUID by the server. */
  puuid: z.string().min(1),
  playerId: z.uuid(),
  /** `players.display_name`, null until a name is known (M1.7). For a log line, nothing else. */
  displayName: z.string().nullable(),
});

/**
 * `POST /api/companion/lobby`.
 *
 * `status` is echoed so the companion can log it; the companion never sends a status. Who
 * moves a lobby between statuses is the server's business (M2.5).
 */
export const companionLobbyResponseSchema = z.object({
  ok: z.literal(true),
  lobbyId: z.uuid(),
  status: lobbyStatusSchema,
  /** False when this party id was already known: the second identical post. */
  created: z.boolean(),
  memberCount: z.number().int().nonnegative(),
  /**
   * True when the lobby has left `open`/`balanced` and its roster is now history (M2.9):
   * this post changed no `lobby_members` row and `memberCount` is what is stored.
   */
  rosterFrozen: z.boolean(),
});

/**
 * `POST /api/companion/game`, both phases.
 *
 * One flat shape for both so the companion does not have to branch twice. The `in_progress`
 * phase stores nothing yet — moving the lobby to `in_game` is M2.5 — so it answers with
 * `created: false` and no ids.
 *
 * A 2xx here, `created: false` included, means the server has the game and the companion may
 * delete its queued copy (M2.3).
 */
export const companionGameResponseSchema = z.object({
  ok: z.literal(true),
  phase: z.enum(['in_progress', 'eog']),
  /** False when this `lcu_game_id` was already stored: the second identical post. */
  created: z.boolean(),
  gameId: z.uuid().nullable(),
  lobbyId: z.uuid().nullable(),
  /** Rows in `game_players` for this game. */
  participants: z.number().int().nonnegative(),
});

/**
 * `POST /api/companion/rank`.
 *
 * `stored` is false when the payload was for a queue we do not seed ratings from: the player
 * row still exists (it may have been created by this very request), but its rank columns were
 * left alone.
 */
export const companionRankResponseSchema = z.object({
  ok: z.literal(true),
  playerId: z.uuid(),
  stored: z.boolean(),
});

export type CompanionErrorResponse = z.infer<typeof companionErrorResponseSchema>;
export type CompanionMeResponse = z.infer<typeof companionMeResponseSchema>;
export type CompanionLobbyResponse = z.infer<typeof companionLobbyResponseSchema>;
export type CompanionGameResponse = z.infer<typeof companionGameResponseSchema>;
export type CompanionRankResponse = z.infer<typeof companionRankResponseSchema>;
