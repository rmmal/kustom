-- 0002_start_season.sql
--
-- M1.6 `/admin/seasons`: "start a new season" has to close the current one and open the
-- next one atomically. `seasons_one_active_idx` allows exactly one active season, so the
-- two statements must run in one transaction: deactivate first and the insert fails, and
-- the group is left with NO active season, which makes `active_season_id()` null and every
-- `games` insert fail on its not-null `season_id`.
--
-- PostgREST has no transactions, so the transaction is this function.
--
-- Copying `mu` into the new season and resetting `sigma` is M5.3. This only switches which
-- season is active; the admin page says so.

create function public.start_season(p_name text) returns public.seasons
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_season public.seasons;
begin
  if length(v_name) = 0 then
    raise exception 'start_season: name is required';
  end if;

  -- Close whatever is open. `ends_at` must be strictly after `starts_at`
  -- (seasons_ends_after_start), which a season started moments ago would violate.
  update public.seasons
  set is_active = false,
      ends_at = coalesce(ends_at, greatest(now(), starts_at + interval '1 microsecond'))
  where is_active;

  insert into public.seasons (name, is_active)
  values (v_name, true)
  returning * into v_season;

  return v_season;
end;
$$;

comment on function public.start_season(text) is
  'Close the active season and open a new one, atomically. Service role only (called by /api/admin/seasons).';

-- Same shape as bootstrap_admin: a privilege the API holds, not the browser.
revoke all on function public.start_season(text) from public, anon, authenticated;
grant execute on function public.start_season(text) to service_role;

-- ---------------------------------------------------------------------------
-- set_active_season
--
-- Move the active flag to an existing season, atomically. Same reason as above: doing it as
-- two PostgREST calls leaves a window with NO active season, and in that window
-- `active_season_id()` is null and every `games` insert fails on its not-null `season_id`.
-- One transaction means other sessions see the old season or the new one, never neither.
--
-- Used by the M1.6 integration tests to put Season 1 back after exercising `start_season`
-- against the shared local database, and by whatever M5.3 needs to correct a mis-started
-- season.
-- ---------------------------------------------------------------------------

create function public.set_active_season(p_id uuid) returns public.seasons
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season public.seasons;
begin
  if p_id is null then
    raise exception 'set_active_season: id is required';
  end if;

  update public.seasons set is_active = false where is_active and id <> p_id;

  update public.seasons
  set is_active = true,
      ends_at = null
  where id = p_id
  returning * into v_season;

  if v_season.id is null then
    raise exception 'set_active_season: no season %', p_id;
  end if;

  return v_season;
end;
$$;

comment on function public.set_active_season(uuid) is
  'Make an existing season the active one, atomically (no window with zero active seasons). Service role only.';

revoke all on function public.set_active_season(uuid) from public, anon, authenticated;
grant execute on function public.set_active_season(uuid) to service_role;
