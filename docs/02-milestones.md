# Milestones

Build order. Each milestone ships something a player can see. Tasks are sized for one agent session each.
Acceptance criteria are what an implementing agent must demonstrate before marking a task done.

## Status

| Milestone | Status | Notes |
|---|---|---|
| M0 Spike: verify the client | done | Verified on 16.17 (2026-09-08) with fixtures and schemas. Still open: switch-side path and invite body (M4), spectator shape (M2.13, needs a friend to click the spectator slot), Windows run (M2.11). |
| M1 Foundation | in progress | M1.1 to M1.6 and M1.8 done; product acceptance met; M1.7 ingest half done (admin field open), M1.9 and M1.10 open. Hosted Supabase project linked and migrated (0001, 0002); Discord OAuth app not yet created. Can run in parallel with M0. |
| M2 Companion v1: roster and results | in progress | M2.9 done early (roster freeze); M2.1 in flight; M2.10 (payload alignment) next, before M2.2/M2.3. |
| M3 Teams in Discord and on the web | not started | M3.0 design system done (docs/05-design.md). Needs M2. First night of real use. |
| M4 Lobby automation, voice split, presence | not started | Needs M3. |
| M5 Backfill, seasons, stats | not started | Needs M3. Independent of M4. |
| M6 Tray app and polish | not started | Needs M2 stable for a month. |

Update this table as tasks complete. Status values: `not started`, `in progress`, `blocked: <why>`, `done`.

---

## M0 Spike: verify the client (1 to 2 days, needs a Windows PC with League)

Goal: turn every `unverified` row we need for M2 in `03-lcu-reference.md` into `verified`, with fixtures.

Tasks:

