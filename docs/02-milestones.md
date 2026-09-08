# Milestones

Build order. Each milestone ships something a player can see. Tasks are sized for one agent session each.
Acceptance criteria are what an implementing agent must demonstrate before marking a task done.

## Status

| Milestone | Status | Notes |
|---|---|---|
| M0 Spike: verify the client | in progress | M0.1 done. M0.2 needs the user to run the client (see M0.1 OPEN steps in packages/lcu/README.md). Blocks M2. |
| M1 Foundation | in progress | All six tasks done; awaiting product and designer acceptance pass. Hosted Supabase project and Discord OAuth app not yet created. Can run in parallel with M0. |
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

- [x] **M0.1** `packages/lcu` skeleton: lockfile discovery, basic-auth HTTPS client, WebSocket subscriber, a `smoke` script that hits each endpoint in the reference and writes the raw JSON to `packages/lcu/fixtures/<patch>/<endpoint>.json`.
- [ ] **M0.2** Run the smoke script through a full custom game: open lobby, fill it (even with two people and eight empty slots is enough for shapes), play or remake, reach end of game. Capture the WS event stream to a file.
- [ ] **M0.3** Answer the eight questions in "Behaviors to confirm" in `03-lcu-reference.md`. Update every status column. Write zod schemas for the endpoints we keep, tested against the fixtures.
- [ ] **M0.4** If custom games do not appear in match history, record it in `04-decisions.md` and remove backfill from M5; the end-of-game path is then the only source and the companion rule ("lobby owner runs it") becomes mandatory in the product doc.

Acceptance: `pnpm --filter lcu test` passes against fixtures; the reference doc has no `unverified` rows for lobby, gameflow, eog, current-summoner, ranked-stats.

## M1 Foundation (2 to 3 days)

Goal: the monorepo, the database, and the pure core with tests. No client needed.

