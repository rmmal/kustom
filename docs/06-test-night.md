# M2 test night: the run sheet

The M2 acceptance line: *two people run the companion, play one custom, and the game appears once in `games`
with ten `game_players` rows and updated ratings. Kill one companion mid-game; the game still lands.* This is
the sequence that proves it and the evidence to paste back. Site: <https://kustom-delta.vercel.app>. Two
machines run companions all night: **A** = the Windows PC, **B** = the Mac running
`pnpm --filter companion dev` on a second League account. Everyone else just plays.

## What one night can and cannot prove

A custom with fewer than ten humans is **stored but never rated**: the fold needs ten participants, five a
side, over 300 seconds (`apps/web/README.md`, "the rating fold"). So the night has two parts. **Part 1, the
rehearsal, two of you**, proves capture, the freeze, dedupe, crash recovery and the mid-game kill; it cannot
prove ratings, and a rehearsal game landing with `mu_after` null is the gate working. **Part 2, ten humans**,
is the acceptance line itself: one `games` row, ten `game_players` rows, ratings move.

If ten humans cannot be gathered, **M2 stays open on "updated ratings"**: the only standing proof of the fold
is then `apps/web/app/api/companion/lobbyState.integration.test.ts` → "rates a real game once, however many
companions post it". Do not tick M2 on the rehearsal alone.

## Before the night (you)

1. **Vercel has every variable.** Everything in `.env.example`, plus `CUSTOMS_NIGHT_TZ=Africa/Cairo` and
   `CRON_SECRET`. Check `/api/health` answers, and that `/api/cron/sweep` with `authorization: Bearer
   $CRON_SECRET` answers `{ ok: true, abandoned: <n> }` — a 503 means the secret is not set on Vercel.
2. **A season is active.** `/admin` must name one, not say "No season is active". `games.season_id` is
   `not null default active_season_id()`, so with no active season **every game insert of the night fails**.
3. **Both player rows exist before you mint.** `/admin/tokens` mints against an existing player; there is no
   "add player". Yours is the bootstrap row. To make B's appear: open a lobby with both accounts in it, let
   A post it once, refresh `/admin/players`. Then **mint two tokens**, labelled (`windows pc`, `mac dev`),
   each shown once. Never paste a token into a thread.
4. **Windows (A).** M2.11's run sheet first (`git clone`, `pnpm install`, `smoke --diff`): a shape difference
   found with ten people waiting is the worst place to find it. Then the companion — `pnpm --filter companion
   dev`, or when M2.6 lands the exe from
   <https://ubwpmxujdzssfqfbrbej.supabase.co/storage/v1/object/public/releases/customs-night-latest.exe>.
   At the first-run prompt: `https://kustom-delta.vercel.app`, then A's token.
5. **Mac (B).** `pnpm --filter companion dev`, same address, B's token; config and logs live in
   `~/Library/Application Support/customs-night`.
6. **Free byproduct.** Run `record-ws` on the Mac during the Part 2 lobby: the `lobby-10.json` the M2 note asks for.

## Your friend's part (paste this to them)

> Tonight we are testing the bot that picks teams. Nothing for you to do beyond the usual: get in the custom
> lobby and play. Two of us run a little app that watches the League client — it only reads, it never clicks
> anything for you. Two small things: when a game ends, sit on the scoreboard about ten seconds before you
> click through, so the app can read it; and do not end a game by everyone quitting out, because the client
> writes down "no winner" for those and the bot throws them away. Surrender or knock the nexus down.

## Part 1: the rehearsal (two of you, about 40 minutes)

Both companions at `watching`. Two humans is enough for a custom; add bots if you like (the companion drops
them). Each game must pass **six minutes** before it ends.

**Game 1 — the crash recovery and the duplicate post (M2.3 checks 5 and 9).** Check 5 says "with the API
answering 500"; a dead origin is the same retryable path and the only one arrangeable against Vercel, and a
true 500 stays covered by the stubbed check 6.

1. Stop A. Edit `%APPDATA%\customs-night\config.json` and set `"apiBase": "http://127.0.0.1:9"`. Start A
   again; it logs `api not reachable now; calls will retry`. B stays pointed at the real site.
