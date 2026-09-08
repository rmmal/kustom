-- 0001_init.sql
--
-- Customs Night initial schema. Implements docs/01-architecture.md "Data model",
-- "Lobby lifecycle" and "Security".
--
-- Rules this file encodes:
--   * players.puuid is the identity. Never a Riot ID, summoner name or Discord ID.
--   * Ingest is idempotent: lobbies dedupe on lcu_party_id, games on lcu_game_id.
--   * Every table has RLS. Public (anon) read on the display tables only; no anon or
--     authenticated writes anywhere. The API writes with the service_role key, which
--     bypasses RLS.
--
-- Never edit this file once it has been applied. Add a new numbered migration.

-- ---------------------------------------------------------------------------
-- Enums
--
-- Enums (not check constraints) so `supabase gen types typescript` emits the same
-- string unions that packages/core declares (LobbyStatus, Role, ...). `side` stays a
-- smallint with a check because 100/200 are the client's own numbers.
-- ---------------------------------------------------------------------------

create type public.lobby_status as enum ('open', 'balanced', 'in_game', 'finished', 'abandoned');
create type public.player_role as enum ('top', 'jungle', 'mid', 'adc', 'support');
create type public.game_source as enum ('eog', 'backfill');
create type public.companion_command_kind as enum ('create_lobby', 'invite', 'switch_side');
create type public.companion_command_status as enum ('pending', 'sent', 'acked', 'failed');

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

-- Keeps `updated_at` honest without the API having to remember it.
create function public.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- seasons
-- ---------------------------------------------------------------------------

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  constraint seasons_ends_after_start check (ends_at is null or ends_at > starts_at)
);

-- At most one active season at a time (M5.3 closes one and opens the next).
create unique index seasons_one_active_idx on public.seasons (is_active) where is_active;
create index seasons_starts_at_idx on public.seasons (starts_at desc);

comment on table public.seasons is 'Rating seasons. Exactly one is active; ratings are per season.';

-- Season 1 exists from day one so `ratings` and `games` always have a season to hang
-- off. Fixed id so local resets and tests are deterministic.
insert into public.seasons (id, name, starts_at, is_active)
values ('00000000-0000-0000-0000-000000000001', 'Season 1', now(), true)
on conflict (id) do nothing;

create function public.active_season_id() returns uuid
language sql
stable
set search_path = ''
as $$
  select id from public.seasons where is_active order by starts_at desc limit 1;
$$;

comment on function public.active_season_id() is
  'The current season id. Used as the default for games.season_id so the API never has to look it up.';

-- ---------------------------------------------------------------------------
-- players
--
-- Created lazily the first time a PUUID appears in a lobby or a game.
-- ---------------------------------------------------------------------------

create table public.players (
  id uuid primary key default gen_random_uuid(),
  puuid text not null unique,
  summoner_id text,
  game_name text,
  tag_line text,
  display_name text,
  discord_id text unique,
  is_admin boolean not null default false,
  main_role public.player_role,
  secondary_role public.player_role,
  rank_tier text,
  rank_division text,
  rank_lp integer check (rank_lp is null or rank_lp >= 0),
  rank_updated_at timestamptz,
  created_at timestamptz not null default now(),
  constraint players_puuid_not_blank check (length(puuid) > 0)
);

create index players_display_name_idx on public.players (display_name);
create index players_is_admin_idx on public.players (id) where is_admin;

comment on table public.players is 'One row per PUUID. Riot IDs and display names are refreshed from the client.';
comment on column public.players.discord_id is
  'Optional Discord link. NOT exposed to anon: read players through the players_public view.';

-- ---------------------------------------------------------------------------
-- ratings
-- ---------------------------------------------------------------------------

create table public.ratings (
  player_id uuid not null references public.players (id) on delete cascade,
  season_id uuid not null references public.seasons (id) on delete cascade,
  mu double precision not null,
  sigma double precision not null check (sigma > 0),
  -- ordinal = mu - 2 * sigma (CLAUDE.md "Conventions"). Generated so the leaderboard is
  -- one index scan and so SQL and packages/core cannot disagree on the formula.
  ordinal double precision generated always as (mu - 2 * sigma) stored,
  games integer not null default 0 check (games >= 0),
  wins integer not null default 0 check (wins >= 0 and wins <= games),
  updated_at timestamptz not null default now(),
  primary key (player_id, season_id)
);

