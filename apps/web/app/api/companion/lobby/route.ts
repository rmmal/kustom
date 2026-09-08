import { companionLobbyPayloadSchema } from '@customs/db/schemas';
import { withCompanionAuth } from '@/lib/companionRoute';
import { jsonOk } from '@/lib/http';
import { ingestLobby } from '@/lib/ingest/lobby';
import { companionLobbyResponseSchema } from './schema';

// node:crypto hashes the bearer token, so this route is not edge-compatible.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The companion posts the whole lobby member list every time it changes. Idempotent on
 * `lcu_party_id`: posting the same lobby twice leaves exactly one row and the same members.
 *
 * `reported_by_player_id` comes from the token, never from the body.
 */
export const POST = withCompanionAuth(companionLobbyPayloadSchema, async (payload, { client, identity }) => {
  const result = await ingestLobby(client, payload, identity.playerId);

  return jsonOk(companionLobbyResponseSchema, {
    ok: true,
    lobbyId: result.lobbyId,
    status: result.status,
    created: result.created,
    memberCount: result.memberCount,
  });
});
