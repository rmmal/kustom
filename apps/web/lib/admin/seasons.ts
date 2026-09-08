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

export async function startSeason(
  client: ServiceClient,
  name: string,
): Promise<AdminWriteResult<AdminSeasonRow>> {
  const trimmed = name.trim();
  if (trimmed.length === 0) return writeFailed(400, 'a season needs a name');

  const { data, error } = await client.rpc('start_season', { p_name: trimmed });
  if (error) throw new Error(`startSeason failed: ${error.message}`);
  if (data === null) throw new Error('startSeason: no season returned');

  return writeOk({
    id: data.id,
    name: data.name,
    startsAt: data.starts_at,
    endsAt: data.ends_at,
    isActive: data.is_active,
  });
}