create index ratings_season_ordinal_idx on public.ratings (season_id, ordinal desc);

create trigger ratings_set_updated_at
  before update on public.ratings
  for each row execute function public.set_updated_at();

comment on table public.ratings is 'OpenSkill rating per player per season. Balance on mu, leaderboard on ordinal.';

-- ---------------------------------------------------------------------------
-- lobbies
--
-- Status transitions are owned by the API (docs/01-architecture.md "Lobby lifecycle").
-- The enum only says which values exist; it does not say which moves are legal.
-- ---------------------------------------------------------------------------

create table public.lobbies (
  id uuid primary key default gen_random_uuid(),
  lcu_party_id text not null unique,
  status public.lobby_status not null default 'open',
  reported_by_player_id uuid references public.players (id) on delete set null,
  lobby_name text,
  lobby_password text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lobbies_party_id_not_blank check (length(lcu_party_id) > 0)
);

create index lobbies_created_at_idx on public.lobbies (created_at desc);
-- "the lobby that is live right now" for the tonight page and the state machine.
create index lobbies_open_idx on public.lobbies (updated_at desc)
  where status in ('open', 'balanced', 'in_game');

create trigger lobbies_set_updated_at
  before update on public.lobbies
  for each row execute function public.set_updated_at();

comment on table public.lobbies is 'One row per League custom lobby, deduped on lcu_party_id.';

-- ---------------------------------------------------------------------------
-- lobby_members
-- ---------------------------------------------------------------------------

