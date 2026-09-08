import { lobbyStatusSchema } from '@customs/db/schemas';
import { z } from 'zod';

/**
 * Response for `POST /api/companion/lobby`. The request body is
 * `companionLobbyPayloadSchema` from `@customs/db/schemas`, which the companion imports too.
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
});

export type CompanionLobbyResponse = z.infer<typeof companionLobbyResponseSchema>;
