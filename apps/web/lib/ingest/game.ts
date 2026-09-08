import {
  type CompanionGameEogPayload,
  type CompanionGameEogPayloadWithWinner,
  type GameInsert,
  type GamePlayerInsert,
  type Json,
  scrubRawEogBlock,
} from '@customs/db';
import type { ServiceClient } from '../supabase';
import { selectLatestLobby } from './lobby';
import { ensurePlayers } from './players';

/**
 * Game ingest from an end-of-game block.
 *
 * Deliberately not here: `rateGame` and the `ratings` update (`rating.ts`) and moving the lobby
 * to `finished` (`lobbyState.ts`, from the game route). This writes `games` and `game_players`
 * and keeps the whole block in `games.raw`, which is what every later column can be recomputed
 * from — including a rebuild (M5.2) that replays the fold from scratch.
 *
 * Idempotency is on `lcu_game_id`: two companions in the same game both post, and the second
 * post changes no rows.
 */

/** The only `gameType` we ingest. Anything else is not our night (`M2.5`). */
export const CUSTOM_GAME_TYPE = 'CUSTOM_GAME';

export function isCustomGame(payload: CompanionGameEogPayload): boolean {
  return payload.gameType === CUSTOM_GAME_TYPE;
}

/**
 * A companion may only report a game it played in (`docs/01-architecture.md` "Security").
 * The token says who the caller is; this asks whether that player is on the scoreboard.
 *
 * The architecture doc phrases this as "the block's `localPlayer` must match the token's
 * player". The companion flattens the block before posting, so there is no `localPlayer`
 * field to compare; membership of `participants` is the same check against one fewer
 * claimed field. See `04-decisions.md`.
 */
export function isParticipant(payload: CompanionGameEogPayload, puuid: string): boolean {
  return payload.participants.some((participant) => participant.puuid === puuid);
}

/** The first PUUID that appears twice on the scoreboard, or null. */
export function findDuplicateParticipant(payload: CompanionGameEogPayload): string | null {
  const seen = new Set<string>();
  for (const participant of payload.participants) {
    if (seen.has(participant.puuid)) return participant.puuid;
    seen.add(participant.puuid);
  }
  return null;
}

export interface GameIngestResult {
  gameId: string;
  lobbyId: string | null;
  /** False when this `lcu_game_id` was already stored — the idempotent case. */
  created: boolean;
  /** Rows in `game_players` for this game after the write. */
  participants: number;
}

export async function ingestEogGame(
  client: ServiceClient,
  payload: CompanionGameEogPayloadWithWinner,
): Promise<GameIngestResult> {
  const lobbyId = await findLobbyId(client, payload.partyId ?? null, payload.startedAt);

  const insert: GameInsert = {
    lcu_game_id: payload.gameId,
    lobby_id: lobbyId,
    started_at: payload.startedAt,
    duration_s: payload.durationS,
    winning_side: payload.winningSide,
    source: payload.source,
    // Scrubbed again here, not only in the route: this is the one place that writes
    // `games.raw`, `games` is public-read, and `scrubRawEogBlock` is idempotent (M2.10,
    // point 11). Backfill (M5.1) will write through this function too.
    raw: asJson(scrubRawEogBlock(payload.raw)),
    // season_id is left out: the column defaults to public.active_season_id().
  };

  const { data: inserted, error: insertError } = await client
    .from('games')
    .upsert(insert, { onConflict: 'lcu_game_id', ignoreDuplicates: true })
    .select('id, lobby_id')
    .maybeSingle();
  if (insertError) throw new Error(`ingestGame: insert failed: ${insertError.message}`);

  const game = inserted ?? (await selectGame(client, payload.gameId));
  const created = inserted !== null;

  await upsertGamePlayers(client, game.id, payload);

  return {
    gameId: game.id,
    lobbyId: game.lobby_id,
    created,
    participants: await countGamePlayers(client, game.id),
  };
}

