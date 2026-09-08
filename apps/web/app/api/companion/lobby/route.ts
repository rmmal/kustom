import { companionLobbyPayloadSchema, companionLobbyResponseSchema } from '@customs/db/schemas';
import { withCompanionAuth } from '@/lib/companionRoute';
import { readServerEnv } from '@/lib/env';
import { jsonError, jsonOk } from '@/lib/http';
// Registers the Discord listeners on `hooks.ts` at module load (M3.1, M3.3). Import for the
// side effect: with this line removed, everything below behaves identically and nothing posts.
import '@/lib/ingest/discord';
import { ingestLobby, mayReportLobby } from '@/lib/ingest/lobby';
import { sweepIdleLobbies } from '@/lib/lobbyState';
import { siteOrigin } from '@/lib/siteUrl';

// node:crypto hashes the bearer token, so this route is not edge-compatible.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The companion posts the whole lobby member list every time it changes. Idempotent: posting
 * the same lobby twice leaves exactly one live row and the same members.
 *
 * `reported_by_player_id` comes from the token, never from the body.
 *
 * Refused here, before anything is written:
 * - 403 when the token's player is neither in the posted `members` nor already the reporter
 *   of this party's live lobby (architecture "Security": a companion may only report a lobby
 *   it is in).
 *
 * From `in_game` on the roster is frozen (M2.9): the post still answers 200 and the lobby
 * name and password still refresh, but no `lobby_members` row is added, removed or changed.
 * Once the row is `finished` or `abandoned` the next post starts the night's next cycle
 * (M2.14).
 *
 * The state machine turns in `ingestLobby` (M2.5): ten or more people around, unchanged for
 * ten seconds, and the lobby balances — three `splits` rows, one of them chosen. The answer
 * carries `recheckInMs`, which is how those ten seconds are measured on a server with no
 * timers, and `ranksNeeded`, the PUUIDs on this list whose rank is missing or over a week
 * old (M2.4).
 *
 * Bot and placeholder entries are dropped by the payload schema before any of this, so an old
 * companion that posts a bot loses the bot and keeps its nine friends (M2.10, point 4). The
 * M1.8 caller check below therefore runs on the filtered list, which is the order the brief
 * asks for.
 */
export const POST = withCompanionAuth(
  companionLobbyPayloadSchema,
  async (payload, { client, identity, request }) => {
    if (payload.droppedMembers > 0) {
      console.warn(
        `companion lobby ${payload.partyId}: dropped ${payload.droppedMembers} bot or placeholder member(s)`,
      );
    }

    // One statement at the start of every companion post: a lobby nobody has mentioned for two
    // hours is given up on (M2.5). `in_game` is never swept.
    const now = new Date();
    await sweepIdleLobbies(client, now);

    if (!(await mayReportLobby(client, payload, identity))) {
      return jsonError(403, 'a companion may only report a lobby it is in');
    }

    const { CUSTOMS_NIGHT_TZ } = readServerEnv();
    const result = await ingestLobby(client, payload, identity.playerId, {
      now,
      timeZone: CUSTOMS_NIGHT_TZ,
      // Only used for the teams embed's `url` (M3.1). Nothing is written from it.
      requestOrigin: siteOrigin(request),
    });

    if (result.balanced !== null) {
      console.info(
        `lobby ${result.lobbyId} balanced: ${result.balanced.explanation} (${result.balanced.sitters.length} sitting out)`,
      );
    }

    return jsonOk(companionLobbyResponseSchema, {
      ok: true,
      lobbyId: result.lobbyId,
      status: result.status,
      created: result.created,
      memberCount: result.memberCount,
      rosterFrozen: result.rosterFrozen,
      recheckInMs: result.recheckInMs,
      ranksNeeded: result.ranksNeeded,
    });
  },
);
