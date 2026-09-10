import type { RoleValue, SideValue } from '@customs/db';
import { inChunks } from '../board/load';
import { type WindowKind, type WindowRange, windowRange } from '../night';
import type { PublicClient } from '../publicClient';
import type { AwardRender } from './awards';
import { playerStatsView } from './player';
import type { PlayerStatsView, StatsGame, StatsPlayer, StatsRow, StatsView } from './types';
import { type StatsInput, statsView } from './view';

/**
 * Everything `/stats` shows (M5.4), read with the **anon key** through RLS — the same client,
 * the same view and the same rules as `/leaderboard`, because it is the same kind of page: a
 * link opened on a phone, with no login.
 *
 * **One read, one fold, no stored table.** The page is computed at request time from `games`
 * and `game_players`, with a cap. No precomputed stats table and no materialised view:
 * precomputing would be a second thing that can disagree with `game_players`, and
 * `game_players` is the truth. If this page ever gets slow the fix is {@link STATS_MAX_GAMES},
 * not a cache table.
 *
 * Nothing here decides a number. The arithmetic is `fold.ts` and `awards.ts`, which are pure
 * and tested against a fixture; this file reads rows and hands them over.
 */

/**
 * How many games one render reads, most recent first.
 *
 * Twenty friends playing four games a night reach 2000 in about a year and a half; a month is
 * two to four hundred. Over the cap the page prints one line and nothing drops silently.
 */
export const STATS_MAX_GAMES = 2_000;

/**
 * PostgREST answers at most a thousand rows per request whatever the `limit` says, so the game
 * read is paged — the same shape `lib/ingest/rebuild.ts` uses. The scoreboard rows are chunked
 * by `inChunks` instead, which is the board's own 90-id list and therefore 900 rows a request.
 */
const PAGE_SIZE = 1_000;

export interface StatsOptions {
  window: WindowKind;
  /** Injected in tests; `new Date()` otherwise. The boundaries are `lib/night.ts`'s (M5.9). */
  now?: Date;
  timeZone?: string;
  /** Lowered by the cap test. Production is {@link STATS_MAX_GAMES}. */
  maxGames?: number;
  /**
   * How an award line renders a name and a delta. The page's default is the web's (`−212`,
   * `05-design.md`'s truncation); the Monday Discord post passes its own, which escapes
   * markdown and writes an ASCII minus into a message that gets copy-pasted.
   *
   * **The lines themselves are the same lines** — one renderer of an award, two glyph sets.
   */
  awardRender?: AwardRender;
}

export async function loadStats(client: PublicClient, options: StatsOptions): Promise<StatsView> {
  const read = await readWindow(client, options);

  /**
   * **The page itself is pure** (`view.ts`): everything from here down is arithmetic over the
   * list the read came back with, so the whole of `/stats` is a unit test with a hand-built
   * fixture and this file is a read.
   */
  return statsView({ ...read, awardRender: options.awardRender });
}

/**
 * The same window, the same read, one player picked out of it (M5.20).
 *
 * **`/p/[puuid]` calls this and there is no second query path**: the brief's rule is that the
 * player page "calls the same loader and picks one player out of the answer", so the sections
 * under somebody's rating chart count exactly the games `/stats` counts and the two pages can
 * never print two records for one person. The picking is `player.ts`, which is pure.
 *
 * A puuid nobody's scoreboard names comes back as the empty view rather than `null`: the page
 * has already 404'd an unknown player through `loadPlayerBoard`, and a friend who did not play
 * this week is not a missing page.
 */
export async function loadPlayerStats(
  client: PublicClient,
  puuid: string,
  options: StatsOptions,
): Promise<PlayerStatsView> {
  const read = await readWindow(client, options);
  return playerStatsView({ ...read, puuid });
}

/**
 * One window, read once: the games, their scoreboards and the people on them.
 *
 * Both surfaces above take their input from here, so "a game counts" is decided in one place
 * and the cap, the paging and the window filter cannot drift between a group page and a
 * person's.
 */
async function readWindow(client: PublicClient, options: StatsOptions): Promise<WindowRead> {
  const window = options.window;
  const cap = options.maxGames ?? STATS_MAX_GAMES;
  const range = windowRange(window, options.now ?? new Date(), options.timeZone);

  /**
   * **One extra row is the cap detector.** Reading `cap + 1` games says "there are more than the
   * cap" without a second `count` query, and the extra one is dropped before anything counts it
   * — so the page uses exactly the most recent `cap` games and says so.
   */
  const read = await loadGames(client, range, cap + 1);
  const capped = read.length > cap;
  const newest = capped ? read.slice(0, cap) : read;
  const rows = await loadGameRows(
    client,
    newest.map((game) => game.id),
  );
  const players = await loadPlayers(
    client,
    rows.map((row) => row.playerId),
  );
  const roster = new Map(players.map((player) => [player.playerId, player]));

  const byGame = new Map<string, StatsRow[]>();
  for (const row of rows) {
    const played = byGame.get(row.gameId) ?? [];
    played.push({
      playerId: row.playerId,
      // The gate dedupes on puuid, and every id on a scoreboard has a `players_public` row;
      // the id itself is the fallback, and it is unique for the same reason a puuid is.
      puuid: roster.get(row.playerId)?.puuid ?? row.playerId,
      side: row.side,
      role: row.role,
      muBefore: row.muBefore,
      muAfter: row.muAfter,
    });
    byGame.set(row.gameId, played);
  }

  const games: StatsGame[] = newest.map((game) => ({
    ...game,
    rows: byGame.get(game.id) ?? [],
  }));

  return { window, games, players, range, capped, cap, timeZone: options.timeZone };
}