create table public.lobby_members (
  lobby_id uuid not null references public.lobbies (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  side smallint check (side in (100, 200)),
  role public.player_role,
  role_override public.player_role,
  is_spectator boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (lobby_id, player_id)
);

create index lobby_members_player_id_idx on public.lobby_members (player_id);

comment on column public.lobby_members.role_override is
  'Role the player picked for tonight (M3.6). Cleared when the lobby finishes.';

-- ---------------------------------------------------------------------------
-- splits
--
-- The top three splits for every balance run. Kept as history: a rebalance inserts a
-- new set of three rather than replacing the old one.
-- ---------------------------------------------------------------------------

create table public.splits (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid not null references public.lobbies (id) on delete cascade,
  rank smallint not null check (rank between 1 and 3),
  blue jsonb not null,
  red jsonb not null,
  gap integer not null,
  blue_win_prob double precision not null check (blue_win_prob >= 0 and blue_win_prob <= 1),
  score double precision not null,
  off_role_count smallint not null check (off_role_count between 0 and 10),
  is_chosen boolean not null default false,
  explanation text not null,
  -- Sorted PUUIDs of the ten players, joined with ','. Written by the API so it can find
  -- "the last chosen split for this exact ten" to pass to the balancer as lastSplit.
  roster_key text not null,
  created_at timestamptz not null default now(),
  constraint splits_blue_is_five check (jsonb_typeof(blue) = 'array' and jsonb_array_length(blue) = 5),
  constraint splits_red_is_five check (jsonb_typeof(red) = 'array' and jsonb_array_length(red) = 5)
);

-- Reroll (M3.2) promotes split 2 or 3: at most one chosen split per lobby.
create unique index splits_one_chosen_per_lobby_idx on public.splits (lobby_id) where is_chosen;
create index splits_lobby_created_at_idx on public.splits (lobby_id, created_at desc, rank);
-- "the most recent chosen split for these same ten players" (lastSplit lookup).
create index splits_roster_key_idx on public.splits (roster_key, created_at desc) where is_chosen;

comment on column public.splits.blue is 'jsonb array of five { puuid, role } in the balancer''s output order.';
comment on column public.splits.roster_key is
  'The ten PUUIDs of this split, sorted and joined with ",". Denormalised so lastSplit is an index lookup.';

-- ---------------------------------------------------------------------------
-- games
-- ---------------------------------------------------------------------------

create table public.games (
  id uuid primary key default gen_random_uuid(),
  lcu_game_id bigint not null unique,
  lobby_id uuid references public.lobbies (id) on delete set null,
  season_id uuid not null default public.active_season_id() references public.seasons (id),
  started_at timestamptz not null,
  duration_s integer not null check (duration_s >= 0),
  winning_side smallint not null check (winning_side in (100, 200)),
  source public.game_source not null default 'eog',
  raw jsonb not null,
  created_at timestamptz not null default now()
);

-- Ratings are a fold over games in started_at order (M5.2 rebuild).
create index games_started_at_idx on public.games (started_at);
create index games_season_started_at_idx on public.games (season_id, started_at desc);
create index games_lobby_id_idx on public.games (lobby_id);

comment on table public.games is
  'One row per custom game, deduped on lcu_game_id. `raw` is the full end-of-game block; every derived column can be recomputed from it.';

-- ---------------------------------------------------------------------------
-- game_players
-- ---------------------------------------------------------------------------

create table public.game_players (
  game_id uuid not null references public.games (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  side smallint not null check (side in (100, 200)),
  role public.player_role,
  champion_id integer,
  kills integer not null default 0 check (kills >= 0),
  deaths integer not null default 0 check (deaths >= 0),
  assists integer not null default 0 check (assists >= 0),
  gold integer not null default 0 check (gold >= 0),
  damage_to_champs integer not null default 0 check (damage_to_champs >= 0),
  cs integer not null default 0 check (cs >= 0),
  -- Nullable: the API inserts the game first and writes the rating deltas once
  -- rateGame has run. A rebuild (M5.2) rewrites them.
  mu_before double precision,
  sigma_before double precision,
  mu_after double precision,
  sigma_after double precision,
  primary key (game_id, player_id)
);

create index game_players_player_id_idx on public.game_players (player_id);

-- ---------------------------------------------------------------------------
-- companion_tokens
--
-- Random 32 bytes, stored hashed, one per player, revocable (architecture "Security").
-- ---------------------------------------------------------------------------

create table public.companion_tokens (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players (id) on delete cascade,
  token_hash text not null unique,
  label text,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index companion_tokens_player_id_idx on public.companion_tokens (player_id);
-- The auth path: hash the bearer token, look it up, reject if revoked.
create index companion_tokens_active_idx on public.companion_tokens (token_hash) where revoked_at is null;

comment on table public.companion_tokens is
  'Hashed companion bearer tokens. Never readable by anon or authenticated; the API reads them with the service role.';

-- ---------------------------------------------------------------------------
-- companion_commands
-- ---------------------------------------------------------------------------

create table public.companion_commands (
  id uuid primary key default gen_random_uuid(),
  target_player_id uuid not null references public.players (id) on delete cascade,
  kind public.companion_command_kind not null,
  payload jsonb not null default '{}'::jsonb,
  status public.companion_command_status not null default 'pending',
  created_at timestamptz not null default now(),
  acked_at timestamptz
);

-- The companion polls this every 5 seconds; keep it to the pending rows only.
create index companion_commands_pending_idx
  on public.companion_commands (target_player_id, created_at)
  where status in ('pending', 'sent');

-- ---------------------------------------------------------------------------
-- discord_config
-- ---------------------------------------------------------------------------

create table public.discord_config (
  guild_id text primary key,
  webhook_url text,
  results_channel_id text,
  lobby_voice_channel_id text,
  blue_voice_channel_id text,
  red_voice_channel_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger discord_config_set_updated_at
  before update on public.discord_config
  for each row execute function public.set_updated_at();

comment on table public.discord_config is
  'Webhook URL and channel ids per guild. Contains a secret (the webhook URL); never readable by anon.';

-- ---------------------------------------------------------------------------
-- players_public
--
-- Public read on players "minus discord_id" (architecture "Security"). A view is the
-- only shape that keeps `select=*` working for the web client: column-level grants on
-- the base table make PostgREST's `select=*` fail outright.
--
-- security_invoker is deliberately OFF: the view runs as its owner, so it can read the
-- base table while anon has no read privilege on it at all.
-- ---------------------------------------------------------------------------

create view public.players_public as
select
  id,
  puuid,
  summoner_id,
  game_name,
  tag_line,
  display_name,
  is_admin,
  main_role,
  secondary_role,
  rank_tier,
  rank_division,
  rank_lp,
  rank_updated_at,
  created_at
from public.players;

comment on view public.players_public is
  'players without discord_id. This is what the web client and the bot read; the base table is service-role only.';

-- ---------------------------------------------------------------------------
-- bootstrap_admin
--
-- A migration cannot read the deployment environment, so the first admin is seeded by
-- the API on start from BOOTSTRAP_ADMIN_PUUID (see .env.example) by calling this.
-- Idempotent: inserts the player row if the PUUID is new, sets is_admin either way.
-- ---------------------------------------------------------------------------

create function public.bootstrap_admin(p_puuid text) returns public.players
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player public.players;
begin
  if p_puuid is null or length(p_puuid) = 0 then
    raise exception 'bootstrap_admin: puuid is required';
  end if;

  insert into public.players (puuid, is_admin)
  values (p_puuid, true)
  on conflict (puuid) do update set is_admin = true
  returning * into v_player;

  return v_player;
end;
$$;

comment on function public.bootstrap_admin(text) is
  'Insert-or-promote the player with this PUUID to admin. Idempotent. Service role only.';

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Every table. Public read on the display tables, nothing else. There are no insert,
-- update or delete policies anywhere: the API writes with the service_role key, which
-- bypasses RLS. Admin session policies (M1.6) go where marked.
-- ---------------------------------------------------------------------------

alter table public.seasons enable row level security;
alter table public.players enable row level security;
alter table public.ratings enable row level security;
alter table public.lobbies enable row level security;
alter table public.lobby_members enable row level security;
alter table public.splits enable row level security;
alter table public.games enable row level security;
alter table public.game_players enable row level security;
alter table public.companion_tokens enable row level security;
alter table public.companion_commands enable row level security;
alter table public.discord_config enable row level security;

-- Public read: the tonight page, the leaderboard and the player pages are all anonymous.
create policy "seasons are publicly readable" on public.seasons
  for select to anon, authenticated using (true);
create policy "ratings are publicly readable" on public.ratings
  for select to anon, authenticated using (true);
create policy "lobbies are publicly readable" on public.lobbies
  for select to anon, authenticated using (true);
create policy "lobby members are publicly readable" on public.lobby_members
  for select to anon, authenticated using (true);
create policy "splits are publicly readable" on public.splits
  for select to anon, authenticated using (true);
create policy "games are publicly readable" on public.games
  for select to anon, authenticated using (true);
create policy "game players are publicly readable" on public.game_players
  for select to anon, authenticated using (true);

-- players: NO public policy. discord_id lives here; read players_public instead.
-- companion_tokens, companion_commands, discord_config: NO policy at all. Secrets.
--
-- M1.6 (admin, Discord OAuth via Supabase Auth) adds session-scoped policies here,
-- gated on players.is_admin for the signed-in user. Until then admin reads and writes
-- go through the service role in apps/web route handlers.

-- Belt and braces on top of RLS: Supabase grants anon and authenticated full DML on new
-- public tables by default. Take the writes away everywhere and the reads away from the
-- three private tables, so a future permissive policy cannot open a hole by itself.
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
revoke select on public.players from anon, authenticated;
revoke all on public.companion_tokens from anon, authenticated;
revoke all on public.companion_commands from anon, authenticated;
revoke all on public.discord_config from anon, authenticated;

grant select on public.players_public to anon, authenticated;

-- bootstrap_admin is a privilege escalation primitive: service role only.
revoke all on function public.bootstrap_admin(text) from public, anon, authenticated;
grant execute on function public.bootstrap_admin(text) to service_role;

-- ---------------------------------------------------------------------------
-- Realtime
--
-- The tonight page (M3.4) and the bot (M4.4) subscribe to postgres_changes on these
-- tables. Supabase creates `supabase_realtime` empty, and a table that is not in the
-- publication simply never emits, silently. RLS still decides what a subscriber sees, so
-- only publicly readable tables are published here.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end;
$$;

alter publication supabase_realtime add table
  public.lobbies,
  public.lobby_members,
  public.splits,
  public.games,
  public.game_players,
  public.ratings;
