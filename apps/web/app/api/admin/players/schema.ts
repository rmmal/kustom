import { z } from 'zod';
import { booleanFieldSchema, idSchema, nullableRoleSchema, nullableTextSchema } from '@/lib/admin/formValues';

/**
 * `POST /api/admin/players`. One route, three actions, discriminated on `action` — the repo's
 * convention (`CLAUDE.md`) and what lets a plain HTML form say which button was pressed with a
 * hidden field.
 *
 * Every field that can be cleared accepts `""` (what a browser sends for the empty option) as
 * well as `null`: clearing a main role back to null is the reason M1.6 exists.
 */

/** Both roles are always written, so "none" clears rather than being read as "unchanged". */
export const setRolesRequestSchema = z.object({
  action: z.literal('set-roles'),
  playerId: idSchema,
  mainRole: nullableRoleSchema,
  secondaryRole: nullableRoleSchema,
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

export const adminPlayersRequestSchema = z.discriminatedUnion('action', [
  setRolesRequestSchema,
  setDiscordRequestSchema,
  setAdminRequestSchema,
]);

export type AdminPlayersRequest = z.infer<typeof adminPlayersRequestSchema>;

export const adminPlayersResponseSchema = z.object({
  ok: z.literal(true),
  action: z.enum(['set-roles', 'set-discord', 'set-admin']),
  playerId: z.uuid(),
});

export type AdminPlayersResponse = z.infer<typeof adminPlayersResponseSchema>;
