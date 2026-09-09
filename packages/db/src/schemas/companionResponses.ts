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
  /**
   * **Knock again in this many milliseconds** (M2.5). Vercel gives the API no timer, so
   * "the roster has not changed for ten seconds" is measured on the posts we already get:
   * when the lobby is still `open` and holds ten or more people around — spectators included,
   * because the eleventh friend has nowhere else to stand — the server answers with the
   * milliseconds left on the stability clock (at least 1000, the full window when the roster
   * just changed) and the companion re-posts the *identical* payload after that delay unless a
   * real lobby event has produced a newer one first (M2.2).
   *
   * `null` means do nothing: fewer than ten, already `balanced`, or any other state.
   */
  recheckInMs: z.number().int().nonnegative().nullable(),
  /**
   * **PUUIDs the server would like a rank for** (M2.4), drawn from the members just posted:
   * those whose `players` row has no `rank_updated_at`, or one older than seven days, or no
   * row at all yet. Spectators are included — they play the next round, and a name is worth
   * having either way.
   *
   * This is the whole of "once, then weekly": the staleness rule is about our data, so it
   * lives where our data is, and a puuid drops off the list the moment its rank POST lands.
   * The companion holds no schedule, only an in-process de-duplicator so a burst of lobby
   * posts cannot ask the client for the same puuid twice.
   *
   * Order is the posted member order. An empty array means everyone is fresh.
   */
  ranksNeeded: z.array(z.string().min(1)),
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
  /**
   * Whether the rating fold ran for this post (M5.1). Optional so an older companion, and the
   * `in_progress` phase, are unaffected: the field the companion acts on is still `created`.
   *
   * A `source: 'backfill'` game is always `{ rated: false, reason: 'backfill' }` — stored, in
   * order, waiting for `pnpm --filter web rebuild-ratings` (M5.2). For an end-of-game post
   * `reason` names M2.5's gate when it did not rate: `duration`, `participant-count`,
   * `side-split`, `already-rated`.
   */
  rated: z.boolean().optional(),
  reason: z.string().nullable().optional(),
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

/** Ids per scan call. The companion batches at this size; the route refuses more. */
export const BACKFILL_SCAN_BATCH_SIZE = 100;

/**
 * `POST /api/companion/backfill/scan` (M5.1): "which of these games do you already have, and may I send
 * the rest?" **This comment is the whole backfill contract**; the companion (`apps/companion/src/backfill.ts`)
 * and the route implement it and nothing else restates it.
 *
 * Request: `{ gameIds: number[] }`, 1 to 100 positive integer `lcu_game_id`s, companion bearer token.
 *
 * Answer, 2xx: `{ ok: true, approved, unknown }`.
 * - `approved: true`: `unknown` is the subset of `gameIds` with no `games` row, in any order. The
 *   companion fetches a match detail for each and posts it; the others go into its local cache and are
 *   never asked about again.
 * - `approved: false`: `unknown` is always `[]`, the route sets `players.backfill_requested_at` once
 *   (a second scan does not move it), and the companion logs one sentence and stops until its next pass.
 *
 * Not approved is **either** `approved: false` **or** an HTTP 403. Any other non-2xx, a network error, or
 * a 2xx body that does not match this schema is "the scan failed": one log line and the pass comes back in
 * ten minutes with the same ids. A 404 while the route is not deployed is therefore a wait, never a refusal.
 *
 * The games themselves go to the existing `POST /api/companion/game` as the unchanged `phase: 'eog'` body
 * with `source: 'backfill'`, **no `partyId` key** and `role: null` on every participant
 * (`companionGamePayloadSchema`, `mapMatchDetail` in `@customs/lcu`). The route stores such a game without
 * rating it inline, requires the token's player among the participants with no lobby fallback (403
 * otherwise), never overwrites a row it already has, and **must answer 2xx with the usual
 * `companionGameResponseSchema` fields (`created` true or false) for a stored-but-unrated game**: a 2xx is
 * what deletes the companion's queue file, and a 400/403/404/422 deletes it as a permanent refusal.
 */
export const companionBackfillScanRequestSchema = z.object({
  gameIds: z.array(z.number().int().positive()).min(1).max(BACKFILL_SCAN_BATCH_SIZE),
});

export const companionBackfillScanResponseSchema = z.object({
  ok: z.literal(true),
  approved: z.boolean(),
  unknown: z.array(z.number().int().positive()),
});

export type CompanionErrorResponse = z.infer<typeof companionErrorResponseSchema>;
export type CompanionBackfillScanRequest = z.infer<typeof companionBackfillScanRequestSchema>;
export type CompanionBackfillScanResponse = z.infer<typeof companionBackfillScanResponseSchema>;
export type CompanionMeResponse = z.infer<typeof companionMeResponseSchema>;
export type CompanionLobbyResponse = z.infer<typeof companionLobbyResponseSchema>;
export type CompanionGameResponse = z.infer<typeof companionGameResponseSchema>;
export type CompanionRankResponse = z.infer<typeof companionRankResponseSchema>;
