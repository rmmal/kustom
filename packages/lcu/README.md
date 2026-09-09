# @customs/lcu

The only code in the repo that talks to the League client (`https://127.0.0.1:<port>`, `wss://` on the same
port). Everything else goes through this package. Reference: `docs/03-lcu-reference.md`.

```
src/lockfile.ts     discoverLockfile(): override path -> LCU_LOCKFILE_CANDIDATES -> platform default -> process list (win32); parses LeagueClient:<pid>:<port>:<password>:https. createLockfileDiscovery() is the same with memory for a long-running caller
src/processDiscovery.ts  the win32 process-list fallback (M2.19): PowerShell Get-CimInstance (then wmic) for LeagueClientUx.exe, lockfile beside its ExecutablePath, else --app-port/--remoting-auth-token off its CommandLine. Never shells out in tests
src/auth.ts         Basic auth header (riot:<password>) and URL helpers
src/tls.ts          TLS modes: pinned to certs/riotgames.pem (default), pinned + legacy digests, insecure
src/client.ts       LcuClient: get/post/put/delete with a zod schema; never throws, returns { ok, status, json } or a typed failure
src/socket.ts       LcuSocket: [5, topic] subscribe, [8, topic, { data, eventType, uri }] events; remembers subscriptions across connect()
src/endpoints.ts    the endpoint catalogue (READ_ENDPOINTS, WRITE_ENDPOINTS, LIVE_CLIENT_DATA)
src/schemas.ts      one zod schema per verified endpoint, written from fixtures/16.17 and tested against them (schemas.test.ts)
src/fixtures.ts     fixture layout, patch naming, top-level shape diff
src/mapper.ts       mapLobby / mapEog / mapRank: the one client-shape-to-companion-payload mapping (spec: packages/db/src/schemas/companion.contract.test.ts); depends on @customs/db/schemas
src/cli/smoke.ts    pnpm --filter @customs/lcu smoke [--diff] [--insecure] [--lockfile p] [--puuid p] [--riot-id N#TAG] [--game-id id]
src/cli/record-ws.ts  pnpm --filter @customs/lcu record-ws [--insecure] [--lockfile p] [--topic t]
src/test-support/   in-process fake client (HTTPS + WS, self-signed test certs) used by tests
fixtures/           captured responses per patch (see fixtures/README.md)
certs/              Riot's root certificate (see certs/README.md)
```

Tests never touch a live client: `pnpm --filter @customs/lcu test`. They also pass with League running: the
lockfile tests inject `readFile`, and the smoke test sets `LCU_LOCKFILE_CANDIDATES` to a path that does not
exist so the real install is never read. Set that variable yourself (path-delimiter-separated list) to point
discovery at a non-default install without `--lockfile`.

Rules: read and lobby automation only. No champion select, no in-game input, no queue automation. Every response
is validated with zod at the call site; a mismatch is logged with the endpoint and returned as a failure.
