-- 0010_inferred_roles.sql (M5.17)
--
-- Roles stop being typed in and start being read off the games people play.
--
-- `inferRoles` (M5.16, `packages/core`) answers "main, backup, and how many games that rests
-- on" from a player's own rated games. This migration is where the answer lands and where the
-- one fact the answer needs — and cannot reconstruct later — is written down.
--
-- Two things, in one migration:
--
-- 1. `game_players.counts_for_role_inference`. The feedback-loop guard (`04-decisions.md`,
--    2026-09-10). A game does **not** count toward a player's inferred roles if the balancer
--    put them off both their then-main and then-backup: without that rule a support who gets
--    filled into jungle twice becomes a jungle main, is balanced as one, and never plays
--    support again — the product would have invented a role for somebody and then insisted on
--    it. Whether somebody was filled is only knowable *at fold time*, because the roles it is
--    measured against move afterwards, so it is stored per row rather than derived later.
--
--    `default true` is the honest default and not a shrug: a game we did not balance — every
--    backfilled game (M5.1), every game played from no lobby — counts, because nobody forced
--    anybody into anything. Rows written before this migration are exactly that case as far as
--    anything can now tell, and the first `rebuild-ratings` after it re-reads them all.
--
-- 2. `players.roles_inferred_at` and `players.roles_counted`. The pair itself stays in
--    `main_role` / `secondary_role`, the columns the balancer already reads, so nothing
--    downstream moves and the M1-era hand-set roles are simply overwritten by the first
--    recompute. These two are what the answer rests on: when it was worked out, and out of how
--    many counted games — `/admin/players` prints `support · jungle · from 17 games`, or
--    `flexible · from 2 games` under the M5.16 threshold of three.
--
--    `roles_counted` is `not null default 0`, so "never computed" and "no games yet" are the
--    same displayed sentence (`flexible · no games yet`) and no page has to handle a null int;
--    `roles_inferred_at` stays nullable and is the freshness stamp.
--
-- No RLS change: `public.players` and `public.game_players` are service-role only
-- (`0001_init.sql`), and `players_public` names its columns one by one, so neither new column
-- reaches anon by adding it here. Nothing public needs them — a friend sees their role on the
-- tonight page, which is `main_role` as it always was.

alter table public.game_players
  add column counts_for_role_inference boolean not null default true;

comment on column public.game_players.counts_for_role_inference is
  'M5.17: does this game count toward the player''s inferred roles? Written at fold time — true when the balancer put them on their then-main or backup, or when we did not balance the game at all (backfill, no lobby). False means they were filled, and a fill never changes who somebody is.';

alter table public.players
  add column roles_inferred_at timestamptz,
  add column roles_counted     integer not null default 0 check (roles_counted >= 0);

comment on column public.players.roles_inferred_at is
  'M5.17: when main_role/secondary_role were last worked out from this player''s games. Null means never (the roles are M1-era hand-set ones, or none).';
comment on column public.players.roles_counted is
  'M5.17: how many counted games the inferred pair rests on, for /admin/players. Under 3 (config.roles.minGames) the pair is flexible and this says why.';
comment on column public.players.main_role is
  'M5.17: inferred from play, not set by hand. The most frequent role over the last 20 counted games; null is flexible.';
comment on column public.players.secondary_role is
  'M5.17: inferred from play, not set by hand. The second most frequent role, or null when there is only one.';
