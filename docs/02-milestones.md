# Milestones

Build order. Each milestone ships something a player can see. Tasks are sized for one agent session each.
Acceptance criteria are what an implementing agent must demonstrate before marking a task done.

## Status

| Milestone | Status | Notes |
|---|---|---|
| M0 Spike: verify the client | not started | Blocks M2. Do first. |
| M1 Foundation | not started | Can run in parallel with M0. |
| M2 Companion v1: roster and results | not started | Needs M0 and M1. |
| M3 Teams in Discord and on the web | not started | Needs M2. First night of real use. |
| M4 Lobby automation, voice split, presence | not started | Needs M3. |
| M5 Backfill, seasons, stats | not started | Needs M3. Independent of M4. |
| M6 Tray app and polish | not started | Needs M2 stable for a month. |

Update this table as tasks complete. Status values: `not started`, `in progress`, `blocked: <why>`, `done`.

---

## M0 Spike: verify the client (1 to 2 days, needs a Windows PC with League)

Goal: turn every `unverified` row we need for M2 in `03-lcu-reference.md` into `verified`, with fixtures.

Tasks:

- [ ] **M0.1** `packages/lcu` skeleton: lockfile discovery, basic-auth HTTPS client, WebSocket subscriber, a `smoke` script that hits each endpoint in the reference and writes the raw JSON to `packages/lcu/fixtures/<patch>/<endpoint>.json`.
- [ ] **M0.2** Run the smoke script through a full custom game: open lobby, fill it (even with two people and eight empty slots is enough for shapes), play or remake, reach end of game. Capture the WS event stream to a file.
- [ ] **M0.3** Answer the eight questions in "Behaviors to confirm" in `03-lcu-reference.md`. Update every status column. Write zod schemas for the endpoints we keep, tested against the fixtures.
- [ ] **M0.4** If custom games do not appear in match history, record it in `04-decisions.md` and remove backfill from M5; the end-of-game path is then the only source and the companion rule ("lobby owner runs it") becomes mandatory in the product doc.

Acceptance: `pnpm --filter lcu test` passes against fixtures; the reference doc has no `unverified` rows for lobby, gameflow, eog, current-summoner, ranked-stats.

## M1 Foundation (2 to 3 days)

Goal: the monorepo, the database, and the pure core with tests. No client needed.

- [ ] **M1.1** Monorepo: pnpm workspaces, TypeScript project references, Biome, vitest, `apps/web` (Next.js App Router), `packages/core`, `packages/db`, `packages/lcu` (from M0 or a stub). Root scripts listed in `CLAUDE.md` all exist.
- [ ] **M1.2** Supabase project, migration `0001_init.sql` with the schema in `01-architecture.md`, RLS policies, generated types, `pnpm db:migrate` and `pnpm db:types`.
- [ ] **M1.3** `packages/core/rating`: seed from tier, `rateGame`, `ordinal`, `displayRating`, `predictWin`. Tests: seeds match the table; a Bronze on the winning side gains more than a Master beside them; ten games converge a mis-seeded player.
- [ ] **M1.4** `packages/core/balance`: partition enumeration, role assignment, scoring, top three, explanation string, reroll. Tests: the worked example from the product vision (ten named players with ranks) yields a gap of 100 with everyone on a main role; duo lock is respected; repeat-split penalty changes the choice; nine or eleven players throws.
- [ ] **M1.5** `apps/web` API skeleton: companion token auth middleware, `POST /api/companion/lobby`, `POST /api/companion/game`, `POST /api/companion/rank`, all zod-validated, writing to Supabase with idempotency on `lcu_party_id` and `lcu_game_id`. Lazy player creation by PUUID.
- [ ] **M1.6** `/admin`: Discord OAuth via Supabase Auth, `is_admin` gate. Pages to list players, set roles, link a Discord ID, mint and revoke companion tokens, edit `discord_config`, create a season. Seed the first admin by PUUID in a migration or env var.

Acceptance: `pnpm -r test` green; a curl with a valid token creates a lobby row and a game row; a second identical curl changes nothing.

## M2 Companion v1: roster and results (2 to 3 days, needs M0 and M1)

Goal: a friend runs one exe, and every lobby and game they are in lands in the database with no action.

- [ ] **M2.1** `apps/companion` CLI: config file, first-run token prompt, connection state machine with reconnect and backoff, structured logs with rotation.
- [ ] **M2.2** Lobby watcher: on every lobby WS event, POST the member list with sides and spectator flags. Debouncing lives on the server, not here.
- [ ] **M2.3** Game capture: on gameflow `InProgress` POST the game ID against the lobby; on `EndOfGame` fetch the eog block and POST it. Handle the case where the client reaches `EndOfGame` while the companion was reconnecting: on connect, if phase is `EndOfGame` or `WaitingForStats`, fetch and post.
- [ ] **M2.4** Rank sync: own rank on start and every 6 hours; rank for every unknown PUUID seen in a lobby, once, then weekly.
- [ ] **M2.5** Server: lobby state machine (open, balanced, in_game, finished, abandoned) with the 10-second stability rule; on eog, insert `games` and `game_players`, run `rateGame`, update `ratings`. Ignore eog blocks whose `gameType` is not `CUSTOM_GAME`.
- [ ] **M2.6** Packaging: single Windows exe (Node single-executable application or `pkg`), `README` for friends with three steps: download, paste token, leave it running. Verify it survives a client restart and a PC sleep.

