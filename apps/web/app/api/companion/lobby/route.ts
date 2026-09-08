import { companionLobbyPayloadSchema, companionLobbyResponseSchema } from '@customs/db/schemas';
import { withCompanionAuth } from '@/lib/companionRoute';
import { jsonError, jsonOk } from '@/lib/http';
import { ingestLobby, mayReportLobby } from '@/lib/ingest/lobby';

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
 *
 * Bot and placeholder entries are dropped by the payload schema before any of this, so an old
 * companion that posts a bot loses the bot and keeps its nine friends (M2.10, point 4). The
 * M1.8 caller check below therefore runs on the filtered list, which is the order the brief
 * asks for.
 */
export const POST = withCompanionAuth(companionLobbyPayloadSchema, async (payload, { client, identity }) => {
  if (payload.droppedMembers > 0) {
    console.warn(
      `companion lobby ${payload.partyId}: dropped ${payload.droppedMembers} bot or placeholder member(s)`,
    );
  }

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
