import { scrubRawEogBlock } from '@customs/db';
import {
  companionGamePayloadSchema,
  companionGameResponseSchema,
  hasWinningTeam,
  NO_WINNING_TEAM_MESSAGE,
} from '@customs/db/schemas';
import { withCompanionAuth } from '@/lib/companionRoute';
import { jsonError, jsonOk } from '@/lib/http';
import {
  CUSTOM_GAME_TYPE,
  findDuplicateParticipant,
  ingestEogGame,
  isCustomGame,
  isParticipant,
} from '@/lib/ingest/game';
import { emitGameFinished } from '@/lib/ingest/hooks';
import { isLobbyMemberOfGame, selectActiveLobby } from '@/lib/ingest/lobby';
import { rateStoredGame } from '@/lib/ingest/rating';
import { moveLobbyLogged, sweepIdleLobbies } from '@/lib/lobbyState';

// node:crypto hashes the bearer token, so this route is not edge-compatible.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Two posts per game from the companion: `in_progress` when the client enters the game, and
 * `eog` with the end-of-game block.
 *
 * `in_progress` moves the party's live lobby to `in_game`, which freezes its roster (M2.9).
 * `eog` writes the game, runs the rating fold and moves the lobby to `finished` (M2.5). Both
 * are idempotent: `eog` dedupes on `lcu_game_id` and the fold claims the game with the null
 * `mu_after` columns, so everyone in the lobby who runs a companion posts the same block and
 * only the first post changes anything.
 *
 * Refused here, before anything is written:
 * - 422 when `gameType` is not `CUSTOM_GAME` — we only track our own customs;
 * - 422 when no team won: a remake or a `TerminatedInError` block (M2.10, point 6). The
 *   companion is not supposed to post one; if it does, nothing is written, nothing is rated
 *   and no lobby moves. A lobby already at `in_game` stays there permanently — the 2-hour
 *   sweep covers `open` and `balanced` only (M2.5) — and M5.5 lists it;
 * - 422 when the same PUUID appears twice on the scoreboard;
 * - 403 when the token's player is neither on the scoreboard nor a member of the lobby this
 *   game was played from, spectators included (M2.8).
 *
 * The raw block is scrubbed of its chat credentials before it goes anywhere near the database:
 * `games.raw` is public-read under RLS (M2.10, point 11).
 */
export const POST = withCompanionAuth(companionGamePayloadSchema, async (payload, { client, identity }) => {
  // The same one statement the lobby route runs: two hours idle and a lobby is given up on.
  await sweepIdleLobbies(client, new Date());

  if (payload.phase === 'in_progress') {
    const lobby = payload.partyId ? await selectActiveLobby(client, payload.partyId) : null;
    if (lobby !== null) {
      // From here the roster is history (M2.9). `in_game` never ages out.
      await moveLobbyLogged(
        client,
        { lobbyId: lobby.id, from: ['open', 'balanced'], to: 'in_game' },
        `game ${payload.gameId} in_progress`,
      );
    }

    return jsonOk(companionGameResponseSchema, {
      ok: true,
      phase: 'in_progress',
      created: false,
      gameId: null,
      lobbyId: lobby?.id ?? null,
      participants: 0,
    });
  }

  if (!isCustomGame(payload)) {
    return jsonError(422, `gameType must be ${CUSTOM_GAME_TYPE}`);
  }

  if (!hasWinningTeam(payload)) {
    return jsonError(422, NO_WINNING_TEAM_MESSAGE);
  }

  const duplicate = findDuplicateParticipant(payload);
  if (duplicate !== null) {
    return jsonError(422, 'the same puuid appears twice in participants');
  }

  // M2.8: a friend who sits out a round and watches is a real reporter. Their PUUID is not on
  // the scoreboard, but it is in `lobby_members` for the lobby this game was played from
  // (spectators are in the client's `members[]`, confirmed on 16.17 by M2.13).
  if (
    !isParticipant(payload, identity.puuid) &&
    !(await isLobbyMemberOfGame(client, payload.partyId ?? null, identity.playerId, payload.startedAt))
  ) {
    return jsonError(403, 'a companion may only report a game its own player was in');
  }

  const result = await ingestEogGame(client, { ...payload, raw: scrubRawEogBlock(payload.raw) });

  // The fold: ten rows, five a side, over five minutes, and exactly once per game (M2.5).
  const fold = await rateStoredGame(client, result.gameId);

  // A lobby that is already `finished` (the second companion's post) or that the sweep
  // abandoned between resolving it and here claims nothing and says so in the log.
  if (result.lobbyId !== null) {
    await moveLobbyLogged(
      client,
      { lobbyId: result.lobbyId, from: ['open', 'balanced', 'in_game'], to: 'finished' },
      `game ${result.gameId}`,
    );
  }

  // M3.3's seam. Only the post that actually did something announces it, so two companions in
  // one game produce one result.
  if (result.created || fold.rated) {
    await emitGameFinished({ gameId: result.gameId, lobbyId: result.lobbyId, rated: fold.rated });
  }

  return jsonOk(companionGameResponseSchema, {
    ok: true,
    phase: 'eog',
    created: result.created,
    gameId: result.gameId,
    lobbyId: result.lobbyId,
    participants: result.participants,
  });
});