- [x] **M0.1** `packages/lcu` skeleton: lockfile discovery, basic-auth HTTPS client, WebSocket subscriber, a `smoke` script that hits each endpoint in the reference and writes the raw JSON to `packages/lcu/fixtures/<patch>/<endpoint>.json`.
- [x] **M0.2** Run the smoke script through a full custom game: open lobby, fill it (even with two people and eight empty slots is enough for shapes), play or remake, reach end of game. Capture the WS event stream to a file.
- [x] **M0.3** Answer the eight questions in "Behaviors to confirm" in `03-lcu-reference.md`. Update every status column. Write zod schemas for the endpoints we keep, tested against the fixtures.
- [x] **M0.4** (resolved: custom games do appear in match history, 17 of 21 in the 16.17 capture; backfill stays in M5) If custom games do not appear in match history, record it in `04-decisions.md` and remove backfill from M5; the end-of-game path is then the only source and the companion rule ("lobby owner runs it") becomes mandatory in the product doc.

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
- [ ] **M1.7** Give every player a name a friend recognises. `players.display_name` is written nowhere today: `ensurePlayers` only fills `summoner_id`, `game_name` and `tag_line`, and `/admin/players` has no field for it, so every row lands with `display_name` null and stays that way. `/admin/players` shows `—` for every name, `/admin/tokens` shows an 8-character PUUID fragment, and M1.4's explanation string is built from `display_name` (M1.4 brief, "Input"), so the first Discord embed would read `Next best: swap  and , gap 170`. Fill `display_name` from the Riot `gameName` when a `players` row is created and when the client reports a changed `gameName`, and add a display-name field to the `/admin/players` row form so an admin can override it with what the group actually calls someone. An admin-set name is never overwritten by the client.

    > **Brief (product, 2026-09-08)**
    >
    > **What a player sees.** Their name, the one the group uses, in the teams post, on the tonight page and
    > on the leaderboard. Never a PUUID fragment, never a blank.
    >
    > **Behaviour.** On row creation `display_name` = the reported `gameName`, or null when the client
    > reported none (a PUUID first seen in an eog block has no name attached). On a later report, refresh
    > `display_name` only while it still equals the previously stored `gameName` — that is the "nobody has
    > overridden it" test — so a Riot ID change follows through but an admin's override survives it. Clearing
    > the admin field posts `""` and stores null, which puts the row back on automatic.
    >
    > **Edge cases.** A PUUID first seen in an eog block (no `gameName` in `companionGameParticipantSchema`)
    > keeps a null `display_name` until a lobby or rank post names them; every surface must still render
    > something, so keep the existing `displayName ?? gameName ?? shortPuuid` fallback chain and add
    > `gameName` to the `/admin/tokens` table, which skips it today. Two friends with the same `gameName` are
    > two rows with the same name; core does not deduplicate (M1.4) and neither does this — the admin field
    > is how the group breaks the tie. Renaming does not touch identity: PUUID is still the key.
    >
    > **Acceptance check.** Post a lobby of ten with `gameName` set: every `players` row has
    > `display_name = gameName`. Repost unchanged: no column changes (the M1.5 diff-before-write rule holds).
    > Set a name on `/admin/players`, then repost the lobby with a *different* `gameName`: `game_name` moves,
    > `display_name` does not. Clear the field: it goes back to null and the next lobby post refills it from
    > `gameName`. `/admin/players` and `/admin/tokens` show a readable name for every row in all of these.
    >
    > **Out of scope.** Nicknames per season, Discord display names (the group's Discord name is not the
    > League name and linking them is M1.6's `discord_id`), and any change to how a player is matched.

- [x] **M1.8** `POST /api/companion/lobby` must check the caller is in the lobby it is reporting. There is no check at all today: any valid companion token can post any `lcu_party_id` with any member list, and because `replaceMembers` deletes every member not in the posted list, one stale or buggy companion rewrites another lobby's roster. Verified 2026-09-08 against the local stack: a token for a player who is in no lobby posted the ten-player party with one member and the stored roster dropped from ten rows to one, HTTP 200. Refuse with 403 when the token's player PUUID does not appear in the posted `members` (`isSpectator: true` counts, matching M2.8's widened game rule). Record the rule in `04-decisions.md` and add it to the "Security" bullet in `01-architecture.md`, which today only covers games.

    > **Why (product).** M2.5 balances off `lobby_members` and M2.7 matches tonight's ten against history
    > from the same table. A roster any token can shrink is a roster the referee cannot trust, and the failure
    > is silent: teams get balanced for nine people and nobody knows why. This has to be decided before
    > anything reads that table to make teams.
    >
    > **Edge cases.** Fewer than ten members is normal and stays a 200 — the lobby is still filling. An empty
    > `members` array from a companion that is still in the lobby is the "everyone left" report and stays a
    > 200, but it can no longer come from an outsider, because an empty list cannot contain the caller.
    > A companion watching as a spectator posts itself with `isSpectator: true` and is accepted; if M0.3 finds
    > the client does not list a spectator among lobby members at all, that is a finding for the lead, not a
    > reason to drop the check. A second companion in the same lobby is unaffected: it is in the list.
    >
    > **Acceptance check.** A token whose player is in the posted `members` gets 200 and the roster is
    > replaced. The same token posting a `members` list that does not contain its own player gets 403 and
    > **no row in `lobbies` or `lobby_members` changes** — assert on the rows, not just the status. A token
    > whose player is in the list as `isSpectator: true` gets 200. Posting an unknown `partyId` with the
    > caller in the list still creates the lobby.

- [ ] **M1.9** Rewrite the minted-token page for the friend who has to use it (`apps/web/lib/admin/tokenPage.ts`). It currently ends "Paste it into the companion's first-run prompt (`%APPDATA%/customs-night/config.json`)", which reads as if the file path is where you paste. Copy goes through product; the replacement wording is below and must ship verbatim.

    > **Copy (product, 2026-09-08).** Body, in order:
    >
    > - `<h1>` — `Companion token`
    > - `<p><strong>Copy it now.</strong> This is the only time it is shown — we only keep a scrambled copy, so we cannot show it to you again. Lost it? Mint another and revoke this one.`
    > - the `<code>` block with the token, unchanged
    > - the PUUID and Label list, unchanged
    > - `<p>` — `Start the companion and paste this in when it asks. It remembers it, so you only do this once.`
    > - `<p class="muted">` — `It saves it in %APPDATA%/customs-night/config.json if you ever need to find it.`
    > - the "Back to tokens" link, unchanged
    >
    > **Acceptance check.** The rendered page contains those sentences verbatim, the token still appears in
    > exactly one HTTP response and in no URL or cookie, and `renderMintedTokenPage`'s existing escaping test
    > still passes.

- [ ] **M1.10** The placeholder tonight page (`apps/web/app/page.tsx`, from M1.1) renders "Nothing tonight yet." followed by a bare `<ul>` of `top jungle mid adc support` with no explanation, and `/admin` links friends to it as "Tonight". Anyone who opens the site during M2 sees what looks like a broken page. Pure copy until M3.4 replaces the page: keep the heading, replace the body with `Nothing tonight yet. When ten of you are in a custom lobby with the companion running, the teams show up here.` and drop the role list.

    > **Acceptance check.** `/` renders the heading and that one sentence, no role list, and nothing else.
    > `pnpm --filter web build` still passes. M3.4 replaces the whole page and this task is not a constraint
    > on it.


Acceptance: `pnpm -r test` green; a curl with a valid token creates a lobby row and a game row; a second identical curl changes nothing.

> **Acceptance evidence (product, 2026-09-08).** Walked against the running local stack, `pnpm --filter web dev`.
>
> - `pnpm -r test`: core 3 files, db 3 files / 42 tests, web 10 files / 116 tests all pass. `packages/lcu`
>   is 94 of 96 — the two failures are `lockfile.test.ts` and `cli/smoke.test.ts` asserting the League client
>   is *not* running on this machine, and it is. Fixed in a parallel task; not an M1 defect.
> - Lobby: `POST /api/companion/lobby` with a minted token, a ten-member party. First call
>   `created: true`, `memberCount: 10`; `lobbies` 0 -> 1, `lobby_members` 0 -> 10, `players` 1 -> 10 (the
>   token's own row already existed). Repeats returned `created: false` and a full `select *` snapshot of
>   `lobbies`, `lobby_members`, `games`, `game_players`, `players` and `ratings` was byte-identical across a
>   repost — `updated_at` included, so the M1.5 diff-before-write rule holds.
> - Game: `POST /api/companion/game` with a `CUSTOM_GAME` eog for the same party. First call
>   `created: true`, `participants: 10`; `games` 0 -> 1, `game_players` 0 -> 10, the row's `lobby_id`
>   resolved to the lobby above. Repeats `created: false`, same snapshot diff, empty.
> - Refusals behave as documented: no token 401, unknown token 401, bad body 400 with zod paths,
>   `gameType: MATCHED_GAME` 422, an eog the token's player is not in 403.
> - `ratings` stayed at 0 rows after a complete eog. That is correct for M1 — `rateGame` runs in M2.5.
> - Test rows were deleted afterwards; all seven tables are back to 0.
>
> Gaps found in the pass are M1.7 to M1.10 above, M2.9 and M3.9. None of them contradict the two clauses
> of this acceptance; M1.8 is the one that should land before M2.5 reads `lobby_members` to make teams.

## M2 Companion v1: roster and results (2 to 3 days, needs M0 and M1)

Goal: a friend runs one exe, and every lobby and game they are in lands in the database with no action.

- [ ] **M2.10** Align the companion payload schemas with the real 16.17 client shapes. `packages/db/src/schemas/companion.ts` was written in M1.2 from the shapes in `03-lcu-reference.md`, before anyone had seen a real response, and M0.3's fixture pass found twelve places where the client disagrees. Fix the schemas, the mapping and the ingest together as one contract, first in M2: **M2.2 and M2.3 both build directly on these payloads and must not start before this lands.** Two owners on one contract — `platform-engineer` for `packages/db/src/schemas/` and the ingest side in `apps/web`, `companion-engineer` for the mapping in `apps/companion`. **Precondition:** `packages/lcu/fixtures/16.17/` must be committed (M0.2) and the lobby, eog and ranked rows in `03-lcu-reference.md` turned `verified` (M0.3); the acceptance check reads those fixtures and today the directory holds only `README.md`.

    > **Brief (product, 2026-09-08)**
    >
    > **The scene.** Nothing here is visible to a player, and that is the point: every one of these
    > mismatches ends the night the same way. The tenth friend joins, the companion posts, zod refuses the
    > payload, and Discord stays silent while ten people wait — or worse, the post is accepted and teams get
    > built with two bots and everyone on the same side. The contract has to match the client before anything
    > is built on it.
    >
    > **Lobby (`companionLobbyPayloadSchema`, `companionLobbyMemberSchema`).**
    >
    > 1. **`members[].summonerId` is a JSON number, not a string.** `optionalText` refuses a number, so today
    >    one real lobby response fails the whole payload. Accept `number | string`, normalise to a decimal
    >    string (`players.summoner_id` is `text`; no migration), null when absent. Do not drop the field —
    >    M4's invites are the only thing that needs it.
    > 2. **Lobby members carry no `gameName`/`tagLine`.** The client's lobby member has no Riot ID pair. The
    >    companion sends what it already has (its own `current-summoner`, anything it looked up via
    >    `GET /lol-summoner/v2/summoners/puuid/{puuid}`) and the server tolerates null for both. **Posting a
    >    lobby never waits on a name lookup.** PUUID is the identity; a roster with null names is a correct
    >    roster, and the names fill in from the next eog block or the M2.4 sweep. A lookup that fails, times
    >    out or 404s is logged once and the member still goes in the payload.
    > 3. **`side` comes from `gameConfig.customTeam100` / `customTeam200` membership.** `members[].teamId` is
    >    always `0` in a custom lobby and must never be read by anything, ever. A puuid in neither array is
    >    `side: null` (the client has not placed them yet) — that is a valid state, not an error. This answers
    >    question 3 of "Behaviors to confirm" in `03-lcu-reference.md`; M0.3 records the answer there.
    >
    > 4. **Bots have `isBot: true` and `puuid: ""`.** The companion drops them before posting. The server also
    >    drops any member with an empty or all-zero puuid rather than 400 the whole roster, logging one line —
    >    a bot leaking through must never cost the group the other nine members. Order matters: filter bots,
    >    **then** run the M1.8 caller-in-`members` check, then replace. Filtering can leave fewer than ten
    >    members, which simply means the lobby is not balanced yet.
    >
    > **Game, end of game (`companionGamePayloadSchema`, `phase: 'eog'`).**
    >
    > 5. **The block has no start time.** `startedAt` stays required in the schema; the companion derives it.
    >    Prefer the `InProgress` moment it observed for that `gameId` (it already posts one in the
    >    `phase: 'in_progress'` payload); when it has none — a companion that started or reconnected mid-game
    >    has none — fall back to `endOfGameTimestamp` minus `gameLength`. The fallback is not optional.
    >    Confirm the units of both fields against the fixture and write them into `03-lcu-reference.md`
    >    instead of assuming milliseconds and seconds.
    > 6. **A `TerminatedInError` block has no winning team.** The companion recognises it and does not post it,
    >    logging the reason. If one reaches the API anyway it is refused with a message that names the reason;
    >    nothing is written and nothing is ever rated. The lobby is left alone — it stays `in_game` and ages
    >    out to `abandoned` on the existing idle rule (M2.5). Do not invent a status for it.
    > 7. **Role comes from `detectedTeamPosition`:** `TOP -> top`, `JUNGLE -> jungle`, `MIDDLE -> mid`,
    >    `BOTTOM -> adc`, `UTILITY -> support`. Anything else — `""`, missing, a value we have not seen — is
    >    `null`. `role` is nullable everywhere for exactly this reason. Never infer a role from the champion.
    > 8. **Stat keys, exactly:** `CHAMPIONS_KILLED` (not `KILLS`), `NUM_DEATHS` (not `DEATHS`), `ASSISTS`,
    >    `GOLD_EARNED`, `TOTAL_DAMAGE_DEALT_TO_CHAMPIONS`, and cs is `MINIONS_KILLED` **plus**
    >    `NEUTRAL_MINIONS_KILLED`. `WIN` is `0 | 1`, a number, not `"Win"`/`"Fail"`. A missing key is 0, which
    >    the schema already defaults; one absent stat never costs us a game. The stat-key list in the eog row
    >    of `03-lcu-reference.md` is wrong today and is corrected by this task.
    > 9. **There is no `queueId` in the block.** Nothing may read one. The custom-game gate is
    >    `gameType === 'CUSTOM_GAME'`, which is what M2.5 already uses; remove `queueId` from the eog row of
    >    the reference.
    > 10. **Bot players have `botPlayer: true` and the all-zero puuid** (`00000000-0000-0000-0000-000000000000`).
    >    The companion filters them before validation, and `puuidSchema` in `common.ts` rejects the all-zero
    >    puuid outright: it accepts it today, so a bot game would create a `players` row keyed on a PUUID that
    >    every bot in every game shares — the one kind of bad row this product cannot tolerate, because PUUID
    >    is the identity. That change touches every payload; it is a widening of what we refuse, and it needs
    >    its own test. Filtering can leave fewer than ten participants, and the M2.5 gate (ten participants,
    >    five a side, over 300 seconds) then correctly stores the game without rating it.
    > 11. **`games.raw` must be scrubbed of `mucJwtDto` and `multiUserChatPassword` before storage.** The block
    >    carries live chat credentials and `games` is **public-read** under RLS, so this is a leak, not
    >    hygiene. Replace the value of both keys with the string `"[redacted]"` at any depth, matching the
    >    convention `packages/lcu/src/scrub.ts` already uses for WS events. Scrub on the server before insert;
    >    the companion may scrub too, but the server is the one that has to be right, because old companion
    >    binaries keep running in people's tray for months.
    >
    > **Rank (`companionRankPayloadSchema`).**
    >
    > 12. **Unranked is `tier: ""` with `division: "NA"`.** Normalise both to `null`; a null tier forces a null
    >    division. `optionalText` already folds `""` to null, so `"NA"` is the one that survives today and
    >    would print on the player page as a division. `losses` reads `0` for every player but yourself, so it
    >    is not truth: the schema does not carry it and must not gain it. Wins and losses come from our own
    >    `games` rows, never from the client.
    >
    > **Edge cases.** Fewer than ten, or more than ten, are untouched by this task — it is about shape, not
    > count. Spectators: confirm from the fixture whether `customSpectators[]` members appear in `members` at
    > all; if they do not, a sitting-out friend cannot be seen in the lobby payload and M2.8's spectator path
    > rests entirely on the `reported_by_player_id` fallback — say so in the reference rather than guessing.
    > Someone leaving mid-lobby is unchanged: replace semantics while `open`, frozen from `in_game` (M2.9).
    > A companion that disconnects and reconnects at `EndOfGame` is the case that makes the `startedAt`
    > fallback mandatory. An unknown player lands as a `players` row with null names and no rank, and both
    > fill in later; ingest never blocks on either.
    >
    > **One mapper, not two.** The raw-LCU-to-payload mapping is written once and imported by both
    > `apps/companion` and the fixture test. It is client-shape knowledge, so `packages/lcu` (which would take
    > `@customs/db` as a dependency — `db` depends only on `core`, so there is no cycle) is the natural home;
    > a test in `packages/db` reaching for `packages/lcu/fixtures/` is the alternative. **The lead picks the
    > home**; what this brief requires is that the mapping exists in exactly one place and that no copy of it
    > lives in `apps/companion`.
    >
    > **Acceptance check.**
    >
    > 1. A fixture-backed test builds a lobby payload from `packages/lcu/fixtures/16.17/lobby.json` through the
    >    mapper and `companionLobbyPayloadSchema.parse` succeeds: sides come out five and five from
    >    `customTeam100`/`customTeam200`, every `summonerId` is a digit string, null `gameName`/`tagLine` pass.
    > 2. The same for `eog-stats-block.json` through `companionGamePayloadSchema` (`phase: 'eog'`): ten
    >    participants, `winningSide` 100 or 200, `startedAt` equal to `endOfGameTimestamp` minus `gameLength`,
    >    roles mapped from `detectedTeamPosition`, and at least one participant's `cs` asserted by hand as
    >    `MINIONS_KILLED + NEUTRAL_MINIONS_KILLED`.
    > 3. A bots lobby fixture parses with only the humans in it, and a member with an empty-string puuid does
    >    not take the rest of the roster down with it.
    > 4. A `TerminatedInError` block is refused with a reason naming it, and no `games` row is written.
    > 5. `puuidSchema` rejects the all-zero puuid.
    > 6. A stored `games.raw` reads `"[redacted]"` at `mucJwtDto` and `multiUserChatPassword`, and the original
    >    values appear nowhere in the row.
    > 7. A rank payload built from the unranked fixture has `tier: null` and `division: null`.
    > 8. `pnpm -r typecheck` and `pnpm -r test` pass, and the lobby, eog and ranked rows of
    >    `03-lcu-reference.md` carry the corrected shapes.
    >
    > **Out of scope.** No migration — `summoner_id` is already `text` and `role` already nullable. No change
    > to the M2.5 rating gate, the lobby state machine or the M2.9 freeze. No match-history or backfill shapes
    > (M5). No champion-name or icon lookup. No packaging.

- [ ] **M2.1** `apps/companion` CLI: config file, first-run token prompt, connection state machine with reconnect and backoff, structured logs with rotation.

    > **Note (product, 2026-09-08, after M0.3).** The companion subscribes to the firehose
    > (`[5, "OnJsonApiEvent"]`) and filters by `uri`, because the per-URI topics have not been exercised yet.
    > That means every event the client emits passes through this process on a friend's home PC, including
    > their private chat and their live game credentials. Two consequences for this task: the logs never
    > contain a raw event body — `packages/lcu/src/scrub.ts` already does this for `record-ws` and the same
    > function guards the log path — and events on URIs the companion does not read are dropped at the edge,
    > not carried into application state. Champion-select and matchmaking URIs are dropped and never acted
    > on; that is the gameplay line in `03-lcu-reference.md`, and it is easier to hold when the events never
    > get past the filter.
- [ ] **M2.2** Lobby watcher: on every lobby WS event, POST the member list with sides and spectator flags. Debouncing lives on the server, not here. Needs M2.10: sides come from `gameConfig.customTeam100`/`customTeam200`, never `members[].teamId`, and bots are filtered before posting.
- [ ] **M2.3** Game capture: on gameflow `InProgress` POST the game ID against the lobby; on `EndOfGame` fetch the eog block and POST it. Needs M2.10 for the payload shape (derived `startedAt`, `detectedTeamPosition` roles, real stat keys, `TerminatedInError` dropped). Handle the case where the client reaches `EndOfGame` while the companion was reconnecting: on connect, if phase is `EndOfGame` or `WaitingForStats`, fetch and post.

    > **Note (product, 2026-09-08, after M0.3).** Two facts from the 16.17 capture change how this task is
    > built, without changing what it does.
    >
    > 1. **The block arrives before the phase does.** The WS `Create` for
    >    `/lol-end-of-game/v1/eog-stats-block` landed 0.3 s after `WaitingForStats` and about a second before
    >    the phase reached `EndOfGame`. So the **primary path is the WebSocket event**: take the block from
    >    the event payload and hold it. The `GET` on `EndOfGame` is the fallback for a companion that was not
    >    listening, not the main road. Writing this phase-first inverts the reliable path.
    > 2. **The fallback has a deadline.** The `GET` answered 200 for as long as the end-of-game screen was up
    >    (checked at +33 s and +4 min) and 404'd once the client was back in the lobby (+10 min). So "on
    >    connect, if phase is `EndOfGame` or `WaitingForStats`, fetch and post" only recovers a game while
    >    somebody is still staring at the score screen. Once they click through, the block is gone from the
    >    client for good and the game is backfill's problem (M5.1). Keep the recovery attempt; when the GET
    >    404s, log one line naming the `gameId` and say it is left to backfill. Never poll for it afterwards.
    >
    > Holding the block in memory is not enough on its own — a failed POST or a companion restart drops it
    > inside that same window. Durability is **M2.12**; M2.3 may land first with an in-memory hold and a
    > retry, and M2.12 makes it survive a restart.
- [ ] **M2.4** Rank sync: own rank on start and every 6 hours; rank for every unknown PUUID seen in a lobby, once, then weekly.

    > **Note (product, 2026-09-08, after M0.3).** This sweep also fetches **names**, not just ranks. Lobby
    > members carry no `gameName`/`tagLine` — `summonerName` is an empty string on 16.17 — so a roster posted
    > straight from a lobby event has null names for everyone the database has not met before (M2.10, point
    > 2). The only way to a name is a per-puuid lookup:
    > `GET /lol-summoner/v2/summoners/puuid/{puuid}` returns `gameName` and `tagLine` for another player and
    > is already verified. Do it in the same pass as the rank read, for the same PUUIDs, on the same schedule,
    > and POST both together. Posting a lobby still never waits on it.
    >
    > Why it matters: without this, the first night a new friend plays, the teams embed has their rating and
    > a blank where their name should be until their first game ends. `losses` from the client is `0` for
    > anyone but yourself — do not read it, here or anywhere (M2.10, point 12).
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

    > **Blocked-on note (product, 2026-09-08, after M0.3).** The acceptance check above assumes a spectator
    > shows up in the lobby payload as a member with `isSpectator: true`. **Nobody has seen that happen.**
    > The 16.17 capture has one solo lobby with bots: `customSpectators` was `[]` in all 30 lobby events and
    > no member ever had `isSpectator: true`. If the client keeps spectators only in
    > `gameConfig.customSpectators[]` and out of `members[]`, this task's lobby-membership path never
    > matches and the spectator case is no better than it is today. Capture it first — **M2.13**.
- [x] **M2.9** Freeze the lobby roster once the lobby reaches `in_game`. `replaceMembers` (M1.5) makes `lobby_members` mirror whatever the companion last posted, deletions included — verified 2026-09-08: posting the same party with an empty `members` array left the lobby row with zero members and HTTP 200. So the record of who was in a lobby is mutable right up to and past the game. M2.7 matches tonight's ten against "a lobby that had exactly the same ten puuids", and M5.5 lists lobbies that reached `in_game` and never finished; both read a list that a late or partial post can empty. Once the state machine (M2.5) moves a lobby to `in_game`, freeze `lobby_members` entirely, and keep it frozen through `finished`: a later post for that party is still accepted (200) and still idempotent, and the lobby's own fields (name, password) still refresh, but no member row is inserted, updated or deleted — `side` included, because once the game has started the side that counts is the one recorded on `game_players`. The response says `rosterFrozen: true` and returns the stored member count so the companion can see nothing moved. `open`, `balanced` and `abandoned` keep the replace semantics.

    > **Why (product).** "Who was around tonight" is the input to the sit-out rotation (step 6 of the nightly
    > loop) and to the repeat-split penalty. If it can be erased by the last companion to shut down, the
    > referee forgets last night and the same five get put together again — the one failure of this product
    > people would actually notice.
    >
    > **Edge cases.** Someone leaving while the lobby is still `open` is a real leave and must still delete
    > their row; this rule only applies from `in_game` on. A lobby that goes `abandoned` without ever
    > reaching `in_game` keeps the normal behaviour. A companion that reconnects mid-game and posts a partial
    > list changes nothing. Two companions posting different lists after `in_game` both change nothing.
    >
    > **Acceptance check.** Post a ten-member lobby, drive it to `in_game`, then repost the same party with
    > three members: `lobby_members` still has ten rows. Repost with an empty list: still ten. Do the same
    > against a lobby still in `open`: the deletes apply as they do today.


- [ ] **M2.11** Run the M0 verification pass on Windows before anything is packaged. Every row in `03-lcu-reference.md` was verified on macOS (16.17, 2026-09-08) and the companion ships as a Windows exe, so today the shipped platform is the unverified one. With the client running on Windows: `pnpm --filter @customs/lcu smoke --diff` against the committed `16.17` fixtures, plus a lockfile read at the Windows default path and one exercise of the process-args fallback. Update the Connecting rows in `03-lcu-reference.md` with Windows evidence, and turn "Process args fallback" from `unverified (observed, no code)` into a verified row or a task to drop it.

    > **Why (product).** The scene is ten friends in Discord; nine of them are on Windows. A shape difference
    > between platforms — a lockfile path, a certificate mode, an empty `summonerName` that is populated on
    > Windows — would be found on the first real night with everyone waiting, which is the worst possible
    > place to find it. This is an afternoon on one PC.
    >
    > **Edge cases to cover while the client is up.** Client not running (exit 2). Client starting up, so the
    > lockfile exists but the port is not listening yet — the probe must exit 3, not silently fall back to
    > `insecure`. Client restarted while the companion watches (the reconnect path of M2.1). A non-default
    > install directory, which is what the process-args fallback exists for: hide the lockfile, or point
    > `LCU_LOCKFILE_CANDIDATES` at a path that does not exist, and confirm the fallback finds the same port
    > and password.
    >
    > **Acceptance check.** `smoke --diff` exits 0 on Windows against the `16.17` fixtures, or every
    > difference is written into the reference with a Windows note. The lockfile row and the process-args row
    > carry a dated Windows line. `pnpm --filter lcu test` still passes.
    >
    > **Out of scope.** Packaging (M2.6). Any new endpoint. Re-verifying the M4 rows.

- [ ] **M2.12** The companion keeps a captured end-of-game block until the API has confirmed it. The block lives in the client only while the end-of-game screen is up (M0.3): once the player clicks back to the lobby the `GET` 404s and the game is unrecoverable until backfill. So an in-memory hold plus a retry loop still loses the game to a crash, a `pnpm`-style restart, a laptop lid, or an API that is down for the two minutes that matter. Write the block to disk beside the config the moment it is captured, POST from there, and delete it only on a 2xx or a refusal that names a permanent reason (`TerminatedInError`, not `CUSTOM_GAME`).

    > **What a player sees.** Nothing, on a good night. On a bad one: the game they just played shows up on
    > the tonight page a minute late instead of never, and nobody has to say "the bot missed that one".
    >
    > **Behavior.** On capture (WS event, or the `EndOfGame` GET fallback), scrub `mucJwtDto` and
    > `multiUserChatPassword` (M2.10, point 11), then write one file per `gameId` under the companion's data
    > directory. Retry with the existing backoff, across restarts, indefinitely while the file is there. On a
    > 2xx — including the idempotent "already have this game" answer — delete the file. On a 4xx that names a
    > permanent reason, delete the file and log why. On any other error, keep it. Cap the queue at a sane
    > number of files and drop the oldest with a log line rather than filling a friend's disk.
    >
    > **Edge cases.** Two companions in the same game each hold their own copy; the second POST is a no-op
    > (`lcu_game_id` dedupe) and both delete their file. A companion that never comes back leaves a file that
    > is posted whenever it next starts, days later — the server accepts it, because dedupe and the rating
    > rebuild (M5.2) make late arrival safe. A block for a game the API has never heard of (no lobby) is
    > still posted; that is M2.8's and backfill's problem, not this one. A file that no longer parses is
    > logged once and deleted.
    >
    > **Acceptance check.** With the API returning 500: play or replay a custom, confirm the block is on
    > disk, click past the end-of-game screen so the client's `GET` 404s, kill the companion, bring the API
    > back, start the companion — the game lands exactly once with ten `game_players` rows. Repeat with the
    > companion killed *before* it ever POSTs. A `TerminatedInError` block leaves no file. Two runs of the
    > same recovery produce one `games` row.
    >
    > **Out of scope.** Backfill (M5.1). Any change to the ingest contract. A UI for the queue; a log line is
    > enough until M6.1.

- [ ] **M2.13** Capture a real lobby: ten humans, and one spectator. Every lobby fact in `03-lcu-reference.md` comes from a solo lobby with bots — one member, `customTeam200: []`, `customSpectators: []` in all 30 recorded lobby events, and no member ever carrying `isSpectator: true`. Two things nothing has answered: whether a spectator appears in `members[]` at all or only in `gameConfig.customSpectators[]`, and whether a ten-human lobby differs in any field from the one-human one (`summonerName`, position preferences, `maxTeamSize`, member ordering). Save `lobby-10.json` and `lobby-spectator.json` into `packages/lcu/fixtures/16.17/`, parse both in `schemas.test.ts`, and write the answers into the lobby row and into question 3's answer.

    > **Why (product).** Two shipped or planned rules rest on the unobserved answer. M1.8 (done) refuses a
    > lobby post unless the caller's PUUID is in `members`, "`isSpectator: true` counts". M2.8 accepts a
    > spectator's end-of-game post if that player is a lobby member with `isSpectator: true`. If the client
    > does not put spectators in `members[]`, both rules are dead letters: the friend who sits out tonight
    > and is the only one running the companion gets a 403 on every lobby post, and the group's teams never
    > appear. That is the whole scene failing on an ordinary eleven-person night.
    >
    > **Acceptance check.** Both fixtures committed and parsed by `schemas.test.ts`. The lobby row and
    > "Behaviors to confirm" question 3 state, with a date and patch, where a spectator appears. If
    > spectators are absent from `members[]`, this task also files the follow-up: widen the M1.8 caller check
    > and the M2.8 lobby check to accept a PUUID found in `gameConfig.customSpectators[]`, add the decision
    > row, and correct M1.8's wording — do not leave a shipped rule describing a payload the client does not
    > send.
    >
    > **Out of scope.** Any code change to the ingest rules; this task captures and records, and names the
    > follow-up. M4's lobby creation.

Acceptance: two people run the companion, play one custom, and the game appears once in `games` with ten `game_players` rows and updated ratings. Kill one companion mid-game; the game still lands.

## M3 Teams in Discord and on the web (2 to 3 days, needs M2)

Goal: first real night. Ten join the lobby, teams appear in Discord with an explanation, results and leaderboard follow.

- [x] **M3.0** Design system: `designer` produces `docs/05-design.md` (tokens, type, component notes, Discord embed text layouts). Lands before any M3 UI task.
- [ ] **M3.1** On `balanced`: run the balancer, store the top three splits, post the teams embed to the Discord webhook: two columns with role and display rating, the explanation line, lobby name and password if known, and a sit-out line when more than ten are around. Sit-out copy goes through product before it ships.

    > **Brief (product, 2026-09-08)**
    >
    > **The scene.** Ten friends are in voice, someone opened a custom lobby, everyone joined. Nobody typed
    > anything. Within seconds of the tenth join Discord shows two teams with roles beside the names, one
    > sentence saying why, and the lobby name and password so a straggler can still get in. That is the whole
    > task: the moment the lobby goes `balanced`, the group has teams.
    >
    > **What happens, in order.** M2.5 moves the lobby to `balanced` (ten non-spectator members unchanged for
    > 10 seconds). On that transition the API builds the balancer input from `lobby_members` and `ratings` for
    > the active season, takes `lastSplit` from M2.7, calls `balance()`, stores all three splits with their
    > explanation strings in `splits` (exactly one `is_chosen`), computes the sit-out list when more than ten
    > are around, and posts one teams embed to the webhook in `discord_config`. Field names, line format,
    > order, colour and every string are `docs/05-design.md`, "Teams embed". That document is the copy, not a
    > suggestion.
    >
    > **Explanation line.** Posted verbatim from the stored explanation of the chosen split. Never recomposed
    > from the split's numbers, never shortened to fit, never split into fields. M3.7 is the end-to-end check.
    >
    > **Sit-out line.** Only when more than ten are around. It names the sitters and states the rule in one
    > sentence. The strings are fixed in `05-design.md`; **copy goes through product** before it ships — an
    > engineer who needs different wording asks for it rather than writing it.
    >
    > **Tonight page URL.** The embed `url` is `NEXT_PUBLIC_SITE_URL` (already introduced by M1.6 and read and
    > normalised by `readAuthEnv` in `apps/web/lib/env.ts`) plus the tonight page path. **No domain exists
    > yet**, so: when the variable is unset, fall back to the origin of the request that triggered the
    > transition; if there is no usable origin either, post the embed with no `url` rather than a broken one.
    > Never hardcode a host, and never post a `localhost` link to Discord.
    >
    > **Edge cases.**
    >
    > - **Fewer than ten.** No balance, no post. The lobby stays `open` and the tonight page shows the member
    >   list. `balance()` throws on nine and that throw must never reach the webhook or the companion.
    > - **More than ten.** The API picks the ten (fewest games tonight, then oldest sit-out) and the rest are
    >   the sit-out list; `balance()` still receives exactly ten. If the selection cannot produce exactly ten,
    >   log one line and post nothing: a wrong ten is worse than no post.
    > - **Someone leaves before the post.** The 10-second stability rule has not fired, so nothing was posted
    >   and there is nothing to undo.
    > - **Someone leaves after the post.** The lobby returns to `open` and rebalances, which posts a new
    >   embed. M3.1 does not edit or delete the earlier message; two messages in the channel is the honest
    >   record of what happened.
    > - **Companion disconnects.** Nothing is re-posted. The split is stored and the embed is out. When the
    >   companion returns and re-posts the same party, ingest diffs before it writes and the transition does
    >   not fire again. Two companions in one lobby produce one post; dedupe on `lcu_party_id`.
    > - **Unknown player.** A lobby member with no `ratings` row for the active season is seeded from their
    >   rank (M1.3, M2.4) before balancing; with no rank either, they seed unranked (`mu 20.00, sigma 10.00`).
    >   They are balanced like anyone else and carry no marker in the embed — the "still settling" story is
    >   the leaderboard's job (M3.8), not the teams post. A player with no `mainRole` is never counted
    >   off-role.
    > - **Webhook missing, or Discord refuses the post.** Store the splits anyway and log one line. The
    >   tonight page is the other surface and must not depend on Discord having accepted anything. No retry
    >   loop.
    >
    > **Acceptance check (product).**
    >
    > 1. Drive a ten-member lobby to `balanced`. Exactly one embed is posted, within 15 seconds of the tenth
    >    join: accent bar (`14721854`), title `Teams are set`, the stored explanation string verbatim as the
    >    description, two inline fields named `Blue · <sum>` and `Red · <sum>`, five lines each in lane order
    >    `top jungle mid adc support` with the role in inline code, footer
    >    `Customs Night · more on the tonight page`.
    > 2. `splits` has three rows for that lobby with their three explanation strings, exactly one `is_chosen`.
    > 3. Eleven around: the embed also carries the `Sitting out` field with the product copy verbatim, and the
    >    ten in the team fields are the ten with the fewest games tonight.
    > 4. Nine around: no post, no `splits` rows, and the companion's POST still answers 200.
    > 5. Lobby name and password known: the `Lobby` field is present. Unknown: the field is absent, not empty
    >    and not `unknown`.
    > 6. Someone off-role in the chosen split: their line ends ` · off-role` and the description names them.
    > 7. With `NEXT_PUBLIC_SITE_URL` unset and no usable request origin, the embed posts with no `url` and
    >    nothing else changes.
    >
    > **Out of scope.** Reroll (M3.2), the result embed (M3.3), the tonight page (M3.4), voice split (M4),
    > editing or deleting a posted message, @-mentions, reactions, buttons, and any slash command. Nobody
    > types to make this happen and nobody types after it.

- [ ] **M3.2** Reroll: an admin route and a small button on the tonight page that promotes split 2 or 3 and reposts. No random reroll exists.
- [ ] **M3.3** On `finished`: result embed with winner, duration, top damage, rating deltas per player.

    > **Brief (product, 2026-09-08) — the two number rules**
    >
    > **Delta rule.** A displayed rating change is `displayRating(muAfter) - displayRating(muBefore)`: both
    > numbers are rounded first, then subtracted. Never `round((muAfter - muBefore) * 60)`. The row on the
    > screen has to add up — `1469 (+43)` next to a new rating of `1512` — and it only does under this rule.
    > The delta is computed at the display boundary from the two stored ratings, by one shared helper that the
    > result embed, the tonight page and the player page all call, so the Discord message and the web page can
    > never print different numbers for the same game. `packages/core` keeps `displayRating`; it does not gain
    > a delta concept. Recorded in `04-decisions.md`.
    >
    > **Never print a team total of deltas.** The two sides do not sum to zero (movement scales with each
    > player's own sigma), and a visible imbalance is a free argument about a thing that is working correctly.
    > `00-product.md`, "The numbers on the screen", is the sentence to quote when someone asks in voice.
    >
    > **Fixture warning (from the designer, M3.0).** The per-player deltas in the result-embed example in
    > `docs/05-design.md` were computed by hand from the two-team Plackett-Luce reduction, not by `rateGame`.
    > They are illustrative only. **Replace them with real `rateGame` output before any of them is pinned in a
    > test or a fixture**, and update the example in the design doc in the same session if the real numbers
    > differ. Duration and top damage in that example are invented; the docs pin no result for the worked
    > example.

- [ ] **M3.4** `/` Tonight page: live via Supabase Realtime; phone-friendly; the link is what gets pasted in WhatsApp. Shows lobby members as they join, then teams, then result.
- [ ] **M3.5** `/leaderboard` and `/p/[puuid]` with rating history. Nightly leaderboard post to the webhook at a configured time.

    > **Brief (product, 2026-09-08) — the board shows two numbers**
    >
    > **Why.** The board sorts on `ordinal = mu - 2 * sigma`, but the number everyone recognises from the
    > teams and result embeds is `round(mu * 60)`. Print only the second and the page shows a list that is
    > visibly out of order; print only the first and nobody recognises their own number. So every row shows
    > both, and each has one name used everywhere in the product.
    >
    > - **Proven** — `round(ordinal * 60)`. Primary, right-aligned on line 1, and **the sort key**. Rows are
    >   ordered by Proven, descending, always.
    > - **Rating** — `round(mu * 60)`. Secondary, dim, on line 2. The same number the embeds print beside a
    >   name, and the number the balancer works from.
    >
    > **The rule: the sort order and the primary number are the same number, on every surface, with no
    > exception.** Where only one number fits — the nightly Discord embed — it is Proven, because a list
    > ordered by a number it does not show is exactly the complaint this rule exists to prevent.
    >
    > The names `Proven` and `Rating` are fixed. Capitalised as column labels, lower case inside a sentence.
    > No surface invents a third name for either: not `/p/[puuid]`, not the embed, not the admin.
    > `docs/05-design.md` carries the layout and `docs/00-product.md`, "The numbers on the screen", carries
    > the explanation a friend gets read to them in voice.
    >
    > **Edge cases.**
    >
    > - **Fewer than 30 games.** The `settling` chip and the one-per-page sentence, both M3.8. Proven still
    >   sorts them; nothing is hidden and no separate section exists.
    > - **Zero games this season.** A seeded player with no games has a Rating and a Proven and appears on the
    >   board, at the bottom, with `0 games` and the chip. Do not filter them out — a friend who was seeded
    >   last night and cannot find themselves will ask why.
    > - **Two players with the same Proven.** Break the tie on Rating, then on name, so the order is stable
    >   between renders.
    > - **Season with no games yet.** The board renders its heading, the sentence, and one line saying the
    >   season has no games yet. Not an empty page, not a spinner.
    >
    > **Acceptance check (product).**
    >
    > 1. `/leaderboard` rows are in descending `round(ordinal * 60)` order and the primary number on every row
    >    equals that value. Reading the primary column top to bottom never goes up.
    > 2. Line 2 of every row shows `round(mu * 60)` as Rating, and for a player who just played, that number
    >    equals what the result embed printed beside their name for the same game.
    > 3. A player with fewer than 30 recorded games shows the chip, and the still-settling sentence appears
    >    once on the page, not once per row.
    > 4. The nightly embed lists players in the same order as `/leaderboard` and prints the Proven number
    >    after each name, with the short still-settling sentence as the footer.
    > 5. `/p/[puuid]` shows both numbers under the same two labels.
    >
    > **Out of scope.** Changing the sort or the rating model, carrying ratings between seasons (M5.3), role
    > and duo stats (M5.4), any filter or search on the board, and pagination beyond what the group's size
    > needs.

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
    > cautious until it has seen you play; the marker disappears at 30 games; the number in the sentence is
    > **30**, matching the threshold the marker itself uses. Thirty is the product's round number for the
    > M1.3 finding that a mis-seeded player's sigma first falls below 5.00 somewhere between game 26 and
    > game 36 depending on results — so the sentence says "about 30 games" and the marker switches off at
    > exactly 30. Copy is final and lives in `docs/05-design.md`, "Still-settling marker" (product,
    > 2026-09-08): `The board sorts on Proven, which stays below your rating until it has seen about 30
    > games. New players start low on purpose and climb as they play.` Any change goes through product.
    >
    > **Out of scope.** Changing the sort, the rating model, or `ordinal`. No separate "new players" board, no
    > provisional/placement badge that hides a rating, no change to how teams are balanced — balancing is on
    > `mu` and is unaffected.
- [ ] **M3.9** Make starting a season a deliberate act. `/admin/seasons` has a name field and a `Start` button that fires on one click. From M3.5 on, that click empties the leaderboard: `ratings` is keyed `(player_id, season_id)`, nothing is carried over until M5.3, and there is no undo — the old season's rows survive but every public page reads the active one. Require a typed confirmation (the name of the season being ended) before the post is accepted, and say in the response what just happened. The copy on the page already spells out the consequence (product, 2026-09-08); this is the guardrail behind it.

    > **Why (product).** Everything else in `/admin` is reversible in one more click. This is the only button
    > in the app that destroys a month of the group's history in the eyes of everyone who looks at the board,
    > and it sits two fields away from "set a role". A friend clicking around on a phone should not be able
    > to do it by accident.
    >
    > **Acceptance check.** Posting to `/api/admin/seasons` without the confirmation field, or with the wrong
    > value, answers 400 and no season changes. With the exact name of the currently active season it
    > succeeds as it does today. The page shows the field with the name to type spelled out next to it.
    > Nothing about `start_season` (migration 0002) or the one-active-season index changes.


- [ ] **M3.10** Decide what a player with no name looks like. The League lobby carries no `gameName`/`tagLine` (M0.3), so a friend the database has never met appears with `display_name` null until the M2.4 sweep or their first end-of-game block fills it in — which can be minutes after teams are posted. Every surface that prints a name needs one agreed fallback: the teams embed, the result embed, the tonight page, the leaderboard, `/p/[puuid]`.

    > **Copy (product).** The fallback is the word **`Someone`**, nothing else — no PUUID fragment, no
    > "Unknown Player", no "Player 7". A PUUID is 36 characters of noise that helps nobody read a team, and
    > "Unknown" reads like an error when the truth is just that the client has not told us yet. Ten friends
    > looking at the embed know who the tenth is; they are standing in the same voice channel. On the tonight
    > page, a row showing `Someone` gets a quiet one-line hint underneath the team block, once, not per row:
    > "Names fill in after someone's first game." That sentence is the whole explanation and it does not
    > need a link.
    >
    > **Behavior.** The fallback is applied at render, never stored: `display_name` stays null in the
    > database so the next sweep or eog block fills it in without a migration or a cleanup. Two players with
    > no name both render `Someone`; that is acceptable and rare, and it resolves itself within one game.
    > A name that arrives while the page is open replaces it live (the tonight page is already Realtime).
    >
    > **Acceptance check.** With one `players` row holding a null `game_name` and null `display_name`: the
    > teams embed, the result embed and the tonight page all print `Someone` for that player and everything
    > else about the row (rating, role, rating change) is correct and unaffected. The leaderboard and
    > `/p/[puuid]` print the same. Nothing anywhere prints a PUUID, a null, or an empty cell. Set the name
    > and every surface shows it with no other change.
    >
    > **Out of scope.** Fetching the name (M2.4). Discord display names (M4). Any change to `players`.

Acceptance: a full night with real players, teams posted within 15 seconds of the tenth join, results within 60 seconds of end of game, no human action beyond joining the lobby.

## M4 Lobby automation, voice split, presence (3 to 4 days, needs M3)

Goal: the companion opens the lobby and invites the ten; Discord splits voice; the WhatsApp thread gets a "7 around".

- [ ] **M4.1** `companion_commands` queue: the companion polls, executes, acks. Kinds: `create_lobby`, `invite`, `switch_side`.
- [ ] **M4.2** "Start a lobby" button on the tonight page and an admin route: creates a `create_lobby` command for a chosen companion user, with a generated name and password, followed by `invite` commands for everyone linked and "around".

    > **Note (product, 2026-09-08, after M0.3).** The invite body is still unverified and M0 could not
    > answer it: the smoke tooling is GET-only by design, so nothing was ever POSTed to a live client. This
    > task verifies it as its first step, per `03-lcu-reference.md` question 6: `POST
    > /lol-lobby/v2/lobby/invitations` with `[{ "toSummonerId": <id> }]` using a `summonerId` from
    > `GET /lol-summoner/v2/summoners/puuid/{puuid}`; if that 4xx's, retry with `[{ "toPuuid": "<puuid>" }]`.
    > `invitations[]` in the lobby event shows which worked. Update the reference row and its status before
    > building the queue handler on it — that is the "verify before you claim" rule. `create_lobby`'s body
    > and its `mutators.id` values are unverified for the same reason and get the same treatment here.
- [ ] **M4.3** Auto side switch: after balancing, for each lobby member who runs a companion, queue `switch_side` if they are on the wrong side. Verify the endpoint in M0 first; if it does not exist, this task is dropped and the embed says "switch to your side".

    > **Correction (product, 2026-09-08, after M0.3).** "Verify the endpoint in M0 first" did not happen and
    > cannot: M0's tooling is read-only and a switch-side path can only be confirmed by POSTing to a live
    > client. The verification moves into this task, as `03-lcu-reference.md` question 5 already says. First
    > step, before any queue work: with a custom lobby open, `POST /lol-lobby/v1/lobby/custom/switch-teams`
    > with an empty body, then the v2 path if v1 404s, and watch `gameConfig.customTeam100`/`customTeam200`
    > in the lobby event to see whether the local player moved. Then fill the target side with bots and retry
    > to learn what a full side does. Write the answer into the reference and flip its status.
    >
    > The escape hatch stands: if no path works, drop the task and the teams embed says which side to move
    > to. Moving yourself in a lobby is one click, and this milestone's acceptance ("everyone on the right
    > side") is met by people clicking it. Do not invent a champion-select or in-game path to get around a
    > 404 — that is the line in `CLAUDE.md`.
- [ ] **M4.4** `apps/discord` bot: Realtime subscription; on `balanced` move linked members into blue and red voice; on `finished` move everyone back. Handles missing permissions gracefully with a log line, never a crash.
- [ ] **M4.5** Presence: when lobby voice membership changes and no lobby is open, post or edit a single "N around: names" message. Count feeds the sit-out logic as "around".
- [ ] **M4.6** Deploy the bot to Fly.io or Railway with a health check and auto-restart.

Acceptance: from an empty Discord voice channel to a balanced lobby with everyone on the right side and in the right voice channel, with the only human actions being "join voice", "click Start a lobby", and "accept invite".

## M5 Backfill, seasons, stats (2 to 3 days, needs M3; skip backfill if M0.4 said no)

- [ ] **M5.1** Backfill: on companion start and daily, walk the local player's match history, filter `CUSTOM_GAME`, fetch details for unknown game IDs, POST as `source: backfill`. Server verifies the reporting player is a participant.

    > **Note (product, 2026-09-08, after M0.3).** M0.4 is resolved yes — customs are in match history (17 of
    > 21 games in the 16.17 capture, queue 3100/3110/3270). Three facts from that capture pin this task down.
    >
    > 1. **The detail fetch is mandatory, not an optimisation.** The list endpoint returns `participants` and
    >    `participantIdentities` of **length 1** even for a completed 5v5 — only the local player. `teams[]`
    >    is complete, so the list can tell you a game happened and who won, but never who played. One
    >    `GET /lol-match-history/v1/games/{gameId}` per unknown custom game is the only way to the ten
    >    rosters. Budget for it: a first run on a fresh install is one request per custom in the window, so
    >    rate-limit and run it in the background, never on the path of a lobby post.
    > 2. **Stat keys differ from the eog block.** Match detail is camelCase
    >    (`kills`, `deaths`, `goldEarned`, `totalMinionsKilled`) and `teams[].win` is the string
    >    `"Win"`/`"Fail"`; the eog block is uppercase (`CHAMPIONS_KILLED`) with `WIN` as `0 | 1`. Backfill
    >    needs its own mapper into the same payload, not a reuse of M2.10's eog mapper.
    > 3. **Aborted games look like real ones in the list.** `endOfGameResult: "Abort_TooFewPlayers"` came back
    >    with one participant and one team. Drop anything that is not `GameComplete` with ten participants;
    >    the M2.5 rating gate catches the rest.
    >
    > How far back the window reaches is unknown — **M5.6**. Until that is answered, the honest claim is
    > "every custom still in the history of someone who runs the companion", which is what
    > `00-product.md` now says.
- [ ] **M5.2** Rating rebuild: `pnpm --filter web rebuild-ratings` folds every game in `started_at` order from seeds. Run after any backfill batch. Idempotent.
- [ ] **M5.3** Seasons: admin starts a new season; ratings copy `mu` and reset `sigma`; leaderboard and pages are season-aware.
- [ ] **M5.4** Stats pages: win rate by role, by side, by duo pairing (min five games together), average game length, longest streaks. Awards at season end: most improved, best off-role, cursed duo.
- [ ] **M5.5** Missed-game report: a page listing lobbies that reached `in_game` but never `finished`, so someone knows the companion rule was broken that night.
- [ ] **M5.6** Find out how far back match history goes. M0 only ever read the default window (`begIndex=0&endIndex=20`, which returned 21 games, inclusive) and never paged past it, so the reach of backfill is a guess. Walk `begIndex` back in pages of 20 on a real client until the client stops returning games or starts erroring, and write the answer into `03-lcu-reference.md`: how many games deep it goes, whether `gameCount` is the true total or just the window, and what an over-the-end request does (empty `games[]`, 400, or a repeat of the last page).

    > **Why (product).** The product doc promises backfill "recovers it" when the companion misses a game.
    > If the window is 21 games, that promise holds for about two nights, not for the season, and the
    > sentence has to change. This is a two-hour read against a live client that decides whether a
    > paragraph of the product doc is true.
    >
    > **Acceptance check.** `03-lcu-reference.md`'s match-history row states the observed depth with a date
    > and patch, and the over-the-end behaviour. If the depth is shallower than a season, add a note to
    > M5.1 capping the walk and open a product task to rewrite the backfill paragraph in `00-product.md`.

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
