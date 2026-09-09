import { displayRating, type Rating, seedFromRank } from '@customs/core';
import type { RoleValue, SideValue } from '@customs/db';
import { inLaneOrder, LANE_ORDER } from '../laneOrder';
import type { PublicClient } from '../publicClient';
import { provenRating } from '../ratingDisplay';
import type { PlayerName } from '../tonight/types';
import { SETTLING_GAMES } from './copy';
import { sortBoardRows } from './order';
import { currentStreak } from './streak';
import type {
  BoardRow,
  BoardView,
  PlayerBoardView,
  RecentGame,
  RecentTeammate,
  RoleRecord,
  SeasonView,
} from './types';

/**
 * Everything `/leaderboard` and `/p/[puuid]` show, read with the **anon key** (M3.5).
 *
 * Both pages are server components, public, and have no login: the reads go through RLS
 * exactly as a phone would make them, and names come from `players_public` — `players` minus
 * `discord_id` — looked up by the ids being rendered, never carried in from a roster.
 *
 * Two rules the rest of the file exists to keep:
 *
 * - **One rule for a player's rating.** The `ratings` row for the active season, and
 *   `seedFromRank` in memory when there is none. That is what `loadPool` balances from and
 *   what the tonight page prints, so a seeded player who has not played yet appears on the
 *   board with the number the balancer would use rather than not appearing at all (M3.5's
 *   "zero games this season" edge case).
 * - **Proven is `provenRating`, once.** `ratings.ordinal` is a generated column and the index
 *   the season is sorted by, but the integer on the page comes through core, so SQL and core
 *   cannot disagree about a row's position.
 */

/**
 * How far back the streak column looks: the season's most recent games, newest first.
 *
 * The streak is the run at the front of a player's history, so this only matters for somebody
 * whose whole run is older than this many games of everybody else's — roughly forty nights.
 * The cap is here because a season's `game_players` is thousands of rows and PostgREST caps a
 * response at a thousand; reading a bounded window is honest, and reading everything would be
 * silently truncated in an order nothing controls.
 */
const STREAK_GAME_WINDOW = 200;

/** `in (…)` lists are a URL, and ten rows a game means ninety games is nine hundred rows. */
const GAME_ID_CHUNK = 90;

/** `05-design.md` gives the chart the detail view underneath it; five is what fits above the fold. */
const RECENT_GAMES = 5;

/** Every game of a season, for the history chart. Larger than any season the group will play. */
const SEASON_GAME_LIMIT = 1_000;

interface SeasonGame {
  id: string;
  startedAt: string;
  durationS: number;
  winningSide: SideValue;
}

interface PlayerRow {
  id: string;
  puuid: string;
  name: PlayerName;
  rankTier: string | null;
  rankDivision: string | null;
}

interface RatingRow {
  rating: Rating;
  games: number;
  wins: number;
}

/**
 * The board. One row per player the database knows, ordered by Proven descending.
 *
 * Nobody is filtered out: a friend seeded last night who cannot find themselves will ask why,
 * and a board that hides its newest players is the board M3.8 exists to explain.
 */
export async function loadBoard(client: PublicClient): Promise<BoardView> {
  const season = await selectSeason(client);
  if (season === null) return { season: null, rows: [] };

  const [players, ratings, results] = await Promise.all([
    loadAllPlayers(client),
    loadRatings(client, season.id),
    loadRecentResults(client, season.id),
  ]);

  const rows: BoardRow[] = players.map((player) => {
    const stored = ratings.get(player.id);
    const rating = stored?.rating ?? seedFromRank(player.rankTier, player.rankDivision);
    const games = stored?.games ?? 0;
    const wins = stored?.wins ?? 0;

    return {
      puuid: player.puuid,
      name: player.name,
      proven: provenRating(rating),
      rating: displayRating(rating.mu),
      games,
      wins,
      losses: games - wins,
      streak: currentStreak(results.get(player.id) ?? []),
      settling: games < SETTLING_GAMES,
    };
  });

  return { season, rows: sortBoardRows(rows) };
}

