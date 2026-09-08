import { z } from 'zod';
import { requiredTextSchema } from '@/lib/admin/formValues';

/**
 * `POST /api/admin/seasons`: close the active season and open a new one.
 *
 * The switch is `public.start_season(name)` (`0002_start_season.sql`) so it is one transaction.
 * Carrying ratings forward — copy `mu`, reset `sigma` — is M5.3; this only moves which season
 * is active.
 */
export const startSeasonRequestSchema = z.object({
  name: requiredTextSchema.refine((value) => value.length <= 80, 'name is too long'),
});

export type StartSeasonRequest = z.infer<typeof startSeasonRequestSchema>;

export const startSeasonResponseSchema = z.object({
  ok: z.literal(true),
  season: z.object({
    id: z.uuid(),
    name: z.string().min(1),
    startsAt: z.iso.datetime({ offset: true }),
    isActive: z.literal(true),
  }),
});

export type StartSeasonResponse = z.infer<typeof startSeasonResponseSchema>;
