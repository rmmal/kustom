-- 0011_window_posts.sql
--
-- One row per window the group has been told about (M5.13).
--
-- Every Monday the closed week posts itself to Discord, and every 1st the closed month
-- (`GET /api/cron/window`, bearer CRON_SECRET). The schedule lives outside the app, so the
-- route has to be safe at any cadence: called hourly, daily or twice a minute it posts each
-- window exactly once. This table is how "exactly once" is decided, and the primary key
-- `(kind, window_start)` is the whole mechanism -- two calls in the same second race on the
-- insert and Postgres picks the winner.
--
-- **Insert first, post second.** A duplicate post is a thing ten friends see in the channel;
-- a missed one is a thing they ask about once. So the route claims the window by inserting
-- this row, and only the call whose insert landed builds an embed.
--
--   kind         'last-week' or 'last-month'. Text with a check rather than an enum type: the
--                same two words are `windowPostKindSchema` in packages/db/src/schemas, and a
--                check constraint is one migration instead of a type plus an alter.
--   window_start the window's own start instant (Monday 06:00 or the 1st at 06:00 in
--                CUSTOMS_NIGHT_TZ), which is `closedWindow(kind, now, tz).key`. The other half
--                of the key: a week is identified by when it began, whatever day it was posted.
--   claimed_at   when a call took this window to post it, from the **route's** clock and not
--                the database's, so an injected clock in a test and the lease below agree.
--   posted_at    when the post actually landed, or **null while it has not**. Null is the
--                retry seam: a webhook that was down when the week closed leaves the row
--                claimed and unposted, and a later call retries it. A window with no games at
--                all is marked posted with a `reason` instead, so an empty week is not retried
--                every hour for seven days.
--   attempts     how many calls have tried. One on the insert; the CAS retry bumps it.
--   reason       why nothing was sent, when nothing was: 'no games in the window' on a posted
--                row, or the last webhook failure on an unposted one. Never the webhook URL.
--
-- The retry is a lease and a compare-and-swap, not a bare "posted_at is null": the second of
-- two calls that arrive while the first is still talking to Discord must post nothing, so a
-- claim is only taken over once it is `WINDOW_POST_RETRY_MS` old, and the takeover updates
-- `where claimed_at = <the value it read>` so two retriers cannot both win.
-- (`apps/web/lib/discord/windowPosts.ts`.)
--
-- **So this table is at-least-once, not exactly-once, and that is the deliberate half.** If
-- Discord answers 2xx and the `posted_at` stamp then fails -- the process dies, the database is
-- unreachable for those few milliseconds -- the row stays unposted and a call after the lease
-- posts the week a second time. Exactly-once across two systems is not available without a
-- distributed transaction; given the choice, a week that arrives twice in a year is a shrug and
-- a week that never arrives is the feature not working. Everything else here is aimed at making
-- that window as small as it can be: one stamp, immediately after the webhook returns.
--
-- RLS: enabled with **no policy at all** and the grants revoked, like `companion_tokens` and
-- `discord_config`. Only the service role behind `CRON_SECRET` ever touches it, and "which
-- weeks have been posted" is not a public fact.
--
-- Never edit this file once it has been applied. Add a new numbered migration.

create table public.window_posts (
  kind         text        not null check (kind in ('last-week', 'last-month')),
  window_start timestamptz not null,
  claimed_at   timestamptz not null default now(),
  posted_at    timestamptz,
  attempts     smallint    not null default 1 check (attempts >= 0),
  reason       text,
  primary key (kind, window_start)
);

comment on table public.window_posts is
  'One row per closed window the weekly/monthly Discord post has claimed (M5.13). The primary key (kind, window_start) is what makes GET /api/cron/window safe to call at any cadence. Service role only: no RLS policy at all.';
comment on column public.window_posts.kind is
  'last-week or last-month. The same two words as windowPostKindSchema in packages/db/src/schemas.';
comment on column public.window_posts.window_start is
  'The window''s start instant: Monday 06:00 or the 1st at 06:00 in CUSTOMS_NIGHT_TZ (closedWindow().key).';
comment on column public.window_posts.claimed_at is
  'When a call claimed this window, from the route''s clock. The retry lease is measured on it.';
comment on column public.window_posts.posted_at is
  'When the post landed, or null while it has not -- which is what makes a failed post retryable. Set with a reason for a window that had no games, so an empty week is not retried hourly.';
comment on column public.window_posts.attempts is
  'How many calls have tried to post this window.';
comment on column public.window_posts.reason is
  'Why nothing was sent, when nothing was. Never contains the webhook URL.';

alter table public.window_posts enable row level security;

-- Belt and braces on top of RLS, exactly as 0001 does for the three private tables: Supabase
-- grants anon and authenticated full DML on new public tables by default.
revoke all on public.window_posts from anon, authenticated;