/**
 * One player's page: the two numbers, the `Rating` history, the role record and the last few
 * games. `null` when no `players_public` row has that puuid, which the page turns into a 404.
 */
export async function loadPlayerBoard(client: PublicClient, puuid: string): Promise<PlayerBoardView | null> {
  const player = await selectPlayer(client, puuid);
  if (player === null) return null;

  const season = await selectSeason(client);
  const seed = displayRating(seedFromRank(player.rankTier, player.rankDivision).mu);
  if (season === null) {
    return {
      puuid: player.puuid,
      name: player.name,
      season: null,
      rating: 0,
      proven: 0,
      games: 0,
      wins: 0,
      losses: 0,
      settling: true,
      seed,
      history: [],
      roles: [],
      recent: [],
    };
  }

  const [ratings, games, rows] = await Promise.all([
    loadRatings(client, season.id, [player.id]),
    loadSeasonGames(client, season.id, { ascending: true, limit: SEASON_GAME_LIMIT }),
    loadPlayerGameRows(client, player.id),
  ]);

  const byGame = new Map(games.map((game) => [game.id, game]));
  // The player's rated games of this season, oldest first: `game_players` comes back in
  // whatever order Postgres feels like, and the fold is a walk through `started_at`.
  const played = rows
    .filter((row) => row.muAfter !== null && byGame.has(row.gameId))
    .map((row) => ({ row, game: byGame.get(row.gameId) as SeasonGame }))
    .sort((a, b) => Date.parse(a.game.startedAt) - Date.parse(b.game.startedAt));

  const stored = ratings.get(player.id);
  const rating = stored?.rating ?? seedFromRank(player.rankTier, player.rankDivision);
  const gamesPlayed = stored?.games ?? 0;
  const wins = stored?.wins ?? 0;

  const recent = await loadRecentGames(client, played.slice(-RECENT_GAMES).reverse());

  return {
    puuid: player.puuid,
    name: player.name,
    season,
    rating: displayRating(rating.mu),
    proven: provenRating(rating),
    games: gamesPlayed,
    wins,
    losses: gamesPlayed - wins,
    settling: gamesPlayed < SETTLING_GAMES,
    seed,
    history: historySeries(played),
    roles: roleRecord(played),
    recent,
  };
}

/**
 * The plotted series: the rating this player carried into their first game, then the rating
 * they carried out of every game since.
 *
 * The first point is a `mu_before` on purpose — a chart that starts at the outcome of game one
 * hides the only move a player with one game has made.
 */
function historySeries(played: readonly { row: PlayerGameRow }[]): number[] {
  const first = played[0];
  if (first === undefined) return [];

  const series = first.row.muBefore === null ? [] : [displayRating(first.row.muBefore)];
  for (const { row } of played) {
    if (row.muAfter !== null) series.push(displayRating(row.muAfter));
  }
  return series;
}

/** Lane order, and only the roles the scoreboard actually gave them. */
function roleRecord(played: readonly { row: PlayerGameRow; game: SeasonGame }[]): RoleRecord[] {
  const byRole = new Map<RoleValue, RoleRecord>();
  for (const { row, game } of played) {
    // A game the scoreboard has no role for is not attributable to one; it still counts in
    // `ratings.games`, which is why these two totals can differ and neither is wrong.
    if (row.role === null) continue;
    const record = byRole.get(row.role) ?? { role: row.role, games: 0, wins: 0, losses: 0 };
    record.games += 1;
    if (row.side === game.winningSide) record.wins += 1;
    else record.losses += 1;
    byRole.set(row.role, record);
  }

  return LANE_ORDER.map((role) => byRole.get(role)).filter((record): record is RoleRecord => !!record);
}

/**
 * The last few games, each with the five the player was on, in lane order.
 *
 * Names are read from `players_public` by the ids on the scoreboard — never from the lobby
 * roster, which is a different ten once a lobby has been frozen at `in_game`.
 */
