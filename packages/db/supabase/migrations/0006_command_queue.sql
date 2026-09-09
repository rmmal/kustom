-- 0006_command_queue.sql
--
-- What a `companion_commands` row could not say (M4.1, server half; `04-decisions.md`
-- 2026-09-09).
--
-- As shipped in `0001_init.sql` the row can say what to do (`kind`, `payload`) and that it was
-- acked (`status`, `acked_at`), and nothing else. It cannot say what came back, why it failed,
-- how many times it has been handed out, or when it stops being worth doing — and a
-- `create_lobby` handed to a companion an hour late opens a lobby nobody asked for. Five
-- columns, one per missing fact:
--
--   sent_at    when the poll last handed this row out. With `status = 'sent'` it is what the
--              30 s reclaim window is measured on: a companion mid-execution must not be raced
--              by its own next poll, and a crashed one must cost at most one poll.
--   attempts   how many times it has been handed out. The fourth delivery fails the row
--              instead ('not acked after 3 deliveries'): a command that kills the companion
--              three times is not going to work the fourth.
--   result     the kind's result payload, parsed with `companionCommandResultSchemas` before
--              it is stored, so a mangled result is a 422 and never a lie M4.2 will read.
--   error      why it failed, verbatim from the companion's nack (a `commandFailureReasonSchema`
--              word, then a detail after ': '), or the server's own 'expired' / 'superseded'.
--   expires_at when it stops being worth doing. Set by the writer from the per-kind TTL
--              (`COMPANION_COMMAND_TTL_MS`: create_lobby 60 s, invite 5 min, switch_side 3 min).
--              The default below is the 5-minute backstop for a row inserted without one.
--
-- The expiry sweep — `update ... set status = 'failed', error = 'expired' where status in
-- ('pending', 'sent') and expires_at <= now()` — runs at the top of every poll, whatever
-- `clientConnected` says, so expiry is the server's job and the companion never compares
-- `expires_at` with its own clock (`04-decisions.md`, 2026-09-09).
--
-- No new index. `companion_commands_pending_idx (target_player_id, created_at) where status in
-- ('pending', 'sent')` already serves both the poll (the token's player, oldest first) and the
-- sweep (every live row; there are at most a few dozen in a night).
--
-- RLS is unchanged and stays as `0001` left it: **no policy at all**. The table is reachable
-- only through the service role behind a companion-token check, and nothing in it is ever
-- public — `create_lobby.payload` carries the lobby password.
--
-- The API half is `apps/web/lib/commands/` (the queue writer, the gate and the TTLs) and
-- `apps/web/app/api/companion/commands/*` (poll, ack, nack). The wire contract is the doc
-- comment on `companionCommandsResponseSchema` in `packages/db/src/schemas/companionResponses.ts`.
--
-- Never edit this file once it has been applied. Add a new numbered migration.

alter table public.companion_commands
  add column if not exists sent_at    timestamptz,
  add column if not exists attempts   smallint    not null default 0,
  add column if not exists result     jsonb,
  add column if not exists error      text,
  add column if not exists expires_at timestamptz not null default now() + interval '5 minutes';

comment on column public.companion_commands.sent_at is
  'When the poll last handed this row out. The 30 s reclaim window is measured on it.';
comment on column public.companion_commands.attempts is
  'Deliveries so far. The fourth fails the row with error = ''not acked after 3 deliveries''.';
comment on column public.companion_commands.result is
  'The kind''s result payload, parsed with its zod schema before storage. Null unless status = ''acked''.';
comment on column public.companion_commands.error is
  'Why it failed: the companion''s nack text, or the server''s ''expired'' / ''superseded''.';
comment on column public.companion_commands.expires_at is
  'When this command stops being worth doing. Set by the writer from the kind''s TTL; swept to failed/''expired''.';

comment on table public.companion_commands is
  'The command queue the companion polls (M4.1): create_lobby, invite, switch_side. No RLS policy at all — service role only, behind a companion-token check; create_lobby.payload carries the lobby password.';
