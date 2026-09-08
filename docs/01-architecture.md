# Architecture

## Components

```
+----------------------+        HTTPS (bearer token)        +---------------------------+
| Companion (Windows)  | --------------------------------> | apps/web on Vercel        |
|  packages/lcu        |   POST /api/companion/lobby        |  Next.js route handlers   |
|  lobby watcher       |   POST /api/companion/game         |  packages/core (balance,  |
|  eog capture         |   POST /api/companion/rank         |    rating)                |
|  rank sync           |   GET  /api/companion/me           |  Supabase client          |
|                      |   GET  /api/companion/commands     |                           |
|  lobby automation    | <-------------------------------- |                           |
+----------------------+   (create lobby, invite, switch)   +------------+--------------+
        |  local HTTPS + WSS                                             |
        v                                                               v
+----------------------+                                   +---------------------------+
| League client        |                                   | Supabase                  |
|  127.0.0.1:<port>    |                                   |  Postgres, Auth (Discord),|
+----------------------+                                   |  Realtime                 |
                                                           +------------+--------------+
                                                                        |
                        +---------------------------+                   |
                        | Discord                   | <-----------------+
                        |  webhook (M3): teams,     |   apps/web posts via webhook
                        |    results, leaderboard   |
                        |  bot (M4): voice split,   | <-- apps/discord subscribes to Supabase Realtime
                        |    presence               |
                        +---------------------------+
```

One API, one database, one companion binary, one thin bot. The companion never talks to Supabase directly and
never holds a database credential; it holds a per-player companion token.

## Why these choices

| Choice | Reason |
|---|---|
| Supabase | Hosted Postgres plus auth, realtime, and generated types. Discord OAuth for the web is a checkbox. Realtime drives the tonight page and the bot without polling. |
| API in Next.js route handlers, not edge functions | One runtime, one deploy, one place for `packages/core`. Edge functions would add Deno as a second toolchain for no gain at this scale. |
| Companion as a Node CLI first, tray app later | Keeps the whole project TypeScript. `packages/lcu` is shared with any future shell. Packaged with Node single-executable or `pkg`. A Tauri tray wrapper with the CLI as a sidecar is M6. |
| OpenSkill (`openskill` npm) | TrueSkill-family rating with team support, MIT licensed, has `predictWin`. Elo cannot model 5v5 with per-player uncertainty. |
| No Riot public API | The client exposes rank and match history for the logged-in player and rank lookups for others. Removes key approval and rate limits from the project entirely. |
| Discord webhook before bot | Posting messages needs no long-running process. The bot process exists only for voice moves and presence (M4). |

## Data model

Postgres, managed by Supabase migrations in `packages/db/supabase/migrations/`. `0001_init.sql` is the whole
schema below; the listing is kept in step with it.

```sql
seasons        (id, name, starts_at, ends_at, is_active, created_at)
players        (id, puuid unique, summoner_id, game_name, tag_line, display_name,
                discord_id null, is_admin, main_role, secondary_role,
                rank_tier, rank_division, rank_lp, rank_updated_at, created_at)
ratings        (player_id, season_id, mu, sigma, ordinal generated (mu - 2 * sigma) stored,
                games, wins, updated_at)  pk (player_id, season_id), index (season_id, ordinal desc)
lobbies        (id, lcu_party_id, status, reported_by_player_id, lobby_name, lobby_password,
                created_at, updated_at)  unique (lcu_party_id) where status in (open, balanced, in_game)
lobby_members  (lobby_id, player_id, side null, role null, role_override null, is_spectator, created_at)
splits         (id, lobby_id, rank, blue jsonb, red jsonb, gap, blue_win_prob, score, off_role_count,
                is_chosen, explanation, roster_key, created_at)
games          (id, lcu_game_id unique, lobby_id null, season_id, started_at, duration_s, winning_side,
                source 'eog' | 'backfill', raw jsonb, created_at)
game_players   (game_id, player_id, side, role null, champion_id, kills, deaths, assists, gold, damage_to_champs,
                cs, mu_before null, sigma_before null, mu_after null, sigma_after null)
companion_tokens (id, player_id, token_hash, label, last_seen_at, revoked_at null, created_at)
companion_commands (id, target_player_id, kind, payload jsonb, status, created_at, acked_at)
discord_config (guild_id pk, webhook_url, results_channel_id, lobby_voice_channel_id,
                blue_voice_channel_id, red_voice_channel_id, created_at, updated_at)

players_public view (players minus discord_id; keeps is_admin)
```