async function loadRecentGames(
  client: PublicClient,
  played: readonly { row: PlayerGameRow; game: SeasonGame }[],
): Promise<RecentGame[]> {
  if (played.length === 0) return [];

  const gameIds = played.map(({ game }) => game.id);
  const rows = await loadGameRows(client, gameIds);
  const names = await loadNamesByPlayerId(
    client,
    rows.map((row) => row.playerId),
  );

  return played.map(({ row, game }) => {
    const team: RecentTeammate[] = rows
      .filter((other) => other.gameId === game.id && other.side === row.side)
      // A scoreboard row whose player we cannot read is not a row we can draw: no name and no
      // puuid to key it on. The foreign key says it cannot happen; a blank line in a list of
      // five would read as a bug if it ever did.
      .flatMap((other) => {
        const player = names.get(other.playerId);
        return player === undefined ? [] : [{ puuid: player.puuid, name: player.name, role: other.role }];
      });

    return {
      gameId: game.id,
      startedAt: game.startedAt,
      durationS: game.durationS,
      won: row.side === game.winningSide,
      side: row.side,
      role: row.role,
      muBefore: row.muBefore,
      muAfter: row.muAfter,
      team: inLaneOrder(team),
    };
  });
}

/** The active season, or `null`: the page then says so and lists nobody. */
async function selectSeason(client: PublicClient): Promise<SeasonView | null> {
  const { data, error } = await client
    .from('seasons')
    .select('id, name')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`board: season lookup failed: ${error.message}`);
  return data ?? null;
}

/** `players_public`: `players` minus `discord_id`, and the only players relation anon can read. */
async function loadAllPlayers(client: PublicClient): Promise<PlayerRow[]> {
  const { data, error } = await client
    .from('players_public')
    .select('id, puuid, display_name, game_name, rank_tier, rank_division');
  if (error) throw new Error(`board: player lookup failed: ${error.message}`);
  return (data ?? []).flatMap((row) => (row.id === null || row.puuid === null ? [] : [toPlayer(row)]));
}

async function selectPlayer(client: PublicClient, puuid: string): Promise<PlayerRow | null> {
  const { data, error } = await client
    .from('players_public')
    .select('id, puuid, display_name, game_name, rank_tier, rank_division')
    .eq('puuid', puuid)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`board: player lookup failed: ${error.message}`);
  if (!data || data.id === null || data.puuid === null) return null;
  return toPlayer(data);
}

interface PublicPlayerRow {
  id: string | null;
  puuid: string | null;
  display_name: string | null;
  game_name: string | null;
  rank_tier: string | null;
  rank_division: string | null;
}

function toPlayer(row: PublicPlayerRow): PlayerRow {
  return {
    id: row.id as string,
    puuid: row.puuid as string,
    // M3.10's fallback is applied at render; the loader carries the honest `null`.
    name: row.display_name ?? row.game_name ?? null,
    rankTier: row.rank_tier,
    rankDivision: row.rank_division,
  };
}

/** Names for a set of player ids, from `players_public`, for the ids being rendered. */
async function loadNamesByPlayerId(
  client: PublicClient,
  playerIds: readonly string[],
): Promise<Map<string, { puuid: string; name: PlayerName }>> {
  const unique = [...new Set(playerIds)];
  if (unique.length === 0) return new Map();

  const { data, error } = await client
    .from('players_public')
    .select('id, puuid, display_name, game_name')
    .in('id', unique);
  if (error) throw new Error(`board: name lookup failed: ${error.message}`);

  const names = new Map<string, { puuid: string; name: PlayerName }>();
  for (const row of data ?? []) {
    if (row.id === null || row.puuid === null) continue;
    names.set(row.id, { puuid: row.puuid, name: row.display_name ?? row.game_name ?? null });
  }
  return names;
}

async function loadRatings(
  client: PublicClient,
  seasonId: string,
  playerIds?: readonly string[],
): Promise<Map<string, RatingRow>> {
  let query = client.from('ratings').select('player_id, mu, sigma, games, wins').eq('season_id', seasonId);
  if (playerIds !== undefined) query = query.in('player_id', [...playerIds]);

  const { data, error } = await query;
  if (error) throw new Error(`board: rating lookup failed: ${error.message}`);

  return new Map(
    (data ?? []).map((row) => [
      row.player_id,
      { rating: { mu: row.mu, sigma: row.sigma }, games: row.games, wins: row.wins },
    ]),
  );
}

