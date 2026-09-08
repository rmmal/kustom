import { companionRankPayloadSchema } from '@customs/db/schemas';
import { withCompanionAuth } from '@/lib/companionRoute';
import { jsonOk } from '@/lib/http';
import { ingestRank } from '@/lib/ingest/rank';
import { companionRankResponseSchema } from './schema';

// node:crypto hashes the bearer token, so this route is not edge-compatible.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A rank reading for one PUUID, which is not necessarily the token's own player: the
 * companion looks up the rank of every unknown member of a lobby (M2.4) so a first-time
 * player can be seeded before their first game. The rank is a lookup the client performed,
 * not a claim about who the caller is, so any PUUID is accepted from any valid token.
 *
 * The player row is created if the PUUID is new.
 */
export const POST = withCompanionAuth(companionRankPayloadSchema, async (payload, { client }) => {
  const result = await ingestRank(client, payload);

  return jsonOk(companionRankResponseSchema, {
    ok: true,
    playerId: result.playerId,
    stored: result.stored,
  });
});
