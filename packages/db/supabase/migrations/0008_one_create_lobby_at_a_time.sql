-- 0008_one_create_lobby_at_a_time.sql
--
-- The Start-a-lobby lock stops being a race (M4.9; reviewer, 2026-09-10).
--
-- M4.2's double-tap guard was a read followed by an insert: `readStartLobbyState` looked for a
-- live `create_lobby` row and `decideStart` refused with `A lobby is already being opened.` when
-- it found one. Two presses in the same instant both read nothing and both insert, and the
-- product's own line — "two people tap at the same moment: one `create_lobby` row" — is not
-- true. What the group sees when it happens:
--
--   * same host — the companion opens one lobby and nacks the second command
--     `already_in_lobby`, and the page prints `<Name> already has a lobby open — everyone can
--     join that one.` about a lobby the group just asked for. A misleading sentence.
--   * two admins, two companions — two `create_lobby` rows land on two different hosts, two
--     lobbies open, and the ack of each one fans out its own set of invites. Ten friends get two
--     popups for two different lobbies with two different passwords.
--
-- A read cannot fix that; only the database can. This index is the lock.
--
--   create unique index ... on companion_commands (kind)
--     where kind = 'create_lobby' and status in ('pending', 'sent')
--
-- The predicate pins `kind` to one value, so uniqueness *on* `kind` means **at most one row in
-- the whole table** matching it: one create in flight, anywhere, at a time.
--
-- **Global, not per host and not per night.** M4.2's refusal table says
-- `A lobby is already being opened.` for a pending create with no qualifier, and the read it
-- describes never filtered by player either — it is one sentence about one group's one night.
-- Per host would leave the worse of the two failures above (two admins, two lobbies, two
-- fan-outs) wide open, which is the case the reviewer actually found. Per night cannot be
-- written down here at all: a night boundary is `06:00` in `CUSTOMS_NIGHT_TZ`, and
-- `timestamptz at time zone <text>` is STABLE, not IMMUTABLE, so Postgres will not index it. And
-- it would buy nothing: a create_lobby's TTL is 60 seconds, so the widest thing this index can
-- ever lock out is one minute, and a minute never spans two nights.
--
-- **`sent` is inside the lock deliberately.** A row handed to a companion that has not answered
-- yet is a lobby that may already exist on somebody's screen. The two live statuses are the same
-- two everything else in the queue calls live (`LIVE_STATUSES` in `apps/web/lib/commands/queue.ts`,
-- `companion_commands_pending_idx` in `0001_init.sql`).
--
-- **The lock releases itself, and the sweep is what does it.** `acked` and `failed` are outside
-- the predicate, so a create that succeeds, is nacked, or is expired by
-- `sweepExpiredCommands` — `status = 'failed', error = 'expired'`, at the top of every poll —
-- leaves the index that instant and the next press is free. There is no unlock statement and
-- nothing to leak: the worst case is that the slot is held for the 60 seconds of the kind's own
-- TTL, which is exactly what M4.2 says the lock is worth.
--
-- **`expires_at` is not in the predicate** — `now()` is not immutable and a partial index cannot
-- name it. So expiry is the sweep's job here as it is everywhere else, and the press sweeps
-- before it reads (`startLobby`) so a stale pending row from a companion that went away does not
-- hold the slot against a live press.
--
-- The API half is `apps/web/lib/admin/lobbyStart.ts` (the read-first refusal, which still runs
-- first and still gives the friendly path) and `enqueueCommands` in
-- `apps/web/lib/commands/queue.ts`, which turns a `23505` on this index into
-- `skipped: [{ kind: 'create_lobby', reason: 'conflict' }]` instead of throwing, and the route
-- maps that to the same 409 and the same sentence. A caller cannot tell which of the two paths
-- refused it, which is the point.
--
-- RLS is unchanged: `companion_commands` still has no policy at all, service role only.
--
-- Never edit this file once it has been applied. Add a new numbered migration.

create unique index if not exists companion_commands_one_create_lobby_idx
  on public.companion_commands (kind)
  where kind = 'create_lobby' and status in ('pending', 'sent');

comment on index public.companion_commands_one_create_lobby_idx is
  'M4.9: at most one create_lobby in pending or sent, globally. The Start-a-lobby double-tap lock, as a constraint rather than a read. Released by ack, nack or the expiry sweep.';
