import { loadBoard } from '../board/load';
import type { BoardView } from '../board/types';
import { activeSeasonId, loadPool } from '../ingest/balance';
import type { GameFinishedEvent, LobbyBalancedEvent, LobbyHook } from '../ingest/hooks';
import { compareForSitOut, type PoolMember, planSeats } from '../ingest/selection';
import { DEFAULT_NIGHT_TIME_ZONE } from '../night';
import { leaderboardPageUrl, tonightPageUrl } from '../siteUrl';
import { getServiceClient, type ServiceClient } from '../supabase';
import {
  buildResultInput,
  buildTeamsInput,
  loadNames,
  loadResultSource,
  readAssignments,
  type TeamsSource,
  teamsPuuids,
} from './assemble';
import { type LeaderboardEntry, leaderboardEmbed, resultEmbed, TOP_N, teamsEmbed } from './embeds';
import { postToWebhook, type WebhookOptions, type WebhookOutcome } from './webhook';

/**
 * The three posts and the hook that fires them (M3.1, M3.3).
 *
 * Every function here answers with a {@link WebhookOutcome} and none of them throws for a
 * Discord problem: a webhook that is down must cost the group nothing but a log line. The
 * lobby response, the stored splits and the rating fold are all finished before any of this
 * runs — `hooks.ts` is the seam and it awaits us only so a test can.
 */

const SKIPPED = (reason: string): WebhookOutcome => ({
  status: 'skipped',
  httpStatus: null,
  reason,
  attempts: 0,
});

export interface PostOptions extends WebhookOptions {
  /** Injected in tests. */
  now?: Date;
  /** IANA name for "tonight" (M2.5), when the pool has to be rebuilt. */
  timeZone?: string;
  /**
   * The origin of the request behind this post, for the embed `url`. `siteOrigin(request)`
   * already prefers `NEXT_PUBLIC_SITE_URL`; `tonightPageUrl` drops a localhost one.
   */
  requestOrigin?: string | null;
}

/**
 * The teams embed for a balance that just happened. Everything comes off the event — ingest
 * worked out the ten, the sitters and the seat moves and this does not re-derive any of it —
 * except the names, which are read fresh.
 */
export async function postTeamsForEvent(
  client: ServiceClient,
  event: LobbyBalancedEvent,
  options: PostOptions = {},
): Promise<WebhookOutcome> {
  const names = await loadNames(client, teamsPuuids(event));
  const input = buildTeamsInput(event, names, {
    url: tonightPageUrl(options.requestOrigin ?? event.requestOrigin),
    timestamp: (options.now ?? new Date()).toISOString(),
  });
  return postToWebhook(client, teamsEmbed(input), 'teams embed', options);
}

/**
 * The teams embed for a split that is already stored — the re-post M3.2's reroll needs, one
 * call away: promote a split, then `postTeamsForSplit(client, splitId)`.
 *
 * The sitters and the seat moves are rebuilt from the lobby's members with the same pure
 * functions M2.5 used (`selection.ts`), so a reroll's embed says the same things about who
 * sits as the first one did. It is a new message and never an edit of the earlier one; the
 * title carries the promoted split's rank, so the channel reads how far down the list the
 * group has gone (M3.2).
 */
export async function postTeamsForSplit(
  client: ServiceClient,
  splitId: string,
  options: PostOptions = {},
): Promise<WebhookOutcome> {
  const source = await loadTeamsSource(client, splitId, options);
  if (source === null) return SKIPPED('no such split');

  const names = await loadNames(client, teamsPuuids(source));
  const input = buildTeamsInput(source, names, {
    url: tonightPageUrl(options.requestOrigin),
    timestamp: (options.now ?? new Date()).toISOString(),
  });
  return postToWebhook(client, teamsEmbed(input), 'teams embed', options);
}

/**
 * The result embed for a game the fold just rated. `skipped` when the game has no ratings —
 * a remake, a short surrender, or a block somebody else already rated — because the whole
 * message is what the game did to ten ratings.
 */
export async function postResultForGame(
  client: ServiceClient,
  gameId: string,
  options: PostOptions = {},
): Promise<WebhookOutcome> {
  const source = await loadResultSource(client, gameId);
  if (source === null) return SKIPPED('no such game');

  const input = buildResultInput(source, {
    url: tonightPageUrl(options.requestOrigin),
    // The game's own end, not now: the embed is a record of something that happened.
    timestamp: source.endedAt,
  });
  if (input === null) return SKIPPED('game is not rated');

  return postToWebhook(client, resultEmbed(input), 'result embed', options);
}

/**
 * The nightly board (M3.5). One post: the season's top ten by Proven, in the same order
 * `/leaderboard` puts them in, because it is the same `loadBoard`.
 *
 * **Three ways to say nothing**, all of them `skipped`, and none of them an empty message:
 *
 * - no active season;
 * - nobody on the board at all;
 * - **a season nobody has played yet** (product, 2026-09-09). The board seeds every known
 *   player from their rank, so the morning a new season starts this would post
 *   `Season 2 · leaderboard` over ten lines all reading `0 games` — a ranking of a season that
 *   has not happened, in a channel, while `/leaderboard` correctly says `No games this season
 *   yet.` One rated game and it posts as it does today.
 *
 * That is the result embed's rule applied here: a message that says nothing is worse than
 * silence. Anything else is the webhook's answer, and a webhook that is down costs a log line.
 *
 * **The schedule is not here.** This is a function and a route; something outside the app
 * calls it at a configured time (`GET /api/cron/leaderboard`, bearer `CRON_SECRET`), exactly
 * as the idle sweep works. No Vercel cron config ships with this milestone.
 */