Acceptance: two people run the companion, play one custom, and the game appears once in `games` with ten `game_players` rows and updated ratings. Kill one companion mid-game; the game still lands.

## M3 Teams in Discord and on the web (2 to 3 days, needs M2)

Goal: first real night. Ten join the lobby, teams appear in Discord with an explanation, results and leaderboard follow.

- [ ] **M3.0** Design system: `designer` produces `docs/05-design.md` (tokens, type, component notes, Discord embed text layouts). Lands before any M3 UI task.
- [ ] **M3.1** On `balanced`: run the balancer, store the top three splits, post the teams embed to the Discord webhook: two columns with role and display rating, the explanation line, lobby name and password if known, and a sit-out line when more than ten are around.
- [ ] **M3.2** Reroll: an admin route and a small button on the tonight page that promotes split 2 or 3 and reposts. No random reroll exists.
- [ ] **M3.3** On `finished`: result embed with winner, duration, top damage, rating deltas per player.
- [ ] **M3.4** `/` Tonight page: live via Supabase Realtime; phone-friendly; the link is what gets pasted in WhatsApp. Shows lobby members as they join, then teams, then result.
- [ ] **M3.5** `/leaderboard` and `/p/[puuid]` with rating history. Nightly leaderboard post to the webhook at a configured time.
- [ ] **M3.6** Role override for tonight: a player taps their role on the tonight page (Discord login) or an admin sets it. Cleared when the lobby finishes.

Acceptance: a full night with real players, teams posted within 15 seconds of the tenth join, results within 60 seconds of end of game, no human action beyond joining the lobby.

## M4 Lobby automation, voice split, presence (3 to 4 days, needs M3)

Goal: the companion opens the lobby and invites the ten; Discord splits voice; the WhatsApp thread gets a "7 around".

- [ ] **M4.1** `companion_commands` queue: the companion polls, executes, acks. Kinds: `create_lobby`, `invite`, `switch_side`.
- [ ] **M4.2** "Start a lobby" button on the tonight page and an admin route: creates a `create_lobby` command for a chosen companion user, with a generated name and password, followed by `invite` commands for everyone linked and "around".
- [ ] **M4.3** Auto side switch: after balancing, for each lobby member who runs a companion, queue `switch_side` if they are on the wrong side. Verify the endpoint in M0 first; if it does not exist, this task is dropped and the embed says "switch to your side".
- [ ] **M4.4** `apps/discord` bot: Realtime subscription; on `balanced` move linked members into blue and red voice; on `finished` move everyone back. Handles missing permissions gracefully with a log line, never a crash.
- [ ] **M4.5** Presence: when lobby voice membership changes and no lobby is open, post or edit a single "N around: names" message. Count feeds the sit-out logic as "around".
- [ ] **M4.6** Deploy the bot to Fly.io or Railway with a health check and auto-restart.

Acceptance: from an empty Discord voice channel to a balanced lobby with everyone on the right side and in the right voice channel, with the only human actions being "join voice", "click Start a lobby", and "accept invite".

## M5 Backfill, seasons, stats (2 to 3 days, needs M3; skip backfill if M0.4 said no)

- [ ] **M5.1** Backfill: on companion start and daily, walk the local player's match history, filter `CUSTOM_GAME`, fetch details for unknown game IDs, POST as `source: backfill`. Server verifies the reporting player is a participant.
- [ ] **M5.2** Rating rebuild: `pnpm --filter web rebuild-ratings` folds every game in `started_at` order from seeds. Run after any backfill batch. Idempotent.
- [ ] **M5.3** Seasons: admin starts a new season; ratings copy `mu` and reset `sigma`; leaderboard and pages are season-aware.
- [ ] **M5.4** Stats pages: win rate by role, by side, by duo pairing (min five games together), average game length, longest streaks. Awards at season end: most improved, best off-role, cursed duo.
- [ ] **M5.5** Missed-game report: a page listing lobbies that reached `in_game` but never `finished`, so someone knows the companion rule was broken that night.

Acceptance: after a backfill of one player's history, games appear once each, ratings rebuild deterministically (same output on two runs), and the stats pages render with real numbers.

## M6 Tray app and polish (when M2 has run for a month)

- [ ] **M6.1** Tauri v2 tray shell that runs the CLI as a sidecar: status icon (disconnected, watching, in game), open logs, edit token, start with Windows.
- [ ] **M6.2** Code signing or a clear "unsigned, built from this repo" note on the download page.
- [ ] **M6.3** Post-patch checklist automation: `smoke` runs on companion start after a client version change and reports shape diffs to the admin.

---

## Sequencing summary

```
M0 ----\
        >---- M2 ---- M3 ----+---- M4
M1 ----/                     \--- M5 ---- M6
```

M0 and M1 can be worked by two agents at the same time. M4 and M5 can too.
