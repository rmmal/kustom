import { z } from 'zod';

/**
 * Every boundary in this project is validated with zod, and both the companion and the bot
 * import the schema from here so there is exactly one definition per payload.
 *
 * M1.2 adds the table row schemas, M1.5 adds the request bodies for `/api/companion/*`.
 */

/**
 * A Riot PUUID. This is the identity for a player everywhere in the system; never a summoner
 * name, a Riot ID or a Discord ID (CLAUDE.md "Hard rules").
 *
 * Deliberately loose: the client is the only source of PUUIDs and we do not want a length
 * assumption to drop a real player. M1.2 may tighten it once fixtures exist.
 */
export const puuidSchema = z.string().min(1).brand<'Puuid'>();

export type Puuid = z.infer<typeof puuidSchema>;
