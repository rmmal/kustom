import { companionLobbyPayloadSchema } from '@customs/db/schemas';
import { withCompanionAuth } from '@/lib/companionRoute';
import { jsonError, jsonOk } from '@/lib/http';
import { ingestLobby, mayReportLobby } from '@/lib/ingest/lobby';
import { companionLobbyResponseSchema } from './schema';

// node:crypto hashes the bearer token, so this route is not edge-compatible.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The companion posts the whole lobby member list every time it changes. Idempotent on
 * `lcu_party_id`: posting the same lobby twice leaves exactly one row and the same members.
 *
 * `reported_by_player_id` comes from the token, never from the body.
 *
 * Refused here, before anything is written:
 * - 403 when the token's player is neither in the posted `members` nor already the reporter
 *   of this party (architecture "Security": a companion may only report a lobby it is in).
 *
 * From `in_game` on the roster is frozen (M2.9): the post still answers 200 and the lobby
 * name and password still refresh, but no `lobby_members` row is added, removed or changed.
 */
export const POST = withCompanionAuth(companionLobbyPayloadSchema, async (payload, { client, identity }) => {
  if (!(await mayReportLobby(client, payload, identity))) {
    return jsonError(403, 'a companion may only report a lobby it is in');
  }

  const result = await ingestLobby(client, payload, identity.playerId);

  return jsonOk(companionLobbyResponseSchema, {
    ok: true,
    lobbyId: result.lobbyId,
    status: result.status,
    created: result.created,
    memberCount: result.memberCount,
    rosterFrozen: result.rosterFrozen,
  });
});
