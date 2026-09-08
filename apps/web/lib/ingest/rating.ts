import { type Rating, rateGame, seedFromRank } from '@customs/core';
import type { RatingInsert, SideValue } from '@customs/db';
import { MIN_RATED_DURATION_S, PLAYERS_PER_GAME } from '../lobbyState';
import type { ServiceClient } from '../supabase';

/**
 * The rating fold (M2.5): what an end-of-game block does to the leaderboard.
 *
 * `rateGame` comes from `@customs/core` and the maths is not repeated here. This file is the
 * gate, the claim, the read of the ratings that went in, and the write of the ones that came
 * out — in `started_at` order for one game, which is the same fold M5.2 replays for all of
 * them.
 */

/** Five a side. Anything else is not a game we rate. */
const TEAM_SIZE = PLAYERS_PER_GAME / 2;

export type RatingSkipReason = 'already-rated' | 'participant-count' | 'side-split' | 'duration';

export interface RatingFoldResult {
  rated: boolean;
  /** Why not, when `rated` is false. */
  reason: RatingSkipReason | null;
  /** How many `game_players` rows this request claimed. Ten, or zero, or a crash scar. */
  claimed: number;
}

interface GamePlayerRow {
  playerId: string;
  puuid: string;
  side: SideValue;
  muAfter: number | null;
  rankTier: string | null;
  rankDivision: string | null;
}

/**
 * Rate one stored game, once.
 *
 * The gate first: ten `game_players` rows, five a side, `duration_s` over 300 seconds. M1.5
 * stores *every* `CUSTOM_GAME` block — remakes and four-minute surrenders included — so this
 * is where a game nobody played stops. 300 exactly is not rated. The row is kept either way;
 * only `ratings` is left alone.
 */
export async function rateStoredGame(client: ServiceClient, gameId: string): Promise<RatingFoldResult> {
  const game = await selectGame(client, gameId);
  const rows = await selectGamePlayers(client, gameId);

  if (rows.length !== PLAYERS_PER_GAME) {
    console.info(`rating: game ${gameId} not rated: ${rows.length} participants, needs ten`);
    return { rated: false, reason: 'participant-count', claimed: 0 };
  }
  const blueRows = rows.filter((row) => row.side === 100).sort(byPuuid);
  const redRows = rows.filter((row) => row.side === 200).sort(byPuuid);
  if (blueRows.length !== TEAM_SIZE || redRows.length !== TEAM_SIZE) {
    console.info(
      `rating: game ${gameId} not rated: sides are ${blueRows.length} and ${redRows.length}, needs five each`,
    );
    return { rated: false, reason: 'side-split', claimed: 0 };
  }
  if (game.durationS <= MIN_RATED_DURATION_S) {
    console.info(`rating: game ${gameId} not rated: ${game.durationS}s is not over ${MIN_RATED_DURATION_S}s`);
    return { rated: false, reason: 'duration', claimed: 0 };
  }

  // Ordered by puuid on both sides, so the arrays handed to core are deterministic and a
  // rebuild (M5.2) reproduces exactly these numbers.
  const stored = await selectRatings(
    client,
    rows.map((row) => row.playerId),
    game.seasonId,
  );

  const before = new Map<string, Rating>();
  for (const row of rows) {
    before.set(
      row.playerId,
      stored.get(row.playerId)?.rating ?? seedFromRank(row.rankTier, row.rankDivision),
    );
  }

  const rated = rateGame(
    blueRows.map((row) => mustGet(before, row.playerId)),
    redRows.map((row) => mustGet(before, row.playerId)),
    game.winningSide,
  );

  const after = new Map<string, Rating>();
  blueRows.forEach((row, index) => {
    after.set(row.playerId, mustIndex(rated.blue, index));
  });
  redRows.forEach((row, index) => {
    after.set(row.playerId, mustIndex(rated.red, index));
  });

  // The claim is the null rating column, not a new column: whoever writes the first row owns
  // the fold. Two companions post the same game and both requests get this far; the loser's
  // update matches nothing and it stops here, having changed nothing.
  const ordered = [...rows].sort((a, b) => (a.playerId < b.playerId ? -1 : 1));
  let claimed = 0;
  for (const row of ordered) {
    const wrote = await writeRatingColumns(client, gameId, row.playerId, {
      before: mustGet(before, row.playerId),
      after: mustGet(after, row.playerId),
    });
    if (wrote) claimed += 1;
    else if (claimed === 0) {
      // The first row was already written: this game has been rated. Nothing else is touched,
      // and `ratings.updated_at` does not move.
      return { rated: false, reason: 'already-rated', claimed: 0 };
    }
  }

  if (claimed !== PLAYERS_PER_GAME) {
    // Between zero and ten is a crash scar: a request that died mid-fold. Say so loudly and
    // leave the rest to the M5.2 rebuild rather than guessing.
    console.error(
      `rating: game ${gameId} claimed ${claimed} of ${PLAYERS_PER_GAME} rows; the rest were already written`,
    );
  }

  await applyRatings(client, game.seasonId, game.winningSide, rows, after, stored);

  return { rated: true, reason: null, claimed };
}

