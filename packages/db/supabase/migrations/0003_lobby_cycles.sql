-- 0003_lobby_cycles.sql
--
-- A `lobbies` row is one game cycle, not one party (M2.14).
--
-- The League client keeps the same `partyId` for the whole night: in
-- `packages/lcu/fixtures/16.17/ws-events.ndjson` party `e3c69392` was created at 16:36:41,
-- played 16:37:39 to 16:53:05, and was still emitting lobby `Update` events at 17:39:27 with
-- no new `Create` and no new id. With `lcu_party_id` plainly unique and the M2.9 roster
-- freeze, the first game of the night closes that row for good and every later game of the
-- same night gets silence.
--
-- So: at most one *live* lobby per party, and a post whose latest row for the party is
-- `finished` or `abandoned` starts a new row with the same party id. Nothing is rewritten and
-- nothing is deleted; the closed row keeps its frozen members and its `games` link.
--
-- The ingest side of this is `selectActiveLobby` (lobby ingest) and `selectLatestLobby`
-- (game ingest, which falls back to the newest row for an end-of-game block that arrives
-- after the cycle closed) in `apps/web/lib/ingest/lobby.ts`.
--
-- Never edit this file once it has been applied. Add a new numbered migration.

-- The plain unique key. Its index goes with it.
alter table public.lobbies drop constraint lobbies_lcu_party_id_key;

-- At most one live lobby per party. `open`, `balanced` and `in_game` are the statuses a post
-- may still land on; `finished` and `abandoned` are terminal and are skipped by the lookup,
-- which is what lets the same party id appear again for the night's second game.
create unique index lobbies_active_party_idx
  on public.lobbies (lcu_party_id)
  where status in ('open', 'balanced', 'in_game');

-- "The newest row for this party, whatever its status": the fallback a late end-of-game post
-- resolves through once its cycle has closed.
create index lobbies_party_created_at_idx on public.lobbies (lcu_party_id, created_at desc);

comment on table public.lobbies is
  'One row per game cycle of a League custom lobby. The party id repeats across a night; at most one row per party is live (lobbies_active_party_idx).';
comment on column public.lobbies.lcu_party_id is
  'The client''s party id. NOT unique: one party plays several games a night and each is its own row (M2.14). Unique only among open/balanced/in_game rows.';