- [x] **M1.1** Monorepo: pnpm workspaces, TypeScript project references (dropped, see decisions 2026-09-08: source-shipping packages, `tsc --noEmit`), Biome, vitest, `apps/web` (Next.js App Router), `packages/core`, `packages/db`, `packages/lcu` (from M0 or a stub). Root scripts listed in `CLAUDE.md` all exist.
- [x] **M1.2** Supabase project, migration `0001_init.sql` with the schema in `01-architecture.md`, RLS policies, generated types, `pnpm db:migrate` and `pnpm db:types`.
- [x] **M1.3** `packages/core/rating`: seed from tier, `rateGame`, `ordinal`, `displayRating`, `predictWin`. Tests: seeds match the table; a Bronze on the winning side gains more than a Master beside them; ten games converge a mis-seeded player.

    > **Brief (product, 2026-09-08)**
    >
    > **Seed table, divisions spelled out.** Seed `mu` from `players.rank_tier` + `players.rank_division` at
    > first sight. Division IV is the tier base; add 0.75 per division above IV.
    >
    > | Tier | IV | III | II | I |
    > |---|---|---|---|---|
    > | Iron | 14.00 | 14.75 | 15.50 | 16.25 |
    > | Bronze | 17.00 | 17.75 | 18.50 | 19.25 |
    > | Silver | 20.00 | 20.75 | 21.50 | 22.25 |
    > | Gold | 23.00 | 23.75 | 24.50 | 25.25 |
    > | Platinum | 26.00 | 26.75 | 27.50 | 28.25 |
    > | Emerald | 29.00 | 29.75 | 30.50 | 31.25 |
    > | Diamond | 32.00 | 32.75 | 33.50 | 34.25 |
    >
    > Master, Grandmaster and Challenger are all 35.00 with **no division bonus** (they have no divisions; if the
    > client reports one, ignore it). Unranked, or any tier string we do not recognise, is 20.00.
    >
    > **Seed sigma.** 8.33 for any ranked seed. 10.00 for unranked/unknown. Nothing else.
    >
    > **Functions.**
    > - `seedFromRank(tier, division) -> { mu, sigma }`. Pure lookup, no clamping, no rounding.
    > - `rateGame(blue, red, winningSide) -> { blue, red }` where `blue`/`red` are five `{ mu, sigma }` in input
    >   order and `winningSide` is `100` or `200`. Returns new ratings in the same order. **There is no draw
    >   path** — a League custom cannot draw, and a remake is not a game (the API drops it before this call).
    > - `ordinal({ mu, sigma }) -> mu - 2 * sigma`.
    > - `displayRating(mu) -> Math.round(mu * 60)`.
    > - `predictWin(blue, red) -> number`. **Blue's probability first**, a single number in `[0, 1]`. Red's is
    >   `1 - it`. Takes the real `{ mu, sigma }`, never the role-adjusted effective skill.
    >
    > **Tests, exactly.**
    >
    > 1. *Seeds match the table.* Every cell above, plus Master/GM/Challenger = 35.00, plus unranked = 20.00 with
    >    sigma 10.00, plus a garbage tier string = 20.00 with sigma 10.00.
    > 2. *A Bronze on the winning side gains more than a Master beside them.* This only holds when their sigmas
    >    differ — OpenSkill moves `mu` in proportion to the player's own `sigma^2`, not their rank, so two
    >    players with the same sigma on the same winning team gain the identical amount. Pin the setup:
    >    the Bronze II is freshly seeded (`mu 18.50, sigma 8.33`), the Master is settled (`mu 35.00, sigma 3.50`),
    >    they are on the same team with three `mu 25.00, sigma 5.00` teammates, the other five are all
    >    `mu 25.00, sigma 5.00`, and their side wins. Assert `muAfter - muBefore` is strictly larger for the
    >    Bronze. Do not "fix" this by giving them equal sigmas and asserting something weaker.
    > 3. *Ten games converge a mis-seeded player.* Setup: `P0` seeded Iron IV (`mu 14.00, sigma 8.33`), plus ten
    >    other players, all settled Gold IV (`mu 23.00, sigma 3.50`). That is eleven people in the room, so
    >    exactly one of the ten others sits out each game — same as a real night with eleven around. Ten games;
    >    in game `k` (0-indexed), `P0`'s team is `P0` plus players `1 + (k % 10)`, `1 + ((k+1) % 10)`,
    >    `1 + ((k+2) % 10)`, `1 + ((k+3) % 10)` (wrapping, skipping `P0`), the next five in the same wrap
    >    (`1 + ((k+4) % 10)` through `1 + ((k+8) % 10)`) are the opponents, the one left over sits, and `P0`'s
    >    side wins every time. Assert all three, with the numbers below pinned exactly (measured against
    >    `openskill` 5.0.1, M1.3):
    >    - `mu(P0)` strictly increases after every game;
    >    - `sigma(P0)` strictly decreases after every game. It is `6.4704` after game 10 and **first drops below
    >      5.00 in game 36 of this setup** (26 games if the wins alternate between the sides instead of `P0`'s
    >      side winning every one). Ten games settle a mis-seeded player's `mu`, not their `sigma`.
    >    - `mu(P0)` crosses 23.00 — the Gold IV seed — in game 4, and is `34.09` after game 10.
    >
    >    These are the model's real behaviour, not targets. If one of them fails against the `openskill`
    >    package, **do not lower the number.** Record the game count it actually takes, report it to the lead as
    >    a finding, and leave the test failing or skipped with the real number in a comment — "how many games a
    >    smurf distorts teams for" is a product fact we want to know, not a test to tune.
    >
    > **Out of scope for M1.3.** Season resets (M5.3), the rating-rebuild fold (M5.2), any database or API call,
    > and anything that reads the clock. `rateGame` is a pure function of its arguments.

