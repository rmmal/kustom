import type { ServiceClient } from '../supabase';

/**
 * `/admin/seasons`, and the admin index's `Active season` line. **Two reads and no writes.**
 *
 * Season creation was removed on 2026-09-10 (**M5.14**, `04-decisions.md`): with M5.3 dropped,
 * starting a season did nothing anybody wanted and one thing nobody did — it emptied the board
 * with no undo, two fields away from "set a role". `startSeason` went with the form, the typed
 * confirmation (M3.9 retires with it) and `POST /api/admin/seasons`.
 *
 * `public.start_season()` and `set_active_season()` stay in the database, unreachable from the
 * app: an applied migration is never edited (CLAUDE.md), and a function nobody can call costs
 * nothing. The one `seasons` row is the one `0001_init.sql` inserts, so nothing here can leave
 * a deployment with none — which matters, because M2.18 refuses every game insert without one.
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
