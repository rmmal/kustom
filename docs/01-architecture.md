# Architecture

## Components

```
+----------------------+        HTTPS (bearer token)        +---------------------------+
| Companion (Windows)  | --------------------------------> | apps/web on Vercel        |
|  packages/lcu        |   POST /api/companion/lobby        |  Next.js route handlers   |
|  lobby watcher       |   POST /api/companion/game         |  packages/core (balance,  |
|  eog capture         |   POST /api/companion/rank         |    rating)                |
|  rank sync           |   GET  /api/companion/commands     |  Supabase client          |
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

Postgres, managed by Supabase migrations in `packages/db/supabase/migrations/`.

```sql
seasons        (id, name, starts_at, ends_at, is_active)
players        (id, puuid unique, summoner_id, game_name, tag_line, display_name,
                discord_id null, is_admin, main_role, secondary_role,
                rank_tier, rank_division, rank_lp, rank_updated_at, created_at)
ratings        (player_id, season_id, mu, sigma, games, wins, updated_at)  pk (player_id, season_id)
lobbies        (id, lcu_party_id unique, status, reported_by_player_id, lobby_name, lobby_password,
                created_at, updated_at)
lobby_members  (lobby_id, player_id, side null, role null, role_override null, is_spectator)
splits         (id, lobby_id, rank, blue jsonb, red jsonb, gap, blue_win_prob, score, off_role_count, is_chosen)
games          (id, lcu_game_id unique, lobby_id null, season_id, started_at, duration_s, winning_side,
                source 'eog' | 'backfill', raw jsonb)
game_players   (game_id, player_id, side, role null, champion_id, kills, deaths, assists, gold, damage_to_champs,
                cs, mu_before, sigma_before, mu_after, sigma_after)
companion_tokens (id, player_id, token_hash, label, last_seen_at, created_at)
companion_commands (id, target_player_id, kind, payload jsonb, status, created_at, acked_at)
discord_config (guild_id pk, webhook_url, results_channel_id, lobby_voice_channel_id,
                blue_voice_channel_id, red_voice_channel_id)
```

Rules:

- `players.puuid` is the identity. Riot IDs are display data refreshed from the client.
- A player row is created lazily the first time a PUUID appears in a lobby or a game. Discord linking is optional
  and done by an admin (`/admin/players`) or self-service via Discord OAuth.
- `ratings` is per season. A new season copies `mu` and resets `sigma` to the starting value.
- `games.raw` keeps the full end-of-game block. Every derived column can be recomputed from it.
- `splits` keeps the top three for every balanced lobby so the explanation and reroll are reproducible.

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
- The API never trusts a PUUID claim beyond what the companion reports; a companion can only report games it was
  in (the eog block's `localPlayer` must match the token's player) except for backfill, which is admin-approved
  the first time per player.
- Supabase Row Level Security: public read on players (minus discord_id), ratings, games, game_players, splits,
  lobbies. Writes only through the service role used by the API.

## Operational notes

- A League patch can break any LCU endpoint. `packages/lcu` has a `pnpm --filter lcu smoke` script that hits
  every endpoint we use against a running client and prints shape diffs. Run it after every patch Tuesday.
- Vercel free tier and Supabase free tier are enough. The bot needs a small always-on box (Fly.io free allowance).
- Backups: Supabase daily. `games.raw` makes everything else reproducible.