export async function postNightlyLeaderboard(
  client: ServiceClient,
  options: PostOptions = {},
): Promise<WebhookOutcome> {
  const board = await loadBoard(client);
  const skip = nightlyLeaderboardSkip(board);
  if (skip !== null) return SKIPPED(skip);

  const entries: LeaderboardEntry[] = board.rows.slice(0, TOP_N).map((row) => ({
    puuid: row.puuid,
    name: row.name,
    proven: row.proven,
    games: row.games,
  }));

  const payload = leaderboardEmbed({
    // `nightlyLeaderboardSkip` has already refused a board with no season.
    seasonName: (board.season as NonNullable<BoardView['season']>).name,
    entries,
    url: leaderboardPageUrl(options.requestOrigin),
    timestamp: (options.now ?? new Date()).toISOString(),
  });
  return postToWebhook(client, payload, 'leaderboard embed', options);
}

/**
 * Why tonight's board is not worth posting, or `null` when it is. Pure, so the three rules are
 * a unit test rather than a season nobody can arrange.
 *
 * The third one is the one that is easy to miss: the board seeds every known player from their
 * rank, so a season nobody has played yet is a full list of real names with real Proven numbers
 * and `0 games` against every one of them. Posting that is a ranking of a season that has not
 * happened.
 */
export function nightlyLeaderboardSkip(board: BoardView): string | null {
  if (board.season === null) return 'no active season';
  if (board.rows.length === 0) return 'nobody on the board';
  // Asked of the whole board rather than of the ten printed: a season is played or it is not,
  // and `loadBoard`'s `games` is the fold's own count for the active season.
  if (board.rows.every((row) => row.games === 0)) return 'no games this season';
  return null;
}

/**
 * The stored split, the lobby it belongs to, and the pool around it, in the shape the pure
 * builder wants. `null` when the split is gone.
 */
async function loadTeamsSource(
  client: ServiceClient,
  splitId: string,
  options: PostOptions,
): Promise<TeamsSource | null> {
  const { data, error } = await client
    .from('splits')
    .select('rank, blue, red, explanation, lobbies!inner(id, lobby_name, lobby_password)')
    .eq('id', splitId)
    .maybeSingle();
  if (error) throw new Error(`discord: split lookup failed: ${error.message}`);
  if (!data) return null;

  // How many the lobby stored, so the title can say `of 2` without assuming core returned
  // three (`teamsTitle`). One count, on the same index the promotion uses.
  const { count, error: countError } = await client
    .from('splits')
    .select('id', { count: 'exact', head: true })
    .eq('lobby_id', data.lobbies.id);
  if (countError) throw new Error(`discord: split count failed: ${countError.message}`);

  const blue = readAssignments(data.blue);
  const red = readAssignments(data.red);
  const ten = new Set([...blue, ...red].map((assignment) => assignment.puuid));

  const seasonId = await activeSeasonId(client);
  const pool = await loadPool(
    client,
    data.lobbies.id,
    seasonId,
    options.now ?? new Date(),
    options.timeZone ?? DEFAULT_NIGHT_TIME_ZONE,
  );

  const playing = pool.filter((member) => ten.has(member.puuid));
  if (playing.length !== ten.size) return null;
  const sitters = pool.filter((member) => !ten.has(member.puuid)).sort(compareForSitOut);
  const first = pool[0]?.gamesTonight ?? 0;
  const tiedOnGames = pool.every((member: PoolMember) => member.gamesTonight === first);

  return {
    split: { blue, red },
    explanation: data.explanation,
    lobbyName: data.lobbies.lobby_name,
    lobbyPassword: data.lobbies.lobby_password,
    playing,
    sitters,
    seatMoves: planSeats({ playing, sitters, tiedOnGames }),
    tiedOnGames,
    promoted: { rank: data.rank, splitCount: count ?? data.rank },
  };
}

/**
 * The listener. One object, so `registerLobbyHook` deduplicates it and calling
 * {@link registerDiscordHooks} twice registers one hook.
 */
export const discordLobbyHook: LobbyHook = {
  onBalanced: async (event: LobbyBalancedEvent): Promise<void> => {
    // `getServiceClient` reads the environment when it is called, never at import, so this
    // module can be imported by a build that has no Supabase keys.
    await postTeamsForEvent(getServiceClient(), event);
  },
  onFinished: async (event: GameFinishedEvent): Promise<void> => {
    // Only a game the fold actually rated. The route already narrows this to the post that
    // changed something, so two companions in one game produce one message.
    if (!event.rated) return;
    await postResultForGame(getServiceClient(), event.gameId, {
      requestOrigin: event.requestOrigin ?? null,
    });
  },
};
