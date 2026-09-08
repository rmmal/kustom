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
