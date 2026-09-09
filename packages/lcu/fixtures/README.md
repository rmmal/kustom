# LCU fixtures

Raw responses captured from a running League client by `pnpm --filter @customs/lcu smoke`, and WebSocket
events captured by `pnpm --filter @customs/lcu record-ws`. Unit tests and the M0.3 zod schemas run against
these, never against a live client, so CI stays green without League installed.

## Layout

```
fixtures/
  <patch>/                      first two components of the client version, e.g. 16.17
    manifest.json               what the smoke run saw: version, TLS mode that worked, one row per endpoint
    <endpoint-id>.json          one envelope per endpoint (ids are in src/endpoints.ts, READ_ENDPOINTS)
    <endpoint-id>--<state>.json the same endpoint captured in another client state, next to the base file; the
                                base file is what `smoke --diff` compares against, the overlay is what a test
                                that needs that state reads (`readFixture(patch, 'lobby--two-players')`).
                                States so far: `--other` (another player's puuid, from `--puuid` / `--riot-id`),
                                `--two-players` (a custom lobby with a second human), `--in-lobby` (the
                                gameflow session while in the lobby after a game), `--spectator` (a lobby with
                                the second human in the spectator slot), `--ws-cached` (ranked stats as pushed
                                over the socket). Write the state as one or two words that name what the client
                                was doing, never a date. An overlay taken from a WebSocket payload rather than a
                                GET has `method: "WS"` and a `note` saying which event.
    live-client-data.json       the in-game live data server (port 2999), only meaningful when captured mid-game
    ws-events.ndjson            one JSON object per line: { ts, topic, uri, eventType, data }
                                or { ts, topic, uri, eventType, redacted: true } for sensitive URIs (no data)
                                or { ts, reason, dropped: true, redacted: true, uri } / { ..., frame } / { ..., preview }
                                for frames the parser refused (scrubbed the same way; never the raw text)
```

## Envelope

Each `<endpoint-id>.json` wraps the raw body so a 404 or a non-JSON reply is recorded too:

```json
{
  "id": "lobby",
  "method": "GET",
  "path": "/lol-lobby/v2/lobby",
  "status": 404,
  "capturedAt": "2026-09-08T18:00:00.000Z",
  "patch": "16.17",
  "clientVersion": "16.17.812.4632",
  "contentType": "application/json",
  "body": { "errorCode": "RPC_ERROR", "httpStatus": 404, "message": "..." }
}
```

`body` is the parsed JSON exactly as returned. When the body was not JSON, `bodyText` holds the text instead.
Schemas in M0.3 parse `envelope.body`, not the envelope.

Write fixtures (M4.1) come from `pnpm --filter companion verify-commands`, never from `smoke`: `method` is
`POST`, `request` holds the scrubbed request body (absent for switch-teams, which sends none), `note` says
which probe, and `contentType` is null (the write helpers do not keep it). Ids: `create-lobby`,
`create-lobby--draft`, `lobby-invitations`, `lobby-invitations--by-puuid`, `switch-teams-v1`,
`switch-teams-v2`, `switch-teams--full-side`. None exist yet; the first live run on a patch adds them.

## Captures

- `16.17` (2026-09-08, macOS, TLS pinned to riotgames.pem on every run). The smoke fixtures and `manifest.json`
  are the user's run on the end-of-game screen of a solo custom vs five bots (game 4000969091), so
  `gameflow-phase` is `"EndOfGame"`, `gameflow-session` is a 200 carrying that game id and
  `eog-stats-block` is a 200 (six players, one human). Overlaid from later `smoke --out` runs against the
  same client, same patch: `lobby.json` (200, the custom lobby the client returned to after the end-of-game
  screen; at that moment `eog-stats-block` was 404 again), `match-detail.json` (pinned with
  `--game-id 4000769615`, a completed 5v5 custom with ten human participants), and the `--other` files
  (`--puuid` of a non-friend taken from that game). `ws-events.ndjson` is the user's recording from
  16:33 to 16:54 UTC covering two custom lobbies and games (the first dropped by the server as
  `TerminatedInError`, the second played out), trimmed to the URIs the companion reads
  (`/lol-lobby/`, `/lol-gameflow/`, `/lol-end-of-game/`, `/lol-pre-end-of-game/`, `/lol-matchmaking/`,
  the gsm `game-update` messages): 225 of 1310 lines; the rest was chat, friend presence, clash, champion
  select and skin payloads. Every file was written by the scripts; none was edited by hand.
