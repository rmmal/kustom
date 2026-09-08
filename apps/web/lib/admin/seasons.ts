import type { ServiceClient } from '../supabase';
import { type AdminWriteResult, writeFailed, writeOk } from './result';

/**
 * `/admin/seasons`.
 *
 * Starting a season closes the current one and opens the next one in a single transaction —
 * `public.start_season(name)`, added by `0002_start_season.sql`. Two PostgREST calls could not
 * do it: `seasons_one_active_idx` allows exactly one active season, so a failure between them
 * would leave the group with none, `active_season_id()` null, and every `games` insert failing.
 *
 * Copying `mu` forward and resetting `sigma` is M5.3. This only switches which season is
 * active, and the page says so.
 */

export interface AdminSeasonRow {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string | null;
  isActive: boolean;
}

export async function listSeasons(client: ServiceClient): Promise<AdminSeasonRow[]> {
  const { data, error } = await client
    .from('seasons')
    .select('id, name, starts_at, ends_at, is_active')
    .order('starts_at', { ascending: false });

  if (error) throw new Error(`listSeasons failed: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    isActive: row.is_active,
  }));
}

export async function getActiveSeason(client: ServiceClient): Promise<AdminSeasonRow | null> {
  const { data, error } = await client
    .from('seasons')
    .select('id, name, starts_at, ends_at, is_active')
    .eq('is_active', true)
    .maybeSingle();

  if (error) throw new Error(`getActiveSeason failed: ${error.message}`);
  if (!data) return null;

  return {
    id: data.id,
    name: data.name,
    startsAt: data.starts_at,
    endsAt: data.ends_at,
    isActive: data.is_active,
  };
}

export interface StartSeasonInput {
  /** The name of the season being started. */
  name: string;
  /** What the caller typed to confirm; must equal the active season's name (M3.9). */
  confirmSeasonName: string | null;
}

export interface StartedSeason {
  started: AdminSeasonRow;
  /** The season that was closed, or null when there was none active to close. */
  ended: AdminSeasonRow | null;
}

/**
 * Starting a season is the only control in the app with no undo: `ratings` is keyed
 * `(player_id, season_id)`, nothing carries over until M5.3, and every public page reads the
 * active season — so from the group's side the leaderboard is simply emptied. It sits two form
 * fields away from "set a role", on a page an admin opens on a phone.
 *
 * So the caller has to type the name of the season being ended (M3.9). The check is here rather
 * than in the zod schema because it needs the database to know what the right answer is, and
 * because it must read as one rule: no confirmation and a wrong confirmation are the same 400
 * and nothing is written either way — `start_season` is not called at all.
 *
 * The comparison is exact after trimming: matching case-insensitively would let "season 1" end
 * "Season 1", and the friction is the point.
 */
export async function startSeason(
  client: ServiceClient,
  input: StartSeasonInput,
): Promise<AdminWriteResult<StartedSeason>> {
  const trimmed = input.name.trim();
  if (trimmed.length === 0) return writeFailed(400, 'a season needs a name');

  const active = await getActiveSeason(client);
  if (active !== null && input.confirmSeasonName !== active.name) {
    return writeFailed(
      400,
      `type the name of the season you are ending, exactly: ${active.name}. Nothing has changed.`,
    );
  }

  const { data, error } = await client.rpc('start_season', { p_name: trimmed });
  if (error) throw new Error(`startSeason failed: ${error.message}`);
  if (data === null) throw new Error('startSeason: no season returned');

  return writeOk({
    started: {
      id: data.id,
      name: data.name,
      startsAt: data.starts_at,
      endsAt: data.ends_at,
      isActive: data.is_active,
    },
    ended: active,
  });
}
