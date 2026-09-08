import { z } from 'zod';
import {
  gameSourceSchema,
  jsonObjectSchema,
  lcuGameIdSchema,
  puuidSchema,
  roleSchema,
  sideSchema,
} from './common';

/**
 * The three bodies the companion POSTs to `/api/companion/*` (M1.5, filled by M2.2 to
 * M2.4). The companion imports these to build its requests and the API imports them to
 * parse the request body, so there is exactly one definition of each payload.
 *
 * The API never trusts the identity claims in here beyond what the bearer token says the
 * companion is (architecture "Security"). These schemas only say the shape is well formed.
 */

/** Optional free text from the client: absent, null and "" all mean "not known". */
const optionalText = z
  .string()
  .trim()
  .nullish()
  .transform((value) => (value ? value : null));

// ---------------------------------------------------------------------------
// POST /api/companion/lobby
// ---------------------------------------------------------------------------

/** One member of the lobby as the client reports them. */
export const companionLobbyMemberSchema = z.object({
  puuid: puuidSchema,
  summonerId: optionalText,
  gameName: optionalText,
  tagLine: optionalText,
  /** `null` while the client has not placed them on a team yet. */
  side: sideSchema.nullish().transform((value) => value ?? null),
  isSpectator: z.boolean().default(false),
});

/**
 * The full member list, posted every time it changes. The server debounces and decides
 * when the lobby is stable enough to balance; the companion just reports.
 */
export const companionLobbyPayloadSchema = z.object({
  partyId: z.string().min(1),
  lobbyName: optionalText,
  lobbyPassword: optionalText,
  members: z.array(companionLobbyMemberSchema).max(20),
});

// ---------------------------------------------------------------------------
// POST /api/companion/game
// ---------------------------------------------------------------------------

/** One participant's line of the end-of-game block, already flattened by the companion. */
export const companionGameParticipantSchema = z.object({
  puuid: puuidSchema,
  side: sideSchema,
  role: roleSchema.nullish().transform((value) => value ?? null),
  championId: z.number().int().nonnegative().nullish().default(null),
  kills: z.number().int().nonnegative().default(0),
  deaths: z.number().int().nonnegative().default(0),
  assists: z.number().int().nonnegative().default(0),
  gold: z.number().int().nonnegative().default(0),
  damageToChamps: z.number().int().nonnegative().default(0),
  cs: z.number().int().nonnegative().default(0),
});

/**
 * The companion posts twice per game: once when the client enters `InProgress` so the
 * lobby can move to `in_game`, and once with the end-of-game block. A discriminated union
 * keeps the two apart instead of a pile of optional fields.
 */
export const companionGamePayloadSchema = z.discriminatedUnion('phase', [
  z.object({
    phase: z.literal('in_progress'),
    gameId: lcuGameIdSchema,
    partyId: z.string().min(1).nullish(),
    startedAt: z.iso.datetime({ offset: true }).nullish(),
  }),
  z.object({
    phase: z.literal('eog'),
    gameId: lcuGameIdSchema,
    partyId: z.string().min(1).nullish(),
    source: gameSourceSchema.default('eog'),
    /** The client's own `gameType`. The API drops anything that is not `CUSTOM_GAME` (M2.5). */
    gameType: z.string().nullish(),
    startedAt: z.iso.datetime({ offset: true }),
    durationS: z.number().int().nonnegative(),
    winningSide: sideSchema,
    participants: z.array(companionGameParticipantSchema).min(1).max(10),
    /** The whole end-of-game block, stored in `games.raw`. Every derived column can be recomputed from it. */
    raw: jsonObjectSchema,
  }),
]);

// ---------------------------------------------------------------------------
// POST /api/companion/rank
// ---------------------------------------------------------------------------

/**
 * A rank reading for one PUUID. Tier and division are kept as the client's own strings;
 * `packages/core` maps them to a seed and treats anything it does not recognise as
 * unranked, so a new tier name never breaks ingest.
 */
export const companionRankPayloadSchema = z.object({
  puuid: puuidSchema,
  tier: optionalText,
  division: optionalText,
  lp: z.number().int().nonnegative().nullish().default(null),
  queue: z.string().min(1).default('RANKED_SOLO_5x5'),
});

export type CompanionLobbyMember = z.infer<typeof companionLobbyMemberSchema>;
export type CompanionLobbyPayload = z.infer<typeof companionLobbyPayloadSchema>;
export type CompanionGameParticipant = z.infer<typeof companionGameParticipantSchema>;
export type CompanionGamePayload = z.infer<typeof companionGamePayloadSchema>;
export type CompanionGameEogPayload = Extract<CompanionGamePayload, { phase: 'eog' }>;
export type CompanionRankPayload = z.infer<typeof companionRankPayloadSchema>;
