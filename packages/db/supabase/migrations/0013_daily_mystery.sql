-- 0013_daily_mystery.sql
--
-- One accountless guessing game per civil day (M5.32).
--
-- The website picks one interesting custom-game performance, hides who it was, and lets
-- visitors guess. There are no accounts. The League player on the scoreboard and the
-- website visitor are different people. Competition is anonymous: first correct guess,
-- clues used, community accuracy. Never "Ahmed is #1".
--
--   daily_mysteries          one row per civil date in CUSTOMS_NIGHT_TZ. Unique on `day`
--                            so two first visitors cannot fork the challenge. The answer
--                            (`mystery_player_id`) lives here and is never publicly readable.
--   daily_mystery_clues      progressive clues, stored at creation. The public GET does
--                            not return them; each reveal POST returns the next row only.
--   daily_mystery_sessions   per-visitor clue progress and start time (for completion_ms).
--   daily_mystery_attempts   one guess per visitor per challenge. Unique (challenge, visitor).
--
-- RLS: enabled with **no policy at all** and the grants revoked, like `window_posts` and
-- `companion_tokens`. The answer, the unrevealed clues, and visitor ids are not public
-- facts. Every read goes through the API with the service role, which strips the secret
-- columns before a response leaves the server.
--
-- Never edit this file once it has been applied. Add a new numbered migration.

create table public.daily_mysteries (
  id uuid primary key default gen_random_uuid(),
  day date not null unique,
  challenge_number integer not null unique check (challenge_number >= 1),
  game_id uuid not null references public.games (id) on delete restrict,
  mystery_player_id uuid not null references public.players (id) on delete restrict,
  interesting_score double precision not null,
  category text not null check (category in ('disaster', 'monster', 'farming', 'raid_boss', 'ghost')),
  suspect_ids uuid[] not null,
  hook jsonb not null,
  active_from timestamptz not null,
  expires_at timestamptz not null,
  first_correct_at timestamptz,
  created_at timestamptz not null default now()
);

create index daily_mysteries_expires_at_idx on public.daily_mysteries (expires_at);
create index daily_mysteries_game_id_idx on public.daily_mysteries (game_id);
create index daily_mysteries_player_id_idx on public.daily_mysteries (mystery_player_id);

comment on table public.daily_mysteries is
  'One Daily Mystery per civil day (M5.32). Service role only: the answer column must not be readable by anon.';
comment on column public.daily_mysteries.day is
  'Civil date in CUSTOMS_NIGHT_TZ. The unique key that makes every visitor see the same challenge.';
comment on column public.daily_mysteries.mystery_player_id is
  'The League player being exposed. Never returned by GET /api/daily-mystery.';
comment on column public.daily_mysteries.first_correct_at is
  'Set atomically on the first correct guess. Two simultaneous corrects cannot both claim First Detective.';
comment on column public.daily_mysteries.suspect_ids is
  'The six (or fewer) player ids shown as choices, including the answer, in display order.';
comment on column public.daily_mysteries.hook is
  'Public opening stats: KDA, duration, category lines. No identity.';

create table public.daily_mystery_clues (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.daily_mysteries (id) on delete cascade,
  clue_type text not null,
  clue_value text not null,
  reveal_order smallint not null check (reveal_order >= 1),
  unique (challenge_id, reveal_order)
);

comment on table public.daily_mystery_clues is
  'Progressive clues for a Daily Mystery. Values stay on the server until a visitor asks for the next one.';

create table public.daily_mystery_sessions (
  challenge_id uuid not null references public.daily_mysteries (id) on delete cascade,
  visitor_id text not null,
  clues_revealed smallint not null default 0 check (clues_revealed >= 0),
  started_at timestamptz not null,
  last_request_at timestamptz not null,
  request_count integer not null default 1 check (request_count >= 0),
  primary key (challenge_id, visitor_id)
);

comment on table public.daily_mystery_sessions is
  'Anonymous visitor progress on a challenge: how many clues they have asked for, and when they opened it.';

create table public.daily_mystery_attempts (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.daily_mysteries (id) on delete cascade,
  visitor_id text not null,
  guessed_player_id uuid not null references public.players (id) on delete restrict,
  correct boolean not null,
  clues_used smallint not null check (clues_used >= 0),
  completion_time_ms integer not null check (completion_time_ms >= 0),
  created_at timestamptz not null default now(),
  unique (challenge_id, visitor_id)
);

create index daily_mystery_attempts_challenge_idx on public.daily_mystery_attempts (challenge_id, created_at);

comment on table public.daily_mystery_attempts is
  'One locked guess per anonymous visitor per Daily Mystery. Unique (challenge_id, visitor_id).';

alter table public.daily_mysteries enable row level security;
alter table public.daily_mystery_clues enable row level security;
alter table public.daily_mystery_sessions enable row level security;
alter table public.daily_mystery_attempts enable row level security;

revoke all on public.daily_mysteries from anon, authenticated;
revoke all on public.daily_mystery_clues from anon, authenticated;
revoke all on public.daily_mystery_sessions from anon, authenticated;
revoke all on public.daily_mystery_attempts from anon, authenticated;
