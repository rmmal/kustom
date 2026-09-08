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
    <endpoint-id>--other.json   the same endpoint probed for another player (--puuid / --riot-id)
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
- HTTP bodies are scrubbed like events (`scrubValue`): `mucJwtDto`, `multiUserChatPassword`, `password`,
  `spectatorKey`, `encryptionKey` and any other credential-looking key read `[redacted]`, including inside
  JSON carried as a string. The smoke table notes which endpoints had something redacted. Files captured by
  a smoke build that did not scrub yet were passed through the same `scrubValue` afterwards. A guard test in
  `src/schemas.test.ts` fails when any file here carries such a key with a real value.
- `manifest.json` records the run that produced the base files; its `overlays` key lists the files that were
  copied in from later `smoke --out` runs, with each file's own `capturedAt` and path.

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
