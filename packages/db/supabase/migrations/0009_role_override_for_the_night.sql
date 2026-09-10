-- 0009_role_override_for_the_night.sql
--
-- A role for tonight is a **preference of the player for the night**, not a value that lives
-- only on a `lobby_members` row (M3.6; decision rows 2026-09-09 and 2026-09-10).
--
-- Why the column: `lobbies` rows are game cycles (M2.14) and `lobby_members` rows are deleted
-- and recreated by every companion post that changes the roster (M2.9's replace semantics). So
-- the row is the wrong place to keep a choice that is supposed to last until 06:00: a friend
-- who tapped `mid`, closed the client lobby for a moment and rejoined lost it, because the
-- delete took the only copy with it. Reading the value back off the previous cycle covered the
-- between-games case and nothing else — the reviewer proved the rest on the stack, 2026-09-10.
--
-- What happens now:
--
--   * `POST /api/me/role-tonight` writes `players.role_tonight` with `role_tonight_until` set
--     to the **end of the night** (06:00 local, `apps/web/lib/night.ts`), and writes
--     `lobby_members.role_override` on the live lobby row in the same request, so the balancer
--     path is exactly what it was;
--   * lobby ingest gives every member row it **creates** `role_override = players.role_tonight`
--     while `role_tonight_until > now()` — a new cycle, a rejoin, a re-created row, all one
--     rule (`apps/web/lib/ingest/roleCarry.ts`);
--   * clearing writes null to both, so nothing comes back;
--   * a night ends and the preference expires by itself. Nothing is swept, and nothing is
--     cleared on `finished`: the closed `lobby_members` row keeps its value as the record of
--     what the teams were built from.
--
-- Renumbered from 0007 on 2026-09-10: M4.9's `0008` reached the hosted project first, and the
-- Supabase CLI refuses to push a version older than the newest applied one.
--
-- Never edit this file once it has been applied. Add a new numbered migration.

alter table public.players
  add column role_tonight public.player_role,
  add column role_tonight_until timestamptz;

comment on column public.players.role_tonight is
  'The role this player picked for tonight (M3.6), or null. A preference, not a lock: core makes it their main and demotes their usual main to backup, and the balancer may still seat them elsewhere. Valid only while role_tonight_until is in the future.';

comment on column public.players.role_tonight_until is
  'When role_tonight stops counting: 06:00 local (CUSTOMS_NIGHT_TZ) at the end of the night it was picked in. Nothing sweeps it -- an expired pair is simply ignored, and the next tap overwrites both columns.';

comment on column public.lobby_members.role_override is
  'Role the player picked for tonight (M3.6), copied onto this row from players.role_tonight when the row was created and by the tap itself. This is what the balancer reads. Never cleared on finish: a closed row keeps it as the record of what the teams were built from.';