async function selectGame(
  client: ServiceClient,
  lcuGameId: number,
): Promise<{ id: string; lobby_id: string | null }> {
  const { data, error } = await client
    .from('games')
    .select('id, lobby_id')
    .eq('lcu_game_id', lcuGameId)
    .maybeSingle();
  if (error) throw new Error(`ingestGame: select failed: ${error.message}`);
  if (!data) throw new Error(`ingestGame: game ${lcuGameId} vanished after a conflicting insert`);
  return data;
}

/**
 * The lobby this game was played from (M2.14): the party's live row, or the newest row it
 * has once that cycle closed. An end-of-game block can arrive minutes late — after the group
 * has already opened the night's next lobby with the same party id — and it still belongs to
 * the cycle it was played in.
 *
 * An `abandoned` row is **not** a lobby a game was played from: the two-hour sweep gave up on
 * it, so linking a real game to it would say the group played a lobby that dissolved. Such a
 * game is stored with `lobby_id: null` and still rated — ratings never depended on a lobby
 * existing, which is also what makes backfill (M5.1) possible.
 */
export async function findLobbyId(
  client: ServiceClient,
  partyId: string | null,
  startedAt?: string | null,
): Promise<string | null> {
  if (partyId === null) return null;

  // An unknown party id is not an error: the companion may have missed the lobby events.
  const lobby = await selectLatestLobby(client, partyId, startedAt);
  if (lobby === null) return null;

  if (lobby.status === 'abandoned') {
    console.warn(
      `ingestGame: party ${partyId} resolves only to abandoned lobby ${lobby.id}; storing the game with no lobby`,
    );
    return null;
  }

  return lobby.id;
}

/**
 * `on conflict do nothing` on `(game_id, player_id)`, so a repeat post writes nothing and a
 * post that follows a half-finished one fills in the rows that are missing.
 *
 * The `mu_*`/`sigma_*` columns are left null on purpose: rating happens a step later (M2.5)
 * and a rebuild (M5.2) rewrites them.
 */
async function upsertGamePlayers(
  client: ServiceClient,
  gameId: string,
  payload: CompanionGameEogPayloadWithWinner,
): Promise<void> {
  // The end-of-game block is the only place the client gives us a Riot ID for someone we have
  // only ever seen in a lobby (lobby members carry no `gameName`/`tagLine` at all, M2.10 point
  // 2), so the names go in with the players.
  const playerIds = await ensurePlayers(
    client,
    payload.participants.map((participant) => ({
      puuid: participant.puuid,
      summonerId: participant.summonerId,
      gameName: participant.gameName,
      tagLine: participant.tagLine,
    })),
  );

  const rows: GamePlayerInsert[] = [];
  for (const participant of payload.participants) {
    const playerId = playerIds.get(participant.puuid);
    if (playerId === undefined) continue;
    rows.push({
      game_id: gameId,
      player_id: playerId,
      side: participant.side,
      role: participant.role,
      champion_id: participant.championId,
      kills: participant.kills,
      deaths: participant.deaths,
      assists: participant.assists,
      gold: participant.gold,
      damage_to_champs: participant.damageToChamps,
      cs: participant.cs,
    });
  }
  if (rows.length === 0) return;

  const { error } = await client
    .from('game_players')
    .upsert(rows, { onConflict: 'game_id,player_id', ignoreDuplicates: true });
  if (error) throw new Error(`ingestGame: game_players insert failed: ${error.message}`);
}

async function countGamePlayers(client: ServiceClient, gameId: string): Promise<number> {
  const { count, error } = await client
    .from('game_players')
    .select('player_id', { count: 'exact', head: true })
    .eq('game_id', gameId);
  if (error) throw new Error(`ingestGame: game_players count failed: ${error.message}`);
  return count ?? 0;
}

/**
 * The raw block is already known to be a JSON object (zod parsed it out of the request body),
 * so its values are JSON by construction; `Record<string, unknown>` just cannot say so.
 */
function asJson(raw: Record<string, unknown>): Json {
  return raw as Json;
}