/** What one window's read comes back with, before anything counts it. */
type WindowRead = Omit<StatsInput, 'awardRender'>;

interface GameRow {
  id: string;
  startedAt: string;
  /** A bigint in the database, and the streak order's tie-break. Carried as it is stored. */
  lcuGameId: number | null;
  durationS: number;
  winningSide: SideValue;
}

/**
 * The window's games, newest first, up to `limit`, paged at PostgREST's thousand.
 *
 * **The window is a filter in the query, not in memory** (M5.12): `Last month` on a year of
 * history read through the cap would otherwise come back empty.
 */
async function loadGames(client: PublicClient, range: WindowRange, limit: number): Promise<GameRow[]> {
  const games: GameRow[] = [];

  for (let from = 0; from < limit; from += PAGE_SIZE) {
    const to = Math.min(from + PAGE_SIZE, limit) - 1;
    let query = client
      .from('games')
      .select('id, started_at, duration_s, winning_side, lcu_game_id')
      .order('started_at', { ascending: false })
      // **The rebuild's tie-break, in the query** (`lib/ingest/rebuild.ts`): two games that
      // share an instant have no order without it, and an unordered pair straddling a page
      // boundary is a game read twice and a game not read at all.
      .order('lcu_game_id', { ascending: false })
      .range(from, to);
    query = withRange(query, 'started_at', range);

    const { data, error } = await query;
    if (error) throw new Error(`stats: game lookup failed: ${error.message}`);

    const page = data ?? [];
    for (const row of page) {
      // `winning_side` is not null in the schema; a row that is neither side is a row this page
      // cannot read a win off, so it is not a game here either.
      if (row.winning_side !== 100 && row.winning_side !== 200) continue;
      games.push({
        id: row.id,
        startedAt: row.started_at,
        lcuGameId: row.lcu_game_id,
        durationS: row.duration_s,
        winningSide: row.winning_side as SideValue,
      });
    }
    if (page.length < to - from + 1) break;
  }

  return games;
}

interface ScoreboardRow {
  gameId: string;
  playerId: string;
  side: SideValue;
  role: RoleValue | null;
  muBefore: number | null;
  muAfter: number | null;
}

/** `game_players` for a set of games, in chunks, so no response is silently truncated. */
async function loadGameRows(client: PublicClient, gameIds: readonly string[]): Promise<ScoreboardRow[]> {
  const rows: ScoreboardRow[] = [];

  for (const chunk of inChunks(gameIds)) {
    const { data, error } = await client
      .from('game_players')
      .select('game_id, player_id, side, role, mu_before, mu_after')
      .in('game_id', chunk);
    if (error) throw new Error(`stats: game player lookup failed: ${error.message}`);

    for (const row of data ?? []) {
      rows.push({
        gameId: row.game_id,
        playerId: row.player_id,
        side: row.side === 100 ? 100 : 200,
        role: row.role,
        muBefore: row.mu_before,
        muAfter: row.mu_after,
      });
    }
  }
  return rows;
}

/**
 * The people on those scoreboards, from `players_public` — `players` minus `discord_id`, and
 * the only players relation anon can read.
 *
 * Read **by the ids on the scoreboards**, never as "everybody": this page is about the people
 * who played in the window, and a player who has never played is in none of its numbers.
 */
async function loadPlayers(client: PublicClient, playerIds: readonly string[]): Promise<StatsPlayer[]> {
  const players: StatsPlayer[] = [];

  for (const chunk of inChunks(playerIds)) {
    const { data, error } = await client
      .from('players_public')
      .select('id, puuid, display_name, game_name, main_role')
      .in('id', chunk);
    if (error) throw new Error(`stats: player lookup failed: ${error.message}`);

    for (const row of data ?? []) {
      if (row.id === null || row.puuid === null) continue;
      players.push({
        playerId: row.id,
        puuid: row.puuid,
        // M3.10's fallback is applied at render; the loader carries the honest `null`.
        name: row.display_name ?? row.game_name ?? null,
        mainRole: row.main_role,
      });
    }
  }
  return players;
}

/**
 * The window as two PostgREST filters: `[start, end)`, half-open, with `all-time`'s nulls
 * adding nothing (M5.9). The board's own helper, spelled again here rather than exported from
 * `lib/board/load.ts`, which keeps its query builders private.
 */
function withRange<Q extends { gte(column: string, value: string): Q; lt(column: string, value: string): Q }>(
  query: Q,
  column: string,
  range: WindowRange,
): Q {
  let next = query;
  if (range.start !== null) next = next.gte(column, range.start.toISOString());
  if (range.end !== null) next = next.lt(column, range.end.toISOString());
  return next;
}
