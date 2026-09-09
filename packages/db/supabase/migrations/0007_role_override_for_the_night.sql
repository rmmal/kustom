-- 0007_role_override_for_the_night.sql
--
-- `lobby_members.role_override` lasts the **night**, not the lobby row (M3.6; decision row
-- 2026-09-09).
--
-- `0001_init.sql` commented the column "Cleared when the lobby finishes", which was written
-- when a `lobbies` row was one party for a whole night. Since M2.14 (`0003`) a row is one
-- *game cycle*, so that rule would make every friend re-tap between every game — four or five
-- extra steps a night in a product whose whole claim is that nobody does anything.
--
-- What actually happens, and what this comment now says:
--
--   * the tap writes this column on the player's row in the lobby that is live at the time;
--   * when lobby ingest opens the night's **next** cycle for the same party, it copies the
--     value forward from that player's row in the party's previous cycle, provided that row
--     was created after `nightStart` for the current night (`apps/web/lib/ingest/lobby.ts`);
--   * nothing is cleared on `finished`. The closed row keeps its value as the record of what
--     the teams were built from, and the first lobby of the next night simply has nothing to
--     copy from.
--
-- No column, index, policy or type changes here: the write path is `POST /api/me/role-tonight`
-- (session with a linked player) and `apps/web/lib/ingest/lobby.ts`, and the read path is
-- `loadPool` → core's `resolveRoles`, which makes the override the player's main and their
-- usual main the backup. This migration exists so the database's own documentation is not the
-- one place still stating the retired rule.
--
-- Never edit this file once it has been applied. Add a new numbered migration.

comment on column public.lobby_members.role_override is
  'Role the player picked for tonight (M3.6). A preference, not a lock: core makes it their main and demotes their usual main to backup, and the balancer may still seat them elsewhere. Lasts the night — lobby ingest copies it onto the party''s next cycle while that cycle starts inside the same 06:00-to-06:00 night — and is never cleared on finish; the closed row keeps it as the record of what the teams were built from.';