- `16.17`, second window (2026-09-08 17:31-17:32 UTC, same client, same patch, the user's run). The user
  invited a friend from the client UI into the lobby `lobby.json` was taken in (same `partyId`), and the
  friend accepted while `record-ws` ran and joined as a player on team 200; `smoke --out` then captured
  `lobby--two-players.json` (200, two humans in `members[]`, one puuid in each of `customTeam100`/`200`,
  `customSpectators` empty, a third invite still `Pending`) and `gameflow-session--in-lobby.json` (200,
  phase `Lobby`, still carrying the previous game's id and roster). The recorder's 340 new lines were
  trimmed with the same URI rule (plus `/riot-messaging-service/.../parties/` notifications, which are
  written data-less anyway) to 42 lines and appended to `ws-events.ndjson` (267 lines, 0.85 MB); they cover
  the invite going `Pending -> Accepted`, the join, the friend switching to blue and back, and nine
  `gameflow-session` updates. Both windows are listed in `manifest.json` `overlays`. Every file went through
  `scrubValue` a second time on ingest, which changed nothing.
- `16.17`, third window (2026-09-08 17:38-17:39 UTC, same lobby, the user's run). The friend was moved to the
  spectator slot at 17:38:57 and back to team 200 at 17:39:26. 24 of the recorder's 47 lines were kept by the
  same rule and appended (`ws-events.ndjson` is now 291 lines, 0.94 MB: the next window starts a new file,
  see Rules). Two overlays were written **from WebSocket payloads, not GETs**, and say so with
  `method: "WS"` and a `note`: `lobby--spectator.json` (the 17:38:57.320 lobby `Update`: friend in
  `members[]` with `isSpectator: true` and in `customSpectators[]`; the M2.13 fixture) and
  `ranked-stats-by-puuid--ws-cached.json` (a `/lol-ranked/v1/cached-ranked-stats/{puuid}` `Update` for the
  friend, same shape as the GET). Re-scrub on ingest changed nothing.
- HTTP bodies are scrubbed like events (`scrubValue`): `mucJwtDto`, `multiUserChatPassword`, `password`,
  `spectatorKey`, `encryptionKey` and any other credential-looking key read `[redacted]`, including inside
  JSON carried as a string. The smoke table notes which endpoints had something redacted. Files captured by
  a smoke build that did not scrub yet were passed through the same `scrubValue` afterwards. A guard test in
  `src/schemas.test.ts` fails when any file here carries such a key with a real value.
- `manifest.json` records the run that produced the base files; its `overlays` key lists the files that were
  copied in from later `smoke --out` runs, with each file's own `capturedAt` and path, and one entry per
  later `record-ws` window appended to `ws-events.ndjson` (`capturedAt`/`capturedUntil` of the kept lines).
- `ws-events.ndjson` is one file with every window appended in time order; tests that count lobbies or games
  select a window by `ts` (`schemas.test.ts`). Keep it under 1 MB: when the next window would cross that,
  start `ws-events--<state>.ndjson` instead of appending.

## Rules

- Never hand-edit a fixture. Re-run the smoke script on the new patch and commit the new directory.
- `smoke --diff` compares fresh responses with the newest directory here; run it after every patch.
- Fixtures contain real PUUIDs and Riot IDs of the group. The repo is private; keep it that way.
- `ws-events.ndjson` is scrubbed before it is written (`src/scrub.ts`): events under `/lol-rso-auth`,
  `/lol-login`, `/riotclient/auth`, `/lol-chat` and any URI mentioning auth/token are stored without `data`,
  and keys such as `token`, `password`, `cookie`, `authorization` inside other payloads are replaced with
  `[redacted]`. The recorder prints how many were redacted. Still skim the file before committing.
- `swagger-*.json` and `openapi-*.json` are git-ignored (multi-MB); M0.3 extracts what it needs into schemas.
- The OpenAPI documents (`swagger-v2.json`, `openapi-v3.json`) are large. They are worth keeping for one
  patch as the source of truth for paths; drop older copies when a new one lands.