- [x] **M1.4** `packages/core/balance`: partition enumeration, role assignment, scoring, top three, explanation string, reroll. Tests: the worked example from the product vision (ten named players with ranks) yields a gap of 100 with everyone on a main role; duo lock is respected; repeat-split penalty changes the choice; nine or eleven players throws.

    > **Brief (product, 2026-09-08)**
    >
    > ### What a player sees
    >
    > Ten friends are in a custom lobby. Nobody typed anything. Within a few seconds Discord shows two teams of
    > five, each with a role next to the name, a win chance, a gap number, and one line saying what the next
    > best teams would have been. If someone shouts "rigged", an admin taps reroll and the second-best split
    > goes up instead. That is the whole feature. `packages/core/balance` is the part that turns ten players
    > into those three splits and those three sentences. It touches nothing else.
    >
    > ### Input
    >
    > `balance(input)` where `input` is:
    >
    > - `players` — exactly ten. Each: `puuid` (string, the identity), `name` (string, `players.display_name`,
    >   used only in the explanation), `mu` (number), `sigma` (number), `mainRole` (role or `null`),
    >   `secondaryRole` (role or `null`), `roleOverride` (role or absent).
    > - `duos` — array of `[puuidA, puuidB]` pairs that must land on the same team. May be empty. May be absent.
    > - `lastSplit` — the five puuids that were on **one** side of the last chosen split for this group, or
    >   `null`. Side colour is not part of it.
    >
    > Roles are `'top' | 'jungle' | 'mid' | 'adc' | 'support'`.
    >
    > ### Output
    >
    > `{ splits, explanations }` — `splits` is one to three entries, best first. Each split:
    >
    > - `blue` — five `{ puuid, role }`, `red` — five `{ puuid, role }`
    > - `gap` — integer, display-rating units (see "Numbers" below)
    > - `blueWinProb` — number in `[0, 1]`, blue's chance
    > - `score` — number, unrounded, the value that ordered the list
    > - `offRoleCount` — integer, 0 to 10
    >
    > `explanations[i]` is the sentence for `splits[i]`. Store all three in the `splits` table so reroll and the
    > tonight page never recompute.
    >
    > ### Numbers, stated once so the tests can pin them
    >
    > - Effective skill of a player on a role, in **display units**: `mu * multiplier * 60`, multiplier `1.00`
    >   main, `0.93` secondary, `0.85` anything else.
    > - Per team, pick the role assignment (all 120 permutations) that maximises
    >   `sum(effective) - 120 * offRoleCount(thisTeam)`.
    > - `rawGap = |sum(blueEffective) - sum(redEffective)|`, unrounded, display units.
    > - `score = rawGap + 120 * offRoleCount + 200 * isRepeatOfLastSplit`. A split that separates a duo is not
    >   scored at all — it is never generated.
    > - `gap = Math.round(rawGap)`. Rounding happens once, for display only.
    > - `blueWinProb = predictWin(blue, red)` on the real `{ mu, sigma }`, never on effective skill.
    > - **Enumeration and side colour.** Sort the ten players by `puuid` ascending first, so the same ten in any
    >   order give byte-identical output. Then enumerate the 126 partitions as: player `[0]` is always on blue,
    >   choose four of the remaining nine to join them. That fixes which side is blue without any other rule,
    >   and lets red be the favoured side when the numbers say so.
    > - **Ties.** Lower `score` wins; then lower `offRoleCount`; then the lexicographically smaller sorted list
    >   of blue puuids. Deterministic, no randomness anywhere in this package.
    >
    > ### Role edge cases
    >
    > - `mainRole: null` (a friend nobody has set up yet) means **flexible**: every role is a main for them,
    >   multiplier `1.00`, never counted off-role. A new face must never make the night worse.
    > - `mainRole` set, `secondaryRole: null`: every non-main role is `0.85` and off-role.
    > - `roleOverride` present: **the override becomes the main; the usual main becomes the secondary; the
    >   declared secondary drops to `0.85`.** One line to explain to a friend — "the role you tapped is your
    >   role tonight, your usual role is your backup" — and it never punishes someone for their real strength.
    > - `roleOverride` equal to the existing main is a no-op.
    >
    > ### Duos
    >
    > A duo is two puuids that must be on the same team. Colour does not matter. Build connected components
    > with union-find (`[A,B]` and `[B,C]` means A, B and C are one block), then keep only the partitions where
    > every block sits entirely on one side. Everything else is discarded before scoring — there is no
    > "infinite penalty" number in the code, just a filter.
    >
    > If no partition survives — a block larger than five, or blocks whose sizes cannot be packed into 5 and 5,
    > for example sizes `4, 4, 2` — throw `BalanceError('Duo locks cannot fit five and five: <names of each
    > block>')`. Do not silently drop a duo. The API turns this into a Discord line the group can act on.
    >
    > ### Repeat-split penalty
    >
    > "Same as last night" means **the same five people together**, regardless of side colour. A split is a
    > repeat if `set(blue) === lastSplit` or `set(red) === lastSplit`. Penalty `200` display points, added once.
    >
    > Tiny scenario that flips the choice, using the worked example below: pass
    > `lastSplit = [Hana, Iris, Karim, Bilal, Theo]`. Split 1 now scores `99.6 + 200 = 299.6` and falls to
    > fourth. The chosen split becomes the old split 2 (gap 170), then the old split 3 (gap 220), then an
    > off-role split scoring 244.92. That is the whole test.
    >
    > ### Explanation string
    >
    > One line, clauses joined by a single space, each clause ending in a full stop. Numerals throughout.
    >
    > 1. **Win chance.** `p = Math.round(blueWinProb * 100)`. If `p > 50`: `Blue favored {p}%.` If `p < 50`:
    >    `Red favored {100 - p}%.` If `p === 50`: `Even 50%.`
    > 2. **Roles.** If `offRoleCount === 0`: `Everyone on a main role.` If `1`: `{Name} off-role at {role}.`
    >    If `2` or more: `{n} off-role: {Name} at {role}, {Name} at {role}.` — blue's players first, then red's,
    >    each side in role order top, jungle, mid, adc, support.
    > 3. **Gap.** `Gap {gap}.`
    > 4. **Next best.** Compare this split with the next one in the stored list. Align them first: take
    >    whichever of the next split's two sides overlaps this split's blue more. Let `k` be the number of
    >    players who move.
    >    - `k === 1`: `Next best: swap {name leaving blue} and {name joining blue}, gap {gap}.`
    >    - `k >= 2`: `Next best: {k} swaps, gap {gap}.`
    >    - If the next split has a different `offRoleCount`, append it before the full stop:
    >      `..., gap {gap} with {n} off-role.` (The next best can have a smaller gap and still be worse,
    >      because off-role costs 120 a head. Saying so is the point of the line.)
    >    - If there is no next split — this is the last of the three, or duo locks left only one — omit
    >      clause 4 entirely. No "no alternatives" filler.
    >
    > Names come from `name` as given. Core does not deduplicate identical names.
    >
    > ### The worked example
    >
    > Also in `00-product.md` under "Worked example". Ten friends, a few weeks into the season, so `mu` has
    > drifted off the seed. Puuids are `puuid-<lowercase name>`, which makes the sort order alphabetical and
    > puts Bilal at index 0, hence on blue.
    >
    > | Name | Rank | Seed mu | Current mu | sigma | Display | Main | Secondary |
    > |---|---|---|---|---|---|---|---|
    > | Bilal | Platinum I | 28.25 | 28.55 | 4.80 | 1713 | adc | mid |
    > | Hana | Gold III | 23.75 | 23.90 | 4.60 | 1434 | top | mid |
    > | Iris | Platinum IV | 26.00 | 26.30 | 4.90 | 1578 | jungle | top |
    > | Karim | Gold I | 25.25 | 25.85 | 4.70 | 1551 | mid | adc |
    > | Lena | Master | 35.00 | 34.80 | 4.50 | 2088 | adc | jungle |
    > | Nadia | Silver III | 20.75 | 21.10 | 5.10 | 1266 | mid | support |
    > | Omar | Gold II | 24.50 | 24.49 | 4.60 | 1469 | top | support |
    > | Rami | Platinum III | 26.75 | 27.30 | 4.80 | 1638 | jungle | mid |
    > | Theo | Gold III | 23.75 | 23.65 | 4.90 | 1419 | support | adc |
    > | Yuki | Bronze II | 18.50 | 18.90 | 5.00 | 1134 | support | top |
    >
    > Two mains per role, no duos, no overrides, `lastSplit: null`.
    >
    > **Split 1** (chosen). Gap **100**, everyone on a main role.
    >
    > | | Blue | Red |
    > |---|---|---|
    > | top | Hana | Omar |
    > | jungle | Iris | Rami |
    > | mid | Karim | Nadia |
    > | adc | Bilal | Lena |
    > | support | Theo | Yuki |
    >
    > Blue mu sum `128.25`, red `126.59`, difference `1.66`. In display units `1.66 * 60 = 99.6`, and
    > `Math.round(99.6) = 100`. `offRoleCount 0`, so `score = 99.6`.
    >
    > **Split 2.** Swap Hana and Omar. Gap **170** (`2.84 * 60 = 170.4`), everyone still on a main role,
    > `score = 170.4`.
    >
    > **Split 3.** Split 1 with both the top pair and the jungle pair swapped: blue Hana, Rami, Karim, Bilal,
    > Theo. Gap **220** (`3.66 * 60 = 219.6`), everyone on a main role, `score = 219.6`.
    >
    > The next best split after those three is off-role and scores `244.92`, so the top three are stable: any
    > split with someone off-role costs at least `240` before its gap is counted, and all three of these are
    > below that. The roster was built that way on purpose — the test must not depend on a coin-flip between an
    > off-role split and an all-main one.
    >
    > **Expected explanations**, in order:
    >
    > ```
    > Blue favored 54%. Everyone on a main role. Gap 100. Next best: swap Hana and Omar, gap 170.
    > Blue favored 57%. Everyone on a main role. Gap 170. Next best: 2 swaps, gap 220.
    > Blue favored 59%. Everyone on a main role. Gap 220.
    > ```
    >
    > The percentages are the only figures here that come out of the `openskill` package rather than our own
    > arithmetic. They were computed as `Phi(dMu / sqrt(2 * beta^2 + sum of all ten sigma^2))` with
    > `beta = 25/6` and `sum(sigma^2) = 229.77`, giving `0.5406`, `0.5693`, `0.5890`. Each sits at least
    > 0.004 away from a rounding boundary, so a small implementation difference will not move the printed
    > number. Verify against the real package before pinning. If it disagrees, pin what the package returns,
    > update this brief and `00-product.md`, and add a row to `04-decisions.md` — do not adjust the roster.
    >
    > Note: `01-architecture.md` used to illustrate the format with a string ending "gap 300", written before
    > this roster existed. It now carries split 1's string above verbatim. If the real `openskill` package moves
    > a percentage, update both places together.
    >
    > ### Errors
    >
    > All throw `BalanceError` with a message a human can read:
    >
    > - `players.length !== 10` — "Balancing needs exactly ten players, got 9." Nine and eleven both throw.
    >   Deciding who sits is the API's job, not ours.
    > - Duplicate `puuid` in `players` — "Duplicate player: <puuid>."
    > - A `duos` entry naming a puuid that is not in `players` — "Duo names someone not in the lobby: <puuid>."
    > - A `duos` entry naming the same puuid twice.
    > - Duo locks with no legal partition, as above.
    > - `lastSplit` that is not five puuids drawn from `players` — throw rather than ignore; a bad `lastSplit`
    >   silently ignored means the repeat penalty quietly stops working and nobody notices for a month.
    >
    > ### Reroll
    >
    > `nextSplit(splits, currentIndex) -> number`. Returns `currentIndex + 1` while one exists; throws
    > `BalanceError('No more splits. Rebalance or play these.')` at the end of the list. It never reshuffles,
    > never randomises, and never calls `balance` again. Two people pressing reroll twice get the same third
    > split, not a new one.
    >
    > ### Tests, exactly
    >
    > 1. The worked example returns three splits with gaps `100`, `170`, `220`, all with `offRoleCount 0`, the
    >    exact rosters and roles in the tables above, and the three explanation strings verbatim.
    > 2. Feeding the same ten players in a shuffled order returns identical output, field for field.
    > 3. `duos: [[Hana, Lena]]` — every returned split has Hana and Lena on the same side, and split 1 is the
    >    base split 2 (blue Omar, Iris, Karim, Bilal, Theo; gap 170, `offRoleCount 0`).
    > 4. `duos: [[Hana, Omar]]` — the two top mains locked together. Split 1 has gap 26 with `offRoleCount 2`
    >    (Hana at mid, Nadia at top). Assert only split 1; splits 2 and 3 tie on score here and are settled by
    >    the tie-break, which is not worth pinning.
    > 5. Duo locks that cannot fit: blocks of 4, 4 and 2 throw, and the message names the blocks.
    > 6. `lastSplit = [Hana, Iris, Karim, Bilal, Theo]` — split 1 becomes the base split 2 (gap 170). Passing
    >    the red five of the base split 1 instead produces the same result, proving side colour is ignored.
    > 7. `roleOverride: top` on Yuki — split 1 has gap 98 and `offRoleCount 1`, Yuki at top on red, Omar at
    >    support on blue, and the explanation reads
    >    `Blue favored 58%. Omar off-role at support. Gap 98. Next best: 2 swaps, gap 4 with 2 off-role.`
    > 8. Nine players throws. Eleven players throws. Duplicate puuids throw.
    > 9. A player with `mainRole: null` is never counted in `offRoleCount` and can be placed in any role.
    > 10. `nextSplit` walks 0 to 1 to 2 and then throws.
    > 11. Performance: balancing ten players stays under 100 ms on a laptop. One `expect` on elapsed time is
    >     enough; this runs on a Vercel function while ten people wait.
    >
    > ### Out of scope for M1.4
    >
    > - **Who sits out.** More than ten people around is the API's problem (M2.5, sit-out logic). Core sees ten
    >   or throws.
    > - **Someone leaves mid-lobby, the companion disconnects, a lobby goes stale.** All lobby-state machine,
    >   M2.5. Core has no memory between calls and no clock.
    > - **Unknown player.** Core handles a null `mainRole` and that is all it needs to know. Creating the row,
    >   fetching their rank, and seeding their rating is M1.5 and M2.4.
    > - Persistence of the three splits (`splits` table, M1.5/M3.1), Discord embed layout (M3.0/M3.1), the
    >   reroll button and route (M3.2), the tonight page (M3.4), and choosing `lastSplit` from history (M2.5).
    > - Tuning any constant. `1.00 / 0.93 / 0.85`, `120`, `200` and `* 60` are decided in `01-architecture.md`
    >   and `04-decisions.md`. Changing one is a decision row and a new task, not a commit.