function byPuuid(a: GamePlayerRow, b: GamePlayerRow): number {
  return a.puuid < b.puuid ? -1 : a.puuid > b.puuid ? 1 : 0;
}

function mustGet(map: Map<string, Rating>, key: string): Rating {
  const value = map.get(key);
  if (value === undefined) throw new Error(`rating: no rating for player ${key}`);
  return value;
}

function mustIndex(list: readonly Rating[], index: number): Rating {
  const value = list[index];
  if (value === undefined) throw new Error(`rating: core returned no rating at index ${index}`);
  return value;
}

interface StoredGame {
  seasonId: string;
  durationS: number;
  winningSide: SideValue;
}

async function selectGame(client: ServiceClient, gameId: string): Promise<StoredGame> {
  const { data, error } = await client
    .from('games')
    .select('season_id, duration_s, winning_side')
    .eq('id', gameId)
    .single();
  if (error) throw new Error(`rating: game select failed: ${error.message}`);
  if (data.winning_side !== 100 && data.winning_side !== 200) {
    throw new Error(`rating: game ${gameId} has no winning side`);
  }
  return { seasonId: data.season_id, durationS: data.duration_s, winningSide: data.winning_side };
}

async function selectGamePlayers(client: ServiceClient, gameId: string): Promise<GamePlayerRow[]> {
  const { data, error } = await client
    .from('game_players')
    .select('player_id, side, mu_after, players!inner(puuid, rank_tier, rank_division)')
    .eq('game_id', gameId);
  if (error) throw new Error(`rating: game_players select failed: ${error.message}`);

  return (data ?? [])
    .filter((row) => row.side === 100 || row.side === 200)
    .map((row) => ({
      playerId: row.player_id,
      puuid: row.players.puuid,
      side: row.side as SideValue,
      muAfter: row.mu_after,
      rankTier: row.players.rank_tier,
      rankDivision: row.players.rank_division,
    }));
}

interface StoredRating {
  rating: Rating;
  games: number;
  wins: number;
}

async function selectRatings(
  client: ServiceClient,
  playerIds: readonly string[],
  seasonId: string,
): Promise<Map<string, StoredRating>> {
  const { data, error } = await client
    .from('ratings')
    .select('player_id, mu, sigma, games, wins')
    .eq('season_id', seasonId)
    .in('player_id', playerIds);
  if (error) throw new Error(`rating: ratings select failed: ${error.message}`);

  return new Map(
    (data ?? []).map((row) => [
      row.player_id,
      { rating: { mu: row.mu, sigma: row.sigma }, games: row.games, wins: row.wins },
    ]),
  );
}

/**
 * One row's four rating columns, guarded by `mu_after is null`. `false` means somebody else
 * has already written it.
 */
async function writeRatingColumns(
  client: ServiceClient,
  gameId: string,
  playerId: string,
  ratings: { before: Rating; after: Rating },
): Promise<boolean> {
  const { data, error } = await client
    .from('game_players')
    .update({
      mu_before: ratings.before.mu,
      sigma_before: ratings.before.sigma,
      mu_after: ratings.after.mu,
      sigma_after: ratings.after.sigma,
    })
    .eq('game_id', gameId)
    .eq('player_id', playerId)
    .is('mu_after', null)
    .select('player_id');
  if (error) throw new Error(`rating: claim failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * The `ratings` upsert: the new `{ mu, sigma }`, one more game, and one more win for the five
 * on the winning side. Read-then-write is safe here — the claim above serialises the same
 * game, and one group cannot play two games at once.
 */
async function applyRatings(
  client: ServiceClient,
  seasonId: string,
  winningSide: SideValue,
  rows: readonly GamePlayerRow[],
  after: Map<string, Rating>,
  stored: Map<string, StoredRating>,
): Promise<void> {
  const inserts: RatingInsert[] = rows.map((row) => {
    const previous = stored.get(row.playerId);
    const rating = mustGet(after, row.playerId);
    return {
      player_id: row.playerId,
      season_id: seasonId,
      mu: rating.mu,
      sigma: rating.sigma,
      games: (previous?.games ?? 0) + 1,
      wins: (previous?.wins ?? 0) + (row.side === winningSide ? 1 : 0),
    };
  });

  const { error } = await client.from('ratings').upsert(inserts, { onConflict: 'player_id,season_id' });
  if (error) throw new Error(`rating: ratings upsert failed: ${error.message}`);
}
