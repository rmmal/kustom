import { activeSeasonId, loadPool } from '../ingest/balance';
import type { LobbyBalancedEvent, LobbyHook } from '../ingest/hooks';
import { compareForSitOut, type PoolMember, planSeats } from '../ingest/selection';
import { DEFAULT_NIGHT_TIME_ZONE } from '../night';
import { tonightPageUrl } from '../siteUrl';
import { getServiceClient, type ServiceClient } from '../supabase';
import { buildTeamsInput, loadNames, readAssignments, type TeamsSource, teamsPuuids } from './assemble';
import { teamsEmbed } from './embeds';
import { postToWebhook, type WebhookOptions, type WebhookOutcome } from './webhook';

/**
 * The teams posts and the hook that fires them (M3.1; M3.3 adds the result post).
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
 * sits as the first one did.
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
    .select('blue, red, explanation, lobbies!inner(id, lobby_name, lobby_password)')
    .eq('id', splitId)
    .maybeSingle();
  if (error) throw new Error(`discord: split lookup failed: ${error.message}`);
  if (!data) return null;

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
};
