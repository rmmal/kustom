-- 0004_backfill_approval.sql (M5.1)
--
-- Backfill approval, per player.
--
-- `01-architecture.md` ("Security") makes backfill the one exception to "a companion may only
-- report what it was in": an end-of-game post is a single game the server can see a lobby for,
-- while a backfill batch is dozens of games from nowhere and one bad or mis-mapped batch moves
-- every rating in the group. So an admin says yes once, per player, before the first batch —
-- after that the daily pass is silent forever.
--
-- Two columns, three states, read by `POST /api/companion/backfill/scan` and by
-- `/admin/players`:
--
--   both null                      off      the scan answers `{ approved: false, unknown: [] }`
--   requested_at set, approved null asked   the companion has knocked; an admin has not answered
--   approved_at set                on       the scan answers with the ids we do not have
--
-- `backfill_requested_at` is set by the scan route the first time an unapproved companion asks
-- and never moved again (a second scan does not touch it), so the admin page can say when the
-- friend's PC first came looking. Revoking sets `backfill_approved_at` back to null and the
-- next scan answers `approved: false`; the request timestamp is deliberately left standing, as
-- the record of the original ask.
--
-- No RLS change is needed: `public.players` is service-role only (`0001_init.sql`) and is not
-- in the `supabase_realtime` publication, so these columns are visible to the API and to
-- nothing else. `players_public` does not select them and must not: who may send match history
-- is an admin's business, not the tonight page's.

alter table public.players
  add column backfill_requested_at timestamptz,
  add column backfill_approved_at  timestamptz;

comment on column public.players.backfill_requested_at is
  'M5.1: when this player''s companion first asked to send match history. Set once by /api/companion/backfill/scan, never moved.';
comment on column public.players.backfill_approved_at is
  'M5.1: when an admin allowed this player''s companion to send match history. Null means no; revoking sets it back to null.';