Also in the schema:

- **Enums, not check constraints**, for the string unions: `lobby_status`, `player_role`, `game_source`,
  `companion_command_kind` (`create_lobby`, `invite`, `switch_side`), `companion_command_status` (`pending`,
  `sent`, `acked`, `failed`). The generated types then carry the same unions `packages/core` declares. `side`
  stays a smallint with a check, because 100 and 200 are the client's numbers, not a vocabulary of ours.
- **Season 1** is inserted by `0001_init.sql`, active, with the fixed id `00000000-0000-0000-0000-000000000001`
  (exported as `SEASON_ONE_ID`), so ratings and games always have a season to hang off.
- **Functions.** `active_season_id()` (the default for `games.season_id`), `bootstrap_admin(puuid)` (idempotent
  insert-or-promote, service role only, called by the API on start with `BOOTSTRAP_ADMIN_PUUID`), and
  `set_updated_at()` (the trigger behind every `updated_at`).
- **Realtime.** The `supabase_realtime` publication covers `lobbies`, `lobby_members`, `splits`, `games`,
  `game_players` and `ratings`. A table outside the publication never emits a change event, silently, and the
  tonight page (M3.4) and the bot (M4.4) are built on those events. `players` is left out; it is not publicly
  readable.

Rules:

- `players.puuid` is the identity. Riot IDs are display data refreshed from the client.
- **A `lobbies` row is one game cycle, not one party** (M2.14, `0003_lobby_cycles.sql`). The client keeps the
  same `partyId` all night, so `lcu_party_id` is unique only among `open`, `balanced` and `in_game` rows:
  a lobby post lands on the party's live row and starts a new one once the last cycle is `finished` or
  `abandoned`. A game post resolves to the newest row that already existed when the game started, so a late
  end-of-game block stays on the lobby it was played from. Closed rows are never rewritten or reused.
- A player row is created lazily the first time a PUUID appears in a lobby or a game. Discord linking is optional
  and done by an admin (`/admin/players`) or self-service via Discord OAuth.
- `ratings` is per season. A new season copies `mu` and resets `sigma` to the starting value. `ordinal` is a
  stored generated column so the leaderboard sorts in one index scan and SQL cannot disagree with
  `packages/core` about the formula; `packages/core` stays the only place that computes a rating.
- `games.raw` keeps the full end-of-game block, with `mucJwtDto` and `multiUserChatPassword` replaced by
  `"[redacted]"` (M2.10). Every derived column can be recomputed from it.
- `game_players` rating columns are nullable: the API inserts the game and its ten players, then rates, and a
  rebuild (M5.2) overwrites them.
- `splits` keeps the top three for every balance run so the explanation and reroll are reproducible. A rebalance
  appends a new set of three rather than replacing the old one, and a partial unique index allows at most one
  `is_chosen` split per lobby. `explanation` is the string core built; the embed and the tonight page render it,
  they never recompute it.
- `splits.roster_key` is the ten puuids of that split, sorted and joined with `,`. The API computes it with
  `rosterKey()` from `@customs/db` when it stores a split, and the `lastSplit` lookup is the newest chosen split
  with the same `roster_key` — one indexed lookup instead of a jsonb set comparison.
- A companion token is revoked by setting `companion_tokens.revoked_at`, never by deleting the row: the auth path
  filters on it and `last_seen_at` stays as the audit trail of a token that may have leaked.

## Rating model (`packages/core/rating`)

OpenSkill, default Plackett-Luce model, two teams of five.