2. Open the lobby, both accounts in. B logs `lobby posted`. Play; end the game with a winner.
3. On A, wait for `end-of-game block captured`, then click past the scoreboard there so the client drops the
   block. Confirm `%APPDATA%\customs-night\queue\<gameId>.json` exists, then kill A hard:
   `taskkill /f /im node.exe` (or `/im CustomsNight.exe`).
4. B posts the game: `game posted ... created: true`. Put A's real `apiBase` back and start A: it replays the
   queue (`game posted ... created: false`) and `queue\` is empty. Start it once more — still empty, one game.

**Game 2 — kill one companion mid-game (the acceptance line, M2.3 check 8).**

5. Both companions reachable and at `watching`. Open a new lobby, play again.
6. At **five minutes in**, kill B on the Mac: `pkill -9 -f "companion"`.
7. Finish with a winner. A alone logs `end-of-game block captured` and `game posted ... created: true`. Start
   B again afterwards; it has nothing queued and posts nothing.

## Part 2: the ten-human game (the acceptance)

8. Ten people in one custom lobby, A and B among them, both at `watching`.
9. Watch A's console: `lobby posted` with `memberCount: 10` and `recheckInMs: 10000`, then a post ten seconds
   later with `status: "balanced"`. `ranksNeeded` is non-zero the first time anyone new appears and drops to
   `0` on a later post — rank sync closing itself out (M2.4 check 9).
10. Start the game. Both consoles log `game started`, `game start posted`, then `lobby posted` with
    `rosterFrozen: true` and `lobby roster is frozen on the server; posts no longer change it` (M2.5 check 6).
11. Play past five minutes, end with a winner, both companions up: both log `end-of-game block captured` with
    `participants: 10`, then `game posted` — **exactly one says `created: true`** (M2.3 check 9).

## After

On `/admin/players`, before you paste anything: ten rows carry a **Rating** and it has moved (the half of the
acceptance line the rehearsal cannot show); **Rank** and **Riot ID** are filled in for people nobody had seen
before tonight, and a **Name** you set by hand before the night is still the name you set (M2.4 check 9).
`/admin/tokens` shows a recent `last_seen_at` on both tokens. Then paste back, in the lead's thread:

1. **A's console from `customs night companion starting` through `watching`** (it carries the version,
   `configDir`, `logDir`, and `signed in as <name>`), and the same first lines from B.
2. Every `lobby posted` line of the Part 2 lobby — `status`, `memberCount`, `created`, `rosterFrozen`,
   `recheckInMs`, `ranksNeeded` — plus the `lobby roster is frozen` line.
3. Every `end-of-game block captured` and `game posted` line from both machines, all three games: `gameId`,
   `startedAtFrom`, `durationS`, `winningSide`, `participants`, `created`. That is "appears once with ten
   rows" in the companion's own words.
4. From game 1, the queue filename before the kill and the two `game posted` lines that followed; plus the
   League patch and anything `smoke --diff` reported on Windows.
5. **Never** a token, `config.json`, a lockfile password, or a log file nobody has read first.

The lead reads the row counts from the database: one `games` row per `lcu_game_id`; ten `game_players` rows
for the Part 2 game with all four rating columns non-null; ten `ratings` rows, `games` incremented and `wins`
on exactly five; three `splits` rows with one `is_chosen`; the Part 2 lobby `finished`.

## Pass or fail

| Acceptance check | Where it is proved | Evidence |
|---|---|---|
| The game appears **once** in `games` | Part 2 | one `game posted ... created: true`, one `created: false`; one `games` row |
| Ten `game_players` rows | Part 2 | `participants: 10` on both `end-of-game block captured` lines; ten rows |
| Updated ratings | Part 2 only | Rating moved on ten `/admin/players` rows; `mu_after` non-null |
| Kill one companion mid-game; the game still lands | Rehearsal game 2 | B killed at 5:00, A's `game posted ... created: true` |
| M2.3 check 9: two companions, one eog | Part 2 (and rehearsal game 1) | exactly one `created: true` |
| M2.3 check 5: crash and recovery | Rehearsal game 1 | queue file present, hard kill, replay, `queue/` empty twice |
| M2.4 check 9: names, ranks, `ranksNeeded` | Part 2 | Rank and Riot ID filled; an admin-set Name untouched; `ranksNeeded: 0` on a later post |
| M2.5: the roster freeze | Part 2 | `rosterFrozen: true` with the full member count |

A rehearsal-only night passes every row except "updated ratings", and M2 is then **partial**, not done.
