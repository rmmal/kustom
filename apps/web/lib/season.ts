import type { ServiceClient } from './supabase';

/**
 * The one sentence this app says when no season is active (M2.18).
 *
 * `games.season_id` is `not null default public.active_season_id()` (`0001_init.sql`), so with
 * no active season **every** game insert of the night fails — after the game, on a Vercel
 * function, with nothing on any console but a failed post and a retried queue file. The failure
 * used to surface as a Postgres constraint message that named a column, not the thing a human
 * has to go and do.
 *
 * So the API checks first and says this, the admin index says this, and the seasons page says
 * this. Product-approved wording; one string, so the three cannot drift.
 */
export const NO_ACTIVE_SEASON_MESSAGE =
  'No season is active, so games cannot be saved. Start a season on the Seasons page.';

/**
 * Whether `public.active_season_id()` would find a season.
 *
 * `seasons_one_active_idx` allows at most one, so this is a single-row lookup. It runs before
 * the game insert rather than around it: refusing costs one select on a route that is already
 * doing several, and the alternative is a write that half-happens and a message nobody can act
 * on.
 */
export async function hasActiveSeason(client: ServiceClient): Promise<boolean> {
  const { data, error } = await client
    .from('seasons')
    .select('id')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`hasActiveSeason failed: ${error.message}`);
  return data !== null;
}