- Seed `mu` from the player's ranked tier at first sight:
  Iron 14, Bronze 17, Silver 20, Gold 23, Platinum 26, Emerald 29, Diamond 32, Master and above 35.
  Add 0.75 per division above IV. Unranked: 20.
- Seed `sigma` to 8.33 (OpenSkill default) so the first few games move fast. Unranked: 10.
- Rating movement is driven by uncertainty, not by rank: OpenSkill moves a player's `mu` in proportion to that
  player's own `sigma^2`, so a settled player's rating is sticky and a new player's moves fast. Rank does not
  affect the size of a win — two players with the same sigma on the same winning team gain exactly the same amount.
- Balance on `mu`. Leaderboard sorts on `ordinal = mu - 2 * sigma`. Display rating is `round(mu * 60)`.
- After each game call `rate([blueTeam, redTeam], { rank: [winnerRank...] })`. Store before and after on
  `game_players`. Ratings are a pure fold over games ordered by `started_at`, so they can be rebuilt from scratch
  after a backfill or a model change (`pnpm --filter web rebuild-ratings`).

## Balancer (`packages/core/balance`)

Input: ten players with `{ mu, mainRole, secondaryRole, roleOverride? }`, optional duo locks, the previous night's
split. Output: top three splits with role assignments and explanation.

- Effective skill on a role: `mu * 1.00` main, `mu * 0.93` secondary, `mu * 0.85` fill. A `roleOverride` for
  tonight counts as main for that role only.
- Enumerate all 126 distinct 5/5 partitions. For each team, choose the role assignment (120 permutations) that
  maximizes effective skill minus off-role penalty. 126 x 2 x 120 evaluations, well under 100 ms.
- `score = |sum(blueEff) - sum(redEff)| + 120 * offRoleCount + 200 * isRepeatOfLastSplit + inf * duoSeparated`
  (in display-rating units, so divide `mu` sums by 1/60 or apply the weights in `mu` units, either is fine as long
  as tests pin it).
- `blueWinProb` from OpenSkill `predictWin` on the actual `{ mu, sigma }` values.
- Explanation string is built in core. Split 1 of the worked example (`00-product.md`, full arithmetic in
  `02-milestones.md` M1.4) reads: `"Blue favored 54%. Everyone on a main role. Gap 100. Next best: swap Hana and
  Omar, gap 170."` The "swap" line is derived by diffing split 1 and split 2.
- Reroll returns split 2, then 3. Never random.
- Fewer than ten or more than ten players is an error at this layer; the API decides who sits (see below).

## Lobby lifecycle (server side)

```
open ---(10 stable members reported)---> balanced ---(gameflow InProgress)---> in_game ---(eog captured)---> finished
  \                                          |
   \---(members change)---> open <-----------+ (rebalance, previous split kept as history)
   \---(lobby dissolved / 2h idle)---> abandoned
```

- The companion posts the full member list every time it changes. The API debounces: a lobby is balanced when
  ten non-spectator members are unchanged for 10 seconds.
- A companion may only post a lobby it is in (see "Security"), and the member list is frozen from `in_game` on
  and stays frozen in `finished`: a later post for that party is still accepted and still refreshes the lobby's
  name and password, but no member row is added, changed or removed and the response says `rosterFrozen: true`.
  Once the game has started a player's side comes from `game_players`, not from `lobby_members`.
- `open`, `balanced` and `abandoned` keep the replace semantics — the posted list is the roster, deletions
  included — because a lobby that dissolves without ever starting has no history worth keeping.
- Sit-outs: if more than ten people are "around" (in the lobby as spectators, or in the lobby voice channel
  once M4 exists), the API posts who should sit based on the fewest games tonight, then oldest sit-out.
- The `lastSplit` passed to the balancer is the five puuids on one side of the most recent chosen split whose
  lobby had the same ten players as tonight's; if there is no such split, `lastSplit` is null.
- Discord posting happens from the API on state transitions, through the webhook stored in `discord_config`.

## Companion (`apps/companion`)

Long-running process. State machine:

