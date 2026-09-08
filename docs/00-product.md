# Product

## One line

A referee for our nightly League of Legends customs: it sees who is in the lobby, splits them into two fair teams
with real roles, keeps ratings from actual results, and ends the argument before it starts.

## Who it is for

Ten to twenty friends, rotating roster, ranks from Bronze to Master, some people one-trick a role. Discord for
comms, WhatsApp for "are we playing tonight". No organizer wants a job. One or two people are willing to run a
small desktop app.

## The problem

The ten to twenty minutes between "who's in?" and "lobby's up" is where arguments live. Whoever picks teams is
accused of stacking. New or rotating players make it worse because nobody agrees how good they are.

## Principles

1. **The bot is the referee.** No human picks teams. Ever.
2. **Zero input.** Nobody checks in, nobody reports results. The client already knows who is in the lobby and
   who won; the companion reads it. Any manual step will be skipped by someone, and skipped steps corrupt ratings.
3. **Fair by numbers, but explained.** Every split posts its predicted win chance, the rating gap, whether anyone
   is off-role, and the next-best alternative. "The bot is rigged" needs a number to argue with.
4. **Discord is a display, not a form.** Teams, results, and leaderboards appear where people already look. Voice
   gets split automatically. Nothing requires typing a command.

## The nightly loop

1. People gather in Discord voice as usual. The bot posts "7 around" so the WhatsApp thread has an answer.
2. Someone opens a custom lobby. Everyone joins. The lobby owner (or anyone in the lobby) runs the companion.
3. When ten are in and stable, the companion sends the roster. The server balances and posts Blue and Red with
   roles, win chance, and a one-line why. Voice channels split.
4. Players switch to their side (companion can do it for them, see M4). Game starts.
5. At end of game the companion captures the full stats block. Ratings move. Leaderboard updates.
6. If more than ten showed up, the server posts who sits next game based on who sat last.

## Worked example

The concrete version of "the bot is the referee", used as the pinned test case for the balancer
(`docs/02-milestones.md`, M1.4, has the full arithmetic and the expected second and third splits).

Ten friends are in the lobby on an ordinary Tuesday. They have been playing for a few weeks, so their ratings
have drifted off the rank they were seeded from.

| Name | Rank | Rating | Main | Backup |
|---|---|---|---|---|
| Bilal | Platinum I | 1713 | adc | mid |
| Hana | Gold III | 1434 | top | mid |
| Iris | Platinum IV | 1578 | jungle | top |
| Karim | Gold I | 1551 | mid | adc |
| Lena | Master | 2088 | adc | jungle |
| Nadia | Silver III | 1266 | mid | support |
| Omar | Gold II | 1469 | top | support |
| Rami | Platinum III | 1638 | jungle | mid |
| Theo | Gold III | 1419 | support | adc |
| Yuki | Bronze II | 1134 | support | top |

Nobody types anything. This appears in Discord:

| | Blue | Red |
|---|---|---|
| top | Hana | Omar |
| jungle | Iris | Rami |
| mid | Karim | Nadia |
| adc | Bilal | Lena |
| support | Theo | Yuki |

> Blue favored 54%. Everyone on a main role. Gap 100. Next best: swap Hana and Omar, gap 170.

Everyone got the role they main. The two sides are 100 rating points apart out of about 7,600 a side. Lena is
the best player in the room and she is on the weaker side on paper, which is the sort of thing that used to
take ten minutes of arguing. If someone still wants a different night, reroll gives the "swap Hana and Omar"
teams instead, and then one more after that. There is no fourth.

## Features by milestone

See `02-milestones.md` for the build order. In product terms:

| Feature | Milestone |
|---|---|
| Player roster with roles, ranks read from the client | M1, M2 |
| Auto-detect the ten from the lobby | M2 |
| Balanced teams posted to Discord with explanation | M3 |
| Results and ratings captured from end-of-game, no reporting | M2, M3 |
| Tonight page and leaderboard on the web, phone-friendly | M3 |
| Companion creates the lobby and invites the ten | M4 |
| Auto side switch | M4 |
| Discord voice split and "N around" presence | M4 |
| Backfill every past custom from the client's match history | M5 |
| Seasons, awards, role and duo stats | M5 |
| Tray app wrapper with auto-start | M6 |

## Explicitly out of scope

- Any Riot public API usage. Custom match data is not available there and we do not need ranked data from it.
- Manual result reporting. If the companion misses a game, backfill (M5) recovers it.
- WhatsApp bot. There is no legitimate group-bot API. The tonight page link is the WhatsApp integration.
- Slack. Not until someone asks twice. It would be a single webhook.
- Anything touching champion select or gameplay.

## Success

- Zero team arguments in a week of nightly games.
- Lobby open to game start under three minutes.
- Every game played with a companion user present is in the database with no human action.
- Ratings visibly converge: a player's predicted win chance across their last twenty games averages near 50%.
