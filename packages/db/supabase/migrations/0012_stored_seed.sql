-- 0012_stored_seed.sql (M5.7)
--
-- Where a player's history starts, written down once instead of guessed again every rebuild.
--
-- A rating is a fold over games in `started_at` order, and every fold needs a first value. Until
-- now that value was `seedFromRank(players.rank_tier, players.rank_division)` — the player's rank
-- **as it is read today** — computed by the live fold when it creates somebody's `ratings` row
-- and computed again from scratch by `rebuild-ratings`. Those two are the same number only for as
-- long as nobody's rank moves. The day a friend climbs to Platinum, the next rebuild re-seeds
-- their whole history from the new rank and every number on their page shifts, with nothing in
-- the database able to say why. That is the caveat M5.2's brief has carried since it shipped, and
-- these four columns are the end of it.
--
-- **The rule: the first fold that rates a player writes their seed, and nothing ever rewrites
-- it.** Both folds — `apps/web/lib/ingest/rating.ts` and `apps/web/lib/ingest/rebuild.ts` — read
-- the stored pair when it is there and fall back to `seedFromRank` when it is not.
--
-- `seed_mu` / `seed_sigma` are the `{ mu, sigma }` itself: they are what the fold consumes, and
-- re-deriving them from the rank at read time would be a second copy of core's seed table living
-- in whatever code happened to need it.
--
-- `seed_rank_tier` / `seed_rank_division` are the two strings that seed was computed from, stored
-- raw and uppercase exactly as `players` holds them — not a formatted label like `Gold II`. Two
-- reasons. The player page prints `Seeded from Gold II at 1380.` (M5.15) and the words have to
-- name the rank the number actually came from, not the rank the player wears tonight; and storing
-- the input rather than the output keeps `rankLabel` the one formatter and lets anybody check the
-- pair by running `seedFromRank` on it. Both are nullable because `null` is a real answer —
-- unranked, or a client that reported nothing — which is why `seed_mu` and not these two is what
-- "this row has a stored seed" is read off.
--
-- **No backfill in this migration.** Existing rows are filled by the next `rebuild-ratings`, which
-- writes the seed it used for every row that has none. The seed is `seedFromRank`, a lookup table
-- that lives in `packages/core` and is the only definition of itself (CLAUDE.md: rating maths is
-- never re-implemented outside core); an `update ... case tier when 'GOLD' ...` here would be that
-- table copied into SQL, drifting from the day it is written. The rebuild already computes the
-- number it is about to fold from, so filling the column from it is exact rather than a
-- reconstruction, and it costs a command the operator was going to run anyway.
--
-- **What the backfill can and cannot promise.** For a row it fills, the seed is the player's rank
-- *at backfill time*, because their rank when they first played was never recorded anywhere. That
-- is precisely the number their stored history is already made of, so writing it changes nothing
-- and freezes what is there. From that point on a rank change moves nobody's past.
--
-- RLS: `public.ratings` is publicly readable (`0001_init.sql`) and these four ride along, which is
-- what the seed line on `/p/[puuid]` needs — it is read with the anon key like the rest of that
-- page. Nothing here is a secret: it is a rank the group can see in the client.

alter table public.ratings
  add column seed_mu            double precision,
  add column seed_sigma         double precision,
  add column seed_rank_tier     text,
  add column seed_rank_division text;

-- A seed is a pair or it is nothing: half a seed cannot be folded from, and a reader that had to
-- handle "mu but no sigma" would be handling a state no writer is allowed to produce.
alter table public.ratings
  add constraint ratings_seed_pair check ((seed_mu is null) = (seed_sigma is null));

-- The same check `sigma` itself carries, for the same reason: sigma is a standard deviation.
alter table public.ratings
  add constraint ratings_seed_sigma_positive check (seed_sigma is null or seed_sigma > 0);

comment on column public.ratings.seed_mu is
  'M5.7: the mu this player''s history was folded from. Written by the first fold that rates them and never rewritten, so a rank that moves afterwards does not move their past. Null on a row written before 0012; the next rebuild-ratings fills it.';
comment on column public.ratings.seed_sigma is
  'M5.7: the sigma beside seed_mu. Both or neither (ratings_seed_pair).';
comment on column public.ratings.seed_rank_tier is
  'M5.7: players.rank_tier as it was when the seed was taken, raw (GOLD), not a label. Null is a real answer — unranked. Read seed_mu to know whether a seed is stored at all.';
comment on column public.ratings.seed_rank_division is
  'M5.7: players.rank_division as it was when the seed was taken, raw (II). Null means the tier had no division, or none was reported.';
