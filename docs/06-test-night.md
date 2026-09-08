# M2 test night: the run sheet

The M2 acceptance line: *two people run the companion, play one custom, and the game appears once in `games`
with ten `game_players` rows and updated ratings. Kill one companion mid-game; the game still lands.* The
sequence that proves it, and the evidence to paste back. Site <https://kustom-delta.vercel.app>; **A** = the
Windows PC, **B** = the Mac on `pnpm --filter companion dev`.

## Two sessions, and M2 is ticked only after the second

A custom with fewer than ten humans is **stored but never rated**: the fold needs ten participants, five a
side, over 300 seconds (`apps/web/README.md`, "the rating fold"). So this is two evenings. **Session 1, the
rehearsal:** two people, two games, proving capture, the roster freeze, dedupe, the crash recovery and the
kill-one-companion-mid-game line — it cannot prove ratings, and a rehearsal game landing with `mu_after` null
is the gate working, not a failure. **Session 2, the ten-human night:** one `games` row, ten `game_players`
rows, ratings move. After Session 1, M2 is **partial**: the only standing proof of the fold is then
`apps/web/app/api/companion/lobbyState.integration.test.ts` → "rates a real game once, however many companions
post it". Do not tick M2 until Session 2 lands.

## Before Session 1 (you)

1. **Vercel has every variable.** Everything in `.env.example`, plus `CUSTOMS_NIGHT_TZ=Africa/Cairo` and
   `CRON_SECRET`. Check `/api/health` answers, and that `/api/cron/sweep` with `authorization: Bearer
   $CRON_SECRET` answers `{ ok: true, abandoned: <n> }` — a 503 means the secret is not set on Vercel.
2. **A season is active.** `/admin` must name one, not say "No season is active". `games.season_id` is
   `not null default active_season_id()`, so with no active season **every game insert of the night fails**.
3. **Whose League account is on the Mac.** Session 1 needs a second one in the lobby: your alt or the
   friend's, decided now rather than on the night.
4. **Both player rows exist before you mint.** `/admin/tokens` mints against an existing player — which is
   why the companion README tells a first-timer to join a lobby before asking for a token. Open a lobby with
   both accounts in it, let A post it once, refresh `/admin/players`, and B's PUUID is there. Then **mint two
   tokens**, labelled (`windows pc`, `mac dev`), shown once each. Never paste a token into a thread.
5. **Windows (A).** M2.11's run sheet first (`git clone`, `pnpm install`, `smoke --diff`): a shape difference
   found with ten people waiting is the worst place to find it. Then the companion — `pnpm --filter companion
   dev`, or when M2.6 lands the exe from
   <https://ubwpmxujdzssfqfbrbej.supabase.co/storage/v1/object/public/releases/latest/CustomsNight.exe> — and
   at the first-run prompt, `https://kustom-delta.vercel.app`, then A's token.
6. **Mac (B).** `pnpm --filter companion dev`, same address, B's token; config and logs in
   `~/Library/Application Support/customs-night`. Its League client must be signed in to the second account.
7. **Session 2 only.** Run `record-ws` on the Mac during the ten-human lobby: that is the `lobby-10.json` the
   M2 note asks for, and it blocks nothing.

## Your friend's part (paste this to them)

> Tonight we are testing the bot that picks teams. Nothing for you to do beyond the usual: get in the custom
> lobby and play. Two of us run a little app that watches the League client — it only reads, it never clicks
> anything for you. Two small things: when a game ends, sit on the scoreboard about ten seconds before you
> click through so the app can read it, and do not end a game by everyone quitting out — the client writes
> down "no winner" for those and the bot bins them. Surrender or knock the nexus down.

## Session 1: the rehearsal (two of you, about an hour)

Both companions at `watching`. Two humans is enough for a custom (add bots if you like — the companion drops
them), and each game must run past **six minutes**.

**Game 1 — the crash recovery and the duplicate post (M2.3 checks 5 and 9).** Check 5 is run with the API
unreachable: a dead origin in A's `apiBase` — a true 500 is covered by that task's stubbed check 6, same path.

1. Stop A, set `"apiBase": "http://127.0.0.1:9"` in `%APPDATA%\customs-night\config.json`, start A again: it
   logs `api not reachable now; calls will retry`. B stays pointed at the real site.