- [x] **M1.5** `apps/web` API skeleton: companion token auth middleware, `POST /api/companion/lobby`, `POST /api/companion/game`, `POST /api/companion/rank`, all zod-validated, writing to Supabase with idempotency on `lcu_party_id` and `lcu_game_id`. Lazy player creation by PUUID.
- [x] **M1.6** `/admin`: Discord OAuth via Supabase Auth, `is_admin` gate. Pages to list players, set roles, link a Discord ID, mint and revoke companion tokens, edit `discord_config`, create a season. Seed the first admin by PUUID in a migration or env var. The role editor must be able to clear a main or secondary role back to null, not only change it — a null main means flexible (M1.4), and there has to be a way back to it.

Acceptance: `pnpm -r test` green; a curl with a valid token creates a lobby row and a game row; a second identical curl changes nothing.

## M2 Companion v1: roster and results (2 to 3 days, needs M0 and M1)

Goal: a friend runs one exe, and every lobby and game they are in lands in the database with no action.

- [ ] **M2.1** `apps/companion` CLI: config file, first-run token prompt, connection state machine with reconnect and backoff, structured logs with rotation.
- [ ] **M2.2** Lobby watcher: on every lobby WS event, POST the member list with sides and spectator flags. Debouncing lives on the server, not here.
- [ ] **M2.3** Game capture: on gameflow `InProgress` POST the game ID against the lobby; on `EndOfGame` fetch the eog block and POST it. Handle the case where the client reaches `EndOfGame` while the companion was reconnecting: on connect, if phase is `EndOfGame` or `WaitingForStats`, fetch and post.
- [ ] **M2.4** Rank sync: own rank on start and every 6 hours; rank for every unknown PUUID seen in a lobby, once, then weekly.
- [ ] **M2.5** Server: lobby state machine (open, balanced, in_game, finished, abandoned) with the 10-second stability rule; on eog, insert `games` and `game_players`, run `rateGame`, update `ratings`. Ignore eog blocks whose `gameType` is not `CUSTOM_GAME`.

    > **Note (product).** M1.5 already stores *every* `CUSTOM_GAME` eog block as a `games` row, remakes and
    > short surrenders with fewer than ten participants included, so M2.5 cannot assume only real games reach
    > it. Gate rating on the stored row: rate only when it has ten participants, five per side, and `durationS`
    > above 300 seconds (5 minutes); otherwise keep the row and leave `ratings` untouched. M2.5 records that
    > threshold in `04-decisions.md`. M2.3 may decide not to post remakes at all; the gate stands either way.