async function loadSeasonGames(
  client: PublicClient,
  seasonId: string,
  options: { ascending: boolean; limit: number },
): Promise<SeasonGame[]> {
  const { data, error } = await client
    .from('games')
    .select('id, started_at, duration_s, winning_side')
    .eq('season_id', seasonId)
    .order('started_at', { ascending: options.ascending })
    .limit(options.limit);
  if (error) throw new Error(`board: game lookup failed: ${error.message}`);

  return (data ?? []).flatMap((row) =>
    row.winning_side === 100 || row.winning_side === 200
      ? [
          {
            id: row.id,
            startedAt: row.started_at,
            durationS: row.duration_s,
            winningSide: row.winning_side as SideValue,
          },
        ]
      : [],
  );
}

interface PlayerGameRow {
  gameId: string;
  playerId: string;
  side: SideValue;
  role: RoleValue | null;
  muBefore: number | null;
  muAfter: number | null;
}

async function loadPlayerGameRows(client: PublicClient, playerId: string): Promise<PlayerGameRow[]> {
  const { data, error } = await client
    .from('game_players')
    .select('game_id, player_id, side, role, mu_before, mu_after')
    .eq('player_id', playerId);
  if (error) throw new Error(`board: game player lookup failed: ${error.message}`);
  return (data ?? []).map(toGameRow);
}

/** `game_players` for a set of games, in chunks, so no response is silently truncated. */
async function loadGameRows(client: PublicClient, gameIds: readonly string[]): Promise<PlayerGameRow[]> {
  const rows: PlayerGameRow[] = [];
  for (let start = 0; start < gameIds.length; start += GAME_ID_CHUNK) {
    const chunk = gameIds.slice(start, start + GAME_ID_CHUNK);
    const { data, error } = await client
      .from('game_players')
      .select('game_id, player_id, side, role, mu_before, mu_after')
      .in('game_id', chunk);
    if (error) throw new Error(`board: game player lookup failed: ${error.message}`);
    rows.push(...(data ?? []).map(toGameRow));
  }
  return rows;
}

interface RawGamePlayerRow {
  game_id: string;
  player_id: string;
  side: number;
  role: RoleValue | null;
  mu_before: number | null;
  mu_after: number | null;
}

function toGameRow(row: RawGamePlayerRow): PlayerGameRow {
  return {
    gameId: row.game_id,
    playerId: row.player_id,
    side: row.side === 100 ? 100 : 200,
    role: row.role,
    muBefore: row.mu_before,
    muAfter: row.mu_after,
  };
}

/**
 * Every player's recent results, newest first, over the season's last {@link STREAK_GAME_WINDOW}
 * games. Only rated games count, so the streak is a run through the same games `ratings.games`
 * and `ratings.wins` were folded from and `13W 15L · L2` adds up.
 */
async function loadRecentResults(client: PublicClient, seasonId: string): Promise<Map<string, boolean[]>> {
  const games = await loadSeasonGames(client, seasonId, {
    ascending: false,
    limit: STREAK_GAME_WINDOW,
  });
  if (games.length === 0) return new Map();

  const rows = await loadGameRows(
    client,
    games.map((game) => game.id),
  );
  const byGame = new Map(games.map((game) => [game.id, game]));
  const byPlayer = new Map<string, { startedAt: string; won: boolean }[]>();

  for (const row of rows) {
    const game = byGame.get(row.gameId);
    if (game === undefined || row.muAfter === null) continue;
    const results = byPlayer.get(row.playerId) ?? [];
    results.push({ startedAt: game.startedAt, won: row.side === game.winningSide });
    byPlayer.set(row.playerId, results);
  }

  return new Map(
    [...byPlayer].map(([playerId, results]) => [
      playerId,
      results.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)).map((result) => result.won),
    ]),
  );
}