```
disconnected --(lockfile found)--> connected --(ws open)--> watching
watching: on lobby event -> POST /api/companion/lobby
          on gameflow InProgress -> mark lobby in_game
          on gameflow EndOfGame -> GET eog-stats-block -> POST /api/companion/game
          every 6h -> POST /api/companion/rank for self; on lobby roster, for each unknown puuid
          every 5s -> GET /api/companion/commands -> execute (create lobby, invite, switch side) -> ack
```

- Config in `%APPDATA%/customs-night/config.json`: `{ apiBase, companionToken }`. First run prompts for a token
  minted on the web admin page.
- Reconnects forever with backoff. The client restarts between patches; the companion must not.
- Every LCU response is parsed with zod. Unknown shapes are logged with the endpoint and dropped.
- Logs to `%APPDATA%/customs-night/logs/` with daily rotation. Nothing else is written to disk.

## Web (`apps/web`)

- `/` Tonight: live lobby, teams, result. Public read. Realtime subscription on `lobbies`, `splits`, `games`.
- `/leaderboard` Season table by ordinal, wins, games, streak.
- `/p/[puuid]` Player page: rating history chart, role record, recent games.
- `/admin` Discord OAuth gated, `players.is_admin`. Link Discord IDs, set roles, mint companion tokens, set Discord config, start a season.
- `/api/companion/*` bearer token, zod-validated.
- `/api/admin/*` session-gated.

## Discord

- M3: webhook messages from the API. Teams embed, result embed, nightly leaderboard.
- M4: `apps/discord` bot. Subscribes to Supabase Realtime. On `lobbies.status -> balanced` moves members whose
  `discord_id` is known into blue/red voice. On `finished` moves everyone back to the lobby voice channel. Posts
  "N around" when lobby voice membership changes and no lobby is open. Hosted on Fly.io or Railway.

## Security

- Companion tokens are random 32 bytes, stored hashed, one per player, revocable from admin.
- The API never trusts a PUUID claim beyond what the companion reports; a companion can only report games and
  lobbies it was in. Both checks run before anything is written, so a refusal leaves no row behind.
  - Games: the token's player PUUID must appear among the participants of the posted game, or the API answers
    403. The companion's end-of-game payload is flattened and carries no `localPlayer`, so participation is the
    check. Backfill is the exception, and it is admin-approved the first time per player.
  - Lobbies: the token's player PUUID must appear in the posted `members` — `isSpectator: true` counts — or the
    caller must already be that lobby's `reported_by_player_id`, or the API answers 403. The posted list
    replaces the roster, so without this one stale companion could delete another lobby's members. The
    `reported_by_player_id` fallback is what lets the companion that owns the lobby post the "everyone left"
    empty list, which by definition cannot contain the caller.
- The end-of-game block carries the post-game chat room's credentials and `games` is public-read, so the API
  redacts `mucJwtDto` and `multiUserChatPassword` before the insert (`scrubRawEogBlock`, M2.10). The
  companion may redact them too; the server is the one that has to, because old companion binaries keep
  running for months.
- Supabase Row Level Security: public read on `seasons`, `ratings`, `lobbies`, `lobby_members`, `splits`, `games`
  and `game_players`, plus `players` through the `players_public` view. `companion_tokens`,
  `companion_commands` and `discord_config` have no read policy at all. Writes only through the service role
  used by the API.
- Public reads of players go through the `players_public` view, which is `players` without `discord_id` and with
  `is_admin` kept, so the tonight page can decide whether to draw the reroll button on the anon key. Anon and
  authenticated have no read privilege on the `players` table itself and get a 401 from it. The web app and the
  bot read `players_public`.

## Operational notes

- A League patch can break any LCU endpoint. `packages/lcu` has a `pnpm --filter lcu smoke` script that hits
  every endpoint we use against a running client and prints shape diffs. Run it after every patch Tuesday.
- Vercel free tier and Supabase free tier are enough. The bot needs a small always-on box (Fly.io free allowance).
- Backups: Supabase daily. `games.raw` makes everything else reproducible.