- [ ] **M2.6** Packaging: single Windows exe (Node single-executable application or `pkg`), `README` for friends with three steps: download, paste token, leave it running. Verify it survives a client restart and a PC sleep.

- [ ] **M2.7** `lastSplit` for the balancer: when a lobby reaches `balanced`, the API looks up the most recent chosen split (any night) whose lobby had exactly the same ten puuids as this lobby, and passes the five puuids of one of its sides as `lastSplit`. If no such split exists, it passes null. Never pass a split from a lobby with a different roster.

    > **Acceptance check (product).** With a stored chosen split for the same ten players, a new lobby with those
    > ten sends a `lastSplit` of exactly five puuids drawn from that stored split's blue or red side, and the
    > returned split 1 is not the repeat. Change one player in the lobby and `lastSplit` is null on the next
    > balance. With no history for these ten, `lastSplit` is null. Side colour of the stored split does not
    > change the result (M1.4 already treats it as colour-agnostic).

- [ ] **M2.8** Widen the game-ingest participant check so a spectator's companion is not locked out. `POST /api/companion/game` accepts an eog block when the token's player PUUID appears among the game's `participants` **or** is a member of the lobby with the same `lcu_party_id` as the posted game, `isSpectator` included. A token whose player is in neither list still gets a 403. Backfill's admin-approved exception is unchanged.

    > **Why (product).** `companionLobbyMemberSchema` carries `isSpectator`, so a friend who sits out a
    > round and runs the companion while watching is a real, normal case. Under the M1.5 rule their eog POST
    > is rejected, and if they are the only one running the companion that night the game is lost until
    > backfill (M5). This is not an M1.5 regression — the old `localPlayer` rule had the same hole — but it
    > should be decided behavior, not an accident. M2.8 records the widened rule in `04-decisions.md` and
    > updates the "Security" bullet in `01-architecture.md` the same session.

    > **Acceptance check (product).** Post an eog whose participants exclude the token's player but whose
    > lobby (same `lcu_party_id`) has that player as `isSpectator: true` — the game lands once with ten
    > `game_players` rows. A post from a token whose player is in neither list still 403s.

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
- [ ] **M3.7** Off-role clause end to end: the teams embed and the tonight page show the explanation line of whichever split is currently promoted, including after a reroll, with the off-role clause matching that split.

    > **Acceptance check (product).** Balance a lobby whose split 1 has `offRoleCount` 0 and whose split 2 has
    > someone off-role. The embed and the tonight page both read `Everyone on a main role.` Reroll to split 2:
    > both surfaces now read the split 2 sentence verbatim, naming the off-role player and their role
    > (`{Name} off-role at {role}.`, or `{n} off-role: ...` for two or more), and the roles rendered beside the
    > names match that split's assignment. Nothing recomputes the explanation — both surfaces render the stored
    > string for the promoted split from the `splits` table.

