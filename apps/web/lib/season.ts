import type { ServiceClient } from './supabase';

/**
 * The one sentence this app says when the `seasons` row is missing (M2.18, rewritten by M5.14,
 * product 2026-09-10).
 *
 * `games.season_id` is `not null default public.active_season_id()` (`0001_init.sql`), so with
 * no active season **every** game insert of the night fails — after the game, on a Vercel
 * function, with nothing on any console but a failed post and a retried queue file. The failure
 * used to surface as a Postgres constraint message that named a column, not the thing a human
 * has to go and do.
 *
 * It used to end `Start a season on the Seasons page.` **There is no such action now**: season
 * creation is removed (M5.14) and `0001_init.sql` inserts the one row, so this state is a
 * broken deployment and not a thing an admin forgot to do. The sentence therefore names the
 * fault and promises no button. It is admin- and API-facing — the companion's log, the admin
 * index, the seasons page — and one string, so the three cannot drift.
 */
export const NO_ACTIVE_SEASON_MESSAGE = 'Games cannot be saved: the database is missing its one season row.';

/**
 * The same fact, for the whole group (M3.17, product 2026-09-09; rewritten by M5.14).
 *
 * The sentence above is written for whoever can open a database console, and nineteen of the
 * twenty people holding the WhatsApp link cannot. This one says the only thing they can act
 * on, which is **nothing, keep playing**: a game missed tonight can be added back from match
 * history later (backfill, M5.1). It used to end `An admin can start one.` — which sent twenty
 * people looking for an admin at 22:00 over a button that no longer exists.
 *
 * The two are separate constants on purpose: the tonight page must never import the admin one,
 * and neither may be edited into the other.
 */
export const NO_ACTIVE_SEASON_TONIGHT_MESSAGE =
  "Tonight's games are not being saved. Play on — they can be added back from match history later.";

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