2. Open the lobby, both accounts in. B logs `lobby posted`. Play; end the game with a winner.
3. On A, wait for `end-of-game block captured`, then click past the scoreboard there so the client drops the
   block. Confirm `%APPDATA%\customs-night\queue\<gameId>.json` exists, then kill A hard:
   `taskkill /f /im node.exe` (or `/im CustomsNight.exe`).
4. B posts the game: `game posted ... created: true`. Put A's real `apiBase` back and start A: it replays the
   queue (`game posted ... created: false`) and `queue\` is empty. Start it once more — still empty, one game.

**Game 2 — kill one companion mid-game (the acceptance line, M2.3 check 8).** Both companions reachable and
at `watching`; open a new lobby and play.

5. At **five minutes in**, kill B on the Mac: `pkill -9 -f "companion"`.
6. Finish with a winner. A alone logs `end-of-game block captured` and `game posted ... created: true`. Start
   B again afterwards; it has nothing queued and posts nothing.

## Session 2: the ten-human night (the rating half of the acceptance)

1. Everything in "Before Session 1" still holds, plus `record-ws` on the Mac. Ten people in one custom lobby,
   A and B among them, both companions at `watching`.
2. Watch A's console: `lobby posted` with `memberCount: 10` and `recheckInMs: 10000`, then a post ten seconds
   later with `status: "balanced"`. `ranksNeeded` is non-zero the first time anyone new appears and drops to
   `0` on a later post — rank sync closing itself out (M2.4 check 9).
3. Start the game. Both consoles log `game started`, `game start posted`, then `lobby posted` with
   `rosterFrozen: true` and `lobby roster is frozen on the server; posts no longer change it` (M2.5 check 6).
4. Play past five minutes, end with a winner, both companions up: both log `end-of-game block captured` with
   `participants: 10`, then `game posted` — **exactly one says `created: true`** (M2.3 check 9).

## After each session, paste this back

**After both.** A's console from `customs night companion starting` through `watching` (version, `configDir`,
`logDir`, `signed in as <name>`), the same first lines from B, and every `end-of-game block captured` and
`game posted` line from both machines: `gameId`, `startedAtFrom`, `durationS`, `winningSide`, `participants`,
`created` — "appears once with ten rows" in the companion's own words. **Never** a token, `config.json`, a
lockfile password, or a log file nobody has read first.

**After Session 1 only.** The queue filename from game 1 before the kill, the two `game posted` lines that
followed, the League patch, and anything `smoke --diff` reported on Windows.

**After Session 2 only.** Every `lobby posted` line of the lobby — `status`, `memberCount`, `created`,
`rosterFrozen`, `recheckInMs`, `ranksNeeded` — plus the `lobby roster is frozen` line. And from
`/admin/players`: ten rows carry a **Rating** and it has moved, **Rank** and **Riot ID** are filled in for
people nobody had seen before, and a **Name** you set by hand is still the name you set (M2.4 check 9);
`/admin/tokens` shows a recent `last_seen_at` on both tokens.

The lead reads the row counts from the database: one `games` row per `lcu_game_id`; ten `game_players` rows for
the Session 2 game with every rating column non-null; ten `ratings` rows, `games` up by one and `wins` on
exactly five; three `splits` rows with one `is_chosen`; the Session 2 lobby `finished`.

## Pass or fail

| Acceptance check | Where it is proved | Evidence |
|---|---|---|
| The game appears **once** in `games` | Session 2 | one `game posted ... created: true`, one `created: false`; one `games` row |
| Ten `game_players` rows | Session 2 | `participants: 10` on both `end-of-game block captured` lines; ten rows |
| Updated ratings | Session 2 only | Rating moved on ten `/admin/players` rows; `mu_after` non-null |
| Kill one companion mid-game; the game still lands | Session 1, game 2 | B killed at 5:00, A's `game posted ... created: true` |
| M2.3 check 9: two companions, one eog | Session 2 (and Session 1, game 1) | exactly one `created: true` |
| M2.3 check 5: crash and recovery | Session 1, game 1 | queue file present, hard kill, replay, `queue/` empty twice |
| M2.4 check 9: names, ranks, `ranksNeeded` | Session 2 | Rank and Riot ID filled; an admin-set Name untouched; `ranksNeeded: 0` on a later post |
| M2.5: the roster freeze | Session 2 | `rosterFrozen: true` with the full member count |

Session 1 passes every row but "updated ratings": M2 is **partial** until Session 2 lands.
