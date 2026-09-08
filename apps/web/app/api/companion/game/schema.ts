import { z } from 'zod';

/**
 * Response for `POST /api/companion/game`. The request body is
 * `companionGamePayloadSchema` from `@customs/db/schemas`: a discriminated union of the
 * `in_progress` ping and the `eog` block.
 *
 * One flat shape for both phases so the companion does not have to branch twice. The
 * `in_progress` phase stores nothing yet — moving the lobby to `in_game` is M2.5 — so it
 * answers with `created: false` and no ids.
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

export type CompanionGameResponse = z.infer<typeof companionGameResponseSchema>;
