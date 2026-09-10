import { z } from 'zod';
import { booleanFieldSchema, idSchema, nullableRoleSchema, nullableTextSchema } from '@/lib/admin/formValues';

/**
 * `POST /api/admin/players`. One route, four live actions and one retired one, discriminated on
 * `action` — the repo's convention (`CLAUDE.md`) and what lets a plain HTML form say which
 * button was pressed with a hidden field.
 *
 * Every field that can be cleared accepts `""` (what a browser sends for the empty option) as
 * well as `null`.
 */

/**
 * **Retired by M5.17.** Roles are inferred from the games people play and recomputed after
 * every rated game and every rebuild, so there is nothing here to set: the handler answers 410
 * with a sentence.
 *
 * The variant is kept, and its two role fields are optional, for exactly one reader — an admin
 * with `/admin/players` open in a tab from before the deploy. A removed variant would give them
 * `that form was not valid`, which says nothing true. `ROLES_ARE_INFERRED` says what happened.
 */
export const setRolesRequestSchema = z.object({
  action: z.literal('set-roles'),
  playerId: idSchema,
  mainRole: nullableRoleSchema.optional(),
  secondaryRole: nullableRoleSchema.optional(),
});

/**
 * The name the group uses (M1.7). `displayName: null` — which is what the empty form field
 * posts — clears the override and puts the row back on following the Riot `gameName`, so this
 * field is the only way in *and* the only way out of an admin-set name.
 */
export const setNameRequestSchema = z.object({
  action: z.literal('set-name'),
  playerId: idSchema,
  displayName: nullableTextSchema,
});

/** `discordId: null` (or "") unlinks. */
export const setDiscordRequestSchema = z.object({
  action: z.literal('set-discord'),
  playerId: idSchema,
  discordId: nullableTextSchema,
});

/**
 * The target state, not a toggle: a form that says "make this false" cannot race another tab
 * into flipping the wrong way.
 */
export const setAdminRequestSchema = z.object({
  action: z.literal('set-admin'),
  playerId: idSchema,
  isAdmin: booleanFieldSchema,
});

/**
 * Backfill approval (M5.1). Same shape and same reason as `set-admin`: the target state, so a
 * form that has been sitting open in a tab cannot flip the wrong way.
 */
export const setBackfillRequestSchema = z.object({
  action: z.literal('set-backfill'),
  playerId: idSchema,
  approved: booleanFieldSchema,
});

export const adminPlayersRequestSchema = z.discriminatedUnion('action', [
  setRolesRequestSchema,
  setNameRequestSchema,
  setDiscordRequestSchema,
  setAdminRequestSchema,
  setBackfillRequestSchema,
]);

export type AdminPlayersRequest = z.infer<typeof adminPlayersRequestSchema>;

/** No `set-roles`: that action never answers `ok`, it answers 410 (M5.17). */
export const adminPlayersResponseSchema = z.object({
  ok: z.literal(true),
  action: z.enum(['set-name', 'set-discord', 'set-admin', 'set-backfill']),
  playerId: z.uuid(),
});

export type AdminPlayersResponse = z.infer<typeof adminPlayersResponseSchema>;
