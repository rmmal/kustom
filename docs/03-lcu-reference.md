# League Client (LCU) reference

The League client runs a local HTTPS server with a self-signed certificate and a WebSocket event stream. This is
the only data source for the project. It is unofficial: endpoints can change on any patch. Everything that talks
to it lives in `packages/lcu`.

**Status column:** `verified` means exercised against a live client on the listed patch and the response shape is
pinned in a zod schema plus a fixture in `packages/lcu/fixtures/`. `unverified` means from memory or community
docs. **M0 exists to turn every row we need for M2 to `verified`.** Do not build on an unverified row.

## Connecting

| Item | Detail | Status |
|---|---|---|
| Lockfile | `<install dir>/lockfile`, content `LeagueClient:<pid>:<port>:<password>:https`. Default install `C:\Riot Games\League of Legends\lockfile` on Windows, `/Applications/League of Legends.app/Contents/LoL/lockfile` on macOS. M0 can run on a Mac with League installed; packaging targets Windows. Evidence so far (2026-09-08, client 16.17.812.4632, not yet read while running): this Mac's `LeagueClient.log` says the client is `Running from cwd '/Applications/League of Legends.app/Contents/LoL'`, which is where the lockfile is written. `discoverLockfile` in `packages/lcu` tries a configured override, then the platform default. | unverified |
| Process args fallback | On Windows, the `LeagueClientUx.exe` command line contains `--app-port=` and `--remoting-auth-token=`. Use when the install dir is unknown. Also present on macOS: this Mac's `LeagueClientUx.log` (2026-09-08) shows `--app-port=60969` on the Ux command line, distinct from the Riot Client's `--riotclient-app-port`. Not implemented yet (M2). | unverified |
| Auth | HTTP Basic, user `riot`, password from lockfile. Accept the self-signed cert (pin Riot's root, `riotgames.pem`, if practical; otherwise `rejectUnauthorized: false` on loopback only). Riot's root is vendored at `packages/lcu/certs/riotgames.pem` (fetched from `static.developer.riotgames.com/docs/lol/riotgames.pem`, SHA-256 fingerprint in `certs/README.md`). It is SHA-1 self-signed; Node's default OpenSSL level accepts that for a trust anchor (checked locally with a synthetic chain) but rejects a SHA-1 signed *leaf*, which `{ mode: 'pinned', legacyDigests: true }` (`DEFAULT@SECLEVEL=0`) allows. Whether the client's leaf is SHA-1 and whether pinning works at all is unknown until M0.2: `smoke` probes pinned, pinned+legacy, insecure in that order and prints which one answered. | unverified |
| WebSocket | `wss://127.0.0.1:<port>` with the same basic auth. Send `[5, "OnJsonApiEvent"]` to subscribe to everything, or `[5, "OnJsonApiEvent_lol-lobby_v2_lobby"]` for one URI. Messages are `[8, "OnJsonApiEvent...", { data, eventType: "Create"|"Update"|"Delete", uri }]`. `[6, topic]` unsubscribes. Subprotocol: `packages/lcu` offers none by default (some community Node clients offer `wamp`; the Python ones offer nothing); `record-ws` prints what the server negotiated. The client is believed to send one empty frame after a subscribe; `parseFrame` treats empty frames as no-ops, not drops. | unverified |

## Endpoints we use

| Purpose | Method and path | Notes | Status |
|---|---|---|---|
| Client version | `GET /lol-patch/v1/game-version` | Believed to return a bare JSON string such as `"16.17.812.4632"`. `smoke` uses the first two components (`16.17`) as the fixture directory name. | unverified |
| Client version (fallback) | `GET /system/v1/builds` | Believed to return an object with `version`. `smoke` falls back to it when `game-version` fails, then to `unknown-<date>`. | unverified |
| Local player | `GET /lol-summoner/v1/current-summoner` | `puuid`, `summonerId`, `gameName`, `tagLine`. | unverified |
| Lookup by Riot ID | `GET /lol-summoner/v1/alias/lookup?gameName=&tagLine=` | Returns `puuid`. Then `GET /lol-summoner/v2/summoners/puuid/{puuid}` for `summonerId` (invites need it). | unverified |
| Own rank | `GET /lol-ranked/v1/current-ranked-stats` | `queueMap.RANKED_SOLO_5x5.{tier, division, leaguePoints}`, also `RANKED_FLEX_SR`. | unverified |
| Rank of another player | `GET /lol-ranked/v1/ranked-stats/{puuid}` | Same shape. Used to seed unknown lobby members. | unverified |
| Gameflow phase | `GET /lol-gameflow/v1/gameflow-phase` | One of `None, Lobby, Matchmaking, ReadyCheck, ChampSelect, GameStart, InProgress, WaitingForStats, PreEndOfGame, EndOfGame`. WS event `OnJsonApiEvent_lol-gameflow_v1_gameflow-phase`. | unverified |
| Gameflow session | `GET /lol-gameflow/v1/session` | `gameData.gameId`, `gameData.queue`, `map`. Gives the game ID before end of game. | unverified |
| Lobby | `GET /lol-lobby/v2/lobby` | `partyId`, `members[] { puuid, summonerId, summonerName, teamId, isLeader, isSpectator }`, `gameConfig { customLobbyName, customTeam100[], customTeam200[], customSpectators[], mapId, gameMode, queueId }`, `localMember`. 404 when not in a lobby. WS event `OnJsonApiEvent_lol-lobby_v2_lobby`. | unverified |
| Create custom lobby | `POST /lol-lobby/v2/lobby` | Body: `{ customGameLobby: { configuration: { gameMode: "CLASSIC", mapId: 11, mutators: { id: 1 }, spectatorPolicy: "AllAllowed", teamSize: 5, gameServerRegion: "" }, lobbyName, lobbyPassword }, isCustom: true }`. `mutators.id` 1 = blind, 2 = draft, 4 = all random, 6 = tournament draft. Verify current values. | unverified |
| Invite | `POST /lol-lobby/v2/lobby/invitations` | Body `[{ toSummonerId }]`. | unverified |
| Switch side | `POST /lol-lobby/v1/lobby/custom/switch-teams` | Toggles the local player between 100 and 200. Exact path needs confirming; alternatives seen in the wild: `/lol-lobby/v2/lobby/custom/switch-teams`. | unverified |
| End of game stats | `GET /lol-end-of-game/v1/eog-stats-block` | Available during `EndOfGame` (and shortly after). `gameId`, `gameLength`, `gameType` (`CUSTOM_GAME`), `queueId`, `teams[] { teamId, isWinningTeam, players[] { puuid, summonerName, championId, stats { KILLS, DEATHS, ASSISTS, GOLD_EARNED, TOTAL_DAMAGE_DEALT_TO_CHAMPIONS, MINIONS_KILLED, NEUTRAL_MINIONS_KILLED, WIN } } }`, `localPlayer`. Stat keys are uppercase strings. WS event `OnJsonApiEvent_lol-end-of-game_v1_eog-stats-block`. | unverified |
| Match history list | `GET /lol-match-history/v1/products/lol/{puuid}/matches?begIndex=0&endIndex=20` | `games.games[] { gameId, gameType, queueId, gameCreation, gameDuration, participants[], participantIdentities[] }`. **Whether custom games (`gameType: CUSTOM_GAME`) appear here is the single most important thing M0 must confirm.** They show in the client's match history tab, which suggests yes. | unverified |
| Match detail | `GET /lol-match-history/v1/games/{gameId}` | Full participant stats. Used for backfill. | unverified |
| Live client data (in game) | `https://127.0.0.1:2999/liveclientdata/allgamedata` | Different server, only while in game. Not needed unless eog capture proves unreliable. | unverified |
| Client OpenAPI | `GET /swagger/v2/swagger.json`, `GET /swagger/v3/openapi.json` | Served only when swagger is enabled in the client; `smoke` probes both and saves whatever answers. Neither is needed at runtime. | unverified |

## Tooling (`packages/lcu`, M0.1)

- `pnpm --filter @customs/lcu smoke` finds the lockfile, probes the TLS modes, reads the version, then GETs every row in
  "Endpoints we use" (read-only ones; path parameters are filled from `current-summoner` and the first
  `CUSTOM_GAME` in the local player's match history) and writes `packages/lcu/fixtures/<patch>/<endpoint-id>.json`
  plus `manifest.json`. Exit 2: no lockfile. Exit 3: lockfile present but no TLS mode reached the client.
  `--diff` compares fresh top-level key sets and statuses with the newest saved fixtures instead of writing
  (exit 1 when anything differs). `--puuid <puuid>` and `--riot-id Name#TAG` add probes for another player
  (question 4 below). `--insecure` skips pinning. `--live-port` redirects the in-game live data probe (tests
  point it at a dead port). Layout in `packages/lcu/fixtures/README.md`.
- `pnpm --filter @customs/lcu record-ws` subscribes to `OnJsonApiEvent` (or `--topic` ones) and appends every
  event to `fixtures/<patch>/ws-events.ndjson` until Ctrl-C, reconnecting if the client restarts. On exit it
  prints a count per URI. Events are scrubbed before they touch disk (`src/scrub.ts`): `/lol-login`,
  `/lol-rso-auth`, `/riotclient/auth`, `/lol-chat` and any URI mentioning auth/token are written without
  `data`; credential-looking keys elsewhere become `[redacted]`. The summary says how many were redacted.
- The TLS probe only steps down from `pinned` to `pinned+legacy` to `insecure` on a certificate/handshake
  error. A refused or timed-out connection stops the probe (exit 3) so a client that is still starting is
  never recorded as "needed insecure".
- Both scripts are GET-only. Nothing in M0.1 creates a lobby, invites, or sends anything but subscribe frames.

## Behaviors to confirm in M0

1. Custom games in match history: yes/no, and how far back (client shows a limited window).
2. Does `eog-stats-block` persist after the player clicks past the end-of-game screen? If not, the companion must
   react to the WS event, not poll.
3. Does `lobby.members[].teamId` reflect sides in a custom lobby, or only `gameConfig.customTeam100/200`?
4. `ranked-stats/{puuid}` for another player: works, or returns empty unless they are a friend?
5. Switch-side endpoint path and whether it works when the target side is full.
6. Invite by `summonerId` still works, or is `puuid` required now?
7. WebSocket event names and whether the `[5, ...]` subscription format is unchanged.
8. Certificate: does pinning Riot's root work, or is loopback insecure mode required?

## Riot policy notes

- The LCU is not an official API. Riot tolerates read and lobby automation and explicitly forbids automating
  gameplay. Register the project in the Riot developer portal as a personal app that uses the LCU; it is free and
  is what Riot asks.
- Vanguard does not interfere with local API reads.
- Do not display other players' custom match history publicly beyond our own group's site. Keep the site unlisted.

## Community references

- https://riot-api-libraries.readthedocs.io/en/latest/lcu.html
- https://github.com/topics/lcu-api (schema dumps such as `lcu-schema` and `LCU-Explorer` show the live OpenAPI on a running client at `/swagger/v3/openapi.json` when `--enable-swagger` is set)
- The client's own OpenAPI: `GET /swagger/v2/swagger.json` on a running client, when enabled. M0 should try it first; it is the fastest way to verify paths.