- [ ] **M3.8** Leaderboard says why a new player is low: a "still settling" marker and one plain sentence on `/leaderboard` and `/p/[puuid]` for players with fewer than 30 recorded games.

    > **Brief (product, 2026-09-08)**
    >
    > **Why.** The leaderboard sorts on `ordinal = mu - 2 * sigma`. A newly seeded player's `mu` settles in
    > about ten nightly games, but their `sigma` does not fall below 5.00 until roughly game 36 (M1.3 brief,
    > test 3). So a friend who joins tonight sits near the bottom of the board for about a month after they
    > have stopped being mis-rated, and the first person it happens to will call the board broken in voice.
    > This is the model working as intended; the board just has to say so.
    >
    > **Acceptance check (product).** On `/leaderboard` and `/p/[puuid]`, a player with fewer than 30 recorded
    > games shows a "still settling" marker next to their row and one plain sentence explaining the board is
    > cautious until it has seen you play; the marker disappears at 30 games; the number in the sentence
    > matches the game count in the M1.3 brief. Copy goes through product before it ships.
    >
    > **Out of scope.** Changing the sort, the rating model, or `ordinal`. No separate "new players" board, no
    > provisional/placement badge that hides a rating, no change to how teams are balanced — balancing is on
    > `mu` and is unaffected.

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
