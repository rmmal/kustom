-- 0005_lobby_dropped.sql
--
-- `dropped`: a lobby that reached `in_game` and never got a result (M5.11).
--
-- Until now `in_game` was terminal in practice — the two-hour sweep moved only `open` and
-- `balanced` rows, because `abandoned` keeps the M2.9 replace semantics and sweeping an
-- `in_game` lobby would unfreeze the record of who played. The cost of that was paid by the
-- whole group, not by the row: `lobbies_active_party_idx` (`0003`) allows exactly one live
-- row per party, the client keeps one `partyId` all night (M2.14), so a single missed
-- end-of-game block left the party's live row at `in_game` and every later post of that night
-- landed on a frozen roster — no balance, no split, and `rosterFrozen: true` as the only
-- clue.
--
-- So the stuck row leaves the live set by its own door. `dropped` means "reached `in_game`,
-- nobody will ever see a result for it": the roster stays frozen forever, the row is outside
-- the partial index so the party's next post starts a clean cycle, and it is *not*
-- `abandoned`, which means "dissolved before it ever started" and is the one fact M5.5 exists
-- to show.
--
-- `dropped -> finished` stays legal in the API's transition table, so an end-of-game block
-- queued on a companion for days still closes its own lobby and the row leaves M5.5's missed
-- list by itself.
--
-- Nothing else changes. `lobbies_active_party_idx` and `lobbies_open_idx` are both
-- `where status in ('open', 'balanced', 'in_game')` already, so a `dropped` row falls out of
-- both without touching either index, and the `in_game` half of the sweep is served by
-- `lobbies_open_idx (updated_at desc)`.
--
-- The API half is `LOBBY_TRANSITIONS` and `sweepIdleLobbies` in `apps/web/lib/lobbyState.ts`.
--
-- Never edit this file once it has been applied. Add a new numbered migration.

-- `after 'in_game'` keeps the enum in lifecycle order, which is the order the generated types
-- and `LOBBY_STATUSES` in `@customs/db/schemas` carry. `add value` cannot be used in the same
-- transaction that adds it, so nothing below references the new label in an expression: the
-- comments are text.
alter type public.lobby_status add value if not exists 'dropped' after 'in_game';

comment on type public.lobby_status is
  'Lobby lifecycle, in order: open, balanced, in_game, dropped, finished, abandoned. dropped = reached in_game and never got a result (M5.11); abandoned = dissolved before it ever started. The API owns which moves are legal.';

comment on column public.lobbies.status is
  'One of lobby_status. open/balanced/in_game are the live set (lobbies_active_party_idx); dropped, finished and abandoned are outside it, so the party''s next post starts the night''s next cycle.';
