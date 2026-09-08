import { companionGamePayloadSchema } from '@customs/db/schemas';
import { withCompanionAuth } from '@/lib/companionRoute';
import { jsonError, jsonOk } from '@/lib/http';
import {
  CUSTOM_GAME_TYPE,
  findDuplicateParticipant,
  ingestEogGame,
  isCustomGame,
  isParticipant,
} from '@/lib/ingest/game';
import { companionGameResponseSchema } from './schema';

// node:crypto hashes the bearer token, so this route is not edge-compatible.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Two posts per game from the companion: `in_progress` when the client enters the game, and
 * `eog` with the end-of-game block.
 *
 * `eog` is idempotent on `lcu_game_id`: everyone in the lobby who runs a companion posts the
 * same game, and only the first post writes anything.
 *
 * Refused here, before anything is written:
 * - 422 when `gameType` is not `CUSTOM_GAME` — we only track our own customs;
 * - 422 when the same PUUID appears twice on the scoreboard;
 * - 403 when the token's player is not on the scoreboard (architecture "Security": a
 *   companion may only report a game it was in).
 */
export const POST = withCompanionAuth(companionGamePayloadSchema, async (payload, { client, identity }) => {
  if (payload.phase === 'in_progress') {
    // Accepted and acknowledged; the lobby transition to `in_game` lands with M2.5.
    return jsonOk(companionGameResponseSchema, {
      ok: true,
      phase: 'in_progress',
      created: false,
      gameId: null,
      lobbyId: null,
      participants: 0,
    });
  }

  if (!isCustomGame(payload)) {
    return jsonError(422, `gameType must be ${CUSTOM_GAME_TYPE}`);
  }

  const duplicate = findDuplicateParticipant(payload);
  if (duplicate !== null) {
    return jsonError(422, 'the same puuid appears twice in participants');
  }

  if (!isParticipant(payload, identity.puuid)) {
    return jsonError(403, 'a companion may only report a game its own player was in');
  }

  const result = await ingestEogGame(client, payload);

  return jsonOk(companionGameResponseSchema, {
    ok: true,
    phase: 'eog',
    created: result.created,
    gameId: result.gameId,
    lobbyId: result.lobbyId,
    participants: result.participants,
  });
});
