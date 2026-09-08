import { z } from 'zod';

/**
 * Response for `POST /api/companion/rank`. The request body is
 * `companionRankPayloadSchema` from `@customs/db/schemas`.
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

export type CompanionRankResponse = z.infer<typeof companionRankResponseSchema>;
