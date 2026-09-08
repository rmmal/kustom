import { z } from 'zod';
import { requiredTextSchema } from '@/lib/admin/formValues';

/**
 * `POST /api/admin/seasons`: close the active season and open a new one.
 *
 * The switch is `public.start_season(name)` (`0002_start_season.sql`) so it is one transaction.
 * Carrying ratings forward — copy `mu`, reset `sigma` — is M5.3; this only moves which season
 * is active.
 *
 * `confirmSeasonName` is the guardrail (M3.9): the caller has to type the name of the season
 * being *ended*. It is optional in the schema on purpose, so that leaving it out is refused by
 * `startSeason` with the sentence that says what to type, rather than by a generic
 * "request body failed validation" — a form post would otherwise redirect with "that form was
 * not valid", which tells an admin nothing about what the field wanted.
 */

/** Absent, null, "" and whitespace all mean "nothing was typed". */
export const confirmSeasonNameSchema = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value) => {
    const trimmed = (value ?? '').trim();
    return trimmed.length === 0 ? null : trimmed;
  });

export const startSeasonRequestSchema = z.object({
  name: requiredTextSchema.refine((value) => value.length <= 80, 'name is too long'),
  confirmSeasonName: confirmSeasonNameSchema,
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
  /**
   * The season that was just closed, so the response says what happened, not only what is new.
   *
   * `z.guid()`, not `z.uuid()`: this can be Season 1, whose id is the seeded literal
   * `00000000-0000-0000-0000-000000000001` (`SEASON_ONE_ID`) and therefore has no version
   * nibble. The season being *started* always comes from `gen_random_uuid()`, so it stays
   * strict.
   */
  endedSeason: z
    .object({
      id: z.guid(),
      name: z.string().min(1),
    })
    .nullable(),
});

export type StartSeasonResponse = z.infer<typeof startSeasonResponseSchema>;
