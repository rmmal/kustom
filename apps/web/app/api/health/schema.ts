import { z } from 'zod';

/**
 * Response schema for `GET /api/health`. Route-local on purpose: it is not a boundary any
 * client shares. Anything the companion or the bot also parses belongs in `@customs/db/schemas`.
 */
export const healthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal('customs-night'),
  time: z.iso.datetime(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
