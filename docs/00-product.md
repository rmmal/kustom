# Product

## One line

A referee for our nightly League of Legends customs: it sees who is in the lobby, splits them into two fair teams
with real roles, keeps ratings from actual results, and ends the argument before it starts.

The product is called **Kustom**; `Customs Night` is the codename used in this repo.

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
6. If more than ten showed up, the server posts who sits: whoever has played most tonight, and between
   equals whoever has gone longest without sitting. On the first game of a night nobody has done either, so
   the post says as much — somebody has to be first — and from the second game on the rotation has real
   history to work from.

## The two things a person can change

Everything else happens without anybody touching it. These two exist because the docs already accepted them,
and both are one tap:

- **Reroll** (M3.2, admins). Teams are posted and somebody wants a different night. One tap promotes the
  second split, one more promotes the third, and then it stops: three splits come out of the balancer and
  there is no fourth. A reroll posts a new message in Discord saying which reroll it is; it never edits the
  old one, never changes who is playing, and never picks at random. When the list runs out, the way to get
  different teams is to change who is in the lobby, which rebalances by itself.
- **Role for tonight** (M3.6). A friend taps a role on the tonight page and the balancer treats it as their
  main for the rest of the night, with their usual main as the backup. It is a preference, not a lock: the
  teams can still put them somewhere else and the explanation line says so when they do. A tap after teams
  are already posted is kept for the next game rather than redoing the teams people have already moved for —
  the referee does not reopen a decision because one player changed their mind.

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

## The numbers on the screen

The model keeps one rating per player, `{ mu, sigma }` — `mu` is what it thinks you are, `sigma` is how sure
it is. Two numbers come out of that, and they have fixed names everywhere in the product:

- **Rating** is `round(mu * 60)`. It sits beside your name in the teams embed, the result embed and the
  tonight page, and it is what the balancer works from.
- **Proven** is `round(ordinal * 60)`, where `ordinal = mu - 2 * sigma`. It is the leaderboard's number. The
  board sorts on Proven and shows it as the primary column, with Rating underneath in smaller type, so the
  order on the page always matches the number the page is showing. Proven is deliberately cautious: a new
  player sits below their Rating until the board has watched about 30 games. The page says that in one
  sentence rather than leaving people to guess.

A printed change is always the difference of the two displayed numbers — `1469` becoming `1512` prints
`(+43)`, never a separately rounded figure that makes the row fail to add up.

**Rating changes do not sum to zero across the two teams.** Movement scales with how unsure the model is
about each player, so five players it barely knows move further than five it has watched for a month: a
result can be `-228` on one side and `+231` on the other. Both sides were rated correctly; the totals were
never meant to match. That is why no surface ever prints a team total of rating changes — it would be a
number that looks wrong every night while being right.

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
| Seasons that carry ratings over, awards, role and duo stats | M5 |
| Tray app wrapper with auto-start | M6 |

Backfill (M5) reads the client's own match history, and M0 confirmed it can: customs are in there
(17 of 21 games in the first capture). Two details shape it. The history *list* names only the person whose
client it is, so backfill fetches each game's detail page to learn the other nine. And nobody has yet checked
how far back the window reaches (M5.6), so "every past custom" honestly means "every custom still in the
history of someone who runs the companion".

One admin-only piece landed earlier than that table suggests: `/admin` (M1) can already start a new
season. It does not carry anyone's rating over — everyone starts the new season unrated and the board
takes about a month of nightly games to mean anything again — so it is a thing the group decides
together, not a button someone presses to tidy up. Carrying `mu` over and resetting `sigma` is M5.3.

## Explicitly out of scope

- Any Riot public API usage. Custom match data is not available there and we do not need ranked data from it.
- Manual result reporting. If the companion misses a game, backfill (M5) recovers it.
- WhatsApp bot. There is no legitimate group-bot API. The tonight page link is the WhatsApp integration.
- Slack. Not until someone asks twice. It would be a single webhook.
- Anything touching champion select or gameplay.

## Success

- Zero team arguments in a week of nightly games.
- Lobby open to game start under three minutes.
- Every game played with a companion user present is in the database with no human action. The client
  only keeps the end-of-game stats block while that screen is up, so "present" means running at the
  final whistle. A companion that happens to be restarting right then loses the game to backfill —
  still no human action, just a day later.
- Ratings visibly converge: a player's predicted win chance across their last twenty games averages near 50%.
- A new player rises in strength faster than they rise on the board. Their Rating settles in about ten
  nightly games, but the leaderboard sorts on Proven, the deliberately cautious number
  (`ordinal = mu - 2 * sigma`), which takes roughly a month of nightly games to catch up. That is on
  purpose: the board makes you prove it.
