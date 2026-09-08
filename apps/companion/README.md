# apps/companion

The process a friend leaves running: it watches the local League client through `@customs/lcu` and posts
lobbies, results and ranks to the API with a bearer companion token. The friend-facing copy is
`README-friends.md` (product copy, shipped verbatim beside the download as `latest/README.txt`); this file is
for us.

```
src/main.ts          startup, flags (--version, --help), signals
src/config.ts        %APPDATA%\customs-night\config.json, the first-run prompt, DEFAULT_API_BASE
src/connection.ts    the state machine: disconnected -> connected -> watching, reconnect forever
src/lobbyWatcher.ts  POST /api/companion/lobby on every roster change (M2.2)
src/gameWatcher.ts   end-of-game capture, disk queue, POST /api/companion/game (M2.3)
src/rankSync.ts      own rank every 6 h, other ranks when the server asks (M2.4)
src/log.ts           daily JSON log file (debug) plus the console (info)
build/               the release build (M2.6): bundle, exe, upload
```

## Running from source

```
pnpm --filter companion dev            # tsx src/main.ts; API origin defaults to http://localhost:3000
CUSTOMS_NIGHT_CONFIG_DIR=/tmp/cn pnpm --filter companion dev   # a throwaway config directory
CUSTOMS_NIGHT_LOG_LEVEL=debug pnpm --filter companion dev      # everything the file gets, on the console too
```

## Building the exe

One file, `dist/customs-night-<version>.exe`, no installer, no sidecar. Version is `package.json` `version`.

```
pnpm --filter companion bundle       # esbuild: src/main.ts + workspace deps -> dist/customs-night.cjs
pnpm --filter companion build:win    # bundle, then Node SEA -> dist/customs-night-<version>.exe (+ .sha256)
pnpm --filter companion build:host   # the same, for this machine (macOS/Linux): a runnable check of the pipeline
pnpm --filter companion release      # build:win, then upload to the public bucket; prints the public URLs
```

How it works (`build/sea.ts`): the bundle is a single CommonJS file with the API origin, the version and
Riot's root certificate baked in as esbuild `define`s. `node --experimental-sea-config` turns it into a
single-executable blob, and `postject` injects the blob into a stock `node.exe` (its Authenticode signature
is stripped first). The Node release is pinned in `build/config.ts` (`NODE_RELEASE`), and the build downloads
that exact release from nodejs.org, once, into `build/cache/` (gitignored), verified against
`SHASUMS256.txt`: a host copy to make the blob (Node requires the blob and the binary to be the same
version) and the `win-x64/node.exe` to inject into. On a Windows build host the one `node.exe` serves both.

Built on this Mac (2026-09-08), cross-target from macOS: `build:host` produced a macOS binary of the same
bundle that reached `watching` against the live client here, and the Windows exe's PE header, stripped
signature, fuse and blob were checked by hand. The first run on the Windows PC is the M2.6 acceptance and is
written up in `docs/02-milestones.md` when it happens. The exe is not code-signed: SmartScreen's "More info,
Run anyway" is a README sentence.

The API origin defaults to the deployed Vercel URL (`RELEASE_API_BASE`); `CUSTOMS_NIGHT_API_BASE` overrides it
for a build against another deployment. A `config.json` with its own `apiBase` always wins over the baked one.

## Publishing

`pnpm --filter companion release` (or `upload` after a `build:win`) needs
`CUSTOMS_NIGHT_RELEASE_SERVICE_ROLE_KEY` in the environment (see `.env.example`). It creates the public bucket
`releases` on the hosted project if missing and upserts three objects:

```
https://ubwpmxujdzssfqfbrbej.supabase.co/storage/v1/object/public/releases/latest/CustomsNight.exe
https://ubwpmxujdzssfqfbrbej.supabase.co/storage/v1/object/public/releases/v<version>/CustomsNight.exe
https://ubwpmxujdzssfqfbrbej.supabase.co/storage/v1/object/public/releases/latest/README.txt
```

The project ref is hard-coded in `build/config.ts` and the upload refuses any other. Bump `version` in
`package.json` before a release so the versioned object is new; `latest` is overwritten. The upload runs
with no timeout (undici) because the exe is 90 MB and an uplink can be slow; the project's **global file
size limit** must allow it (Free plan caps it at 50 MB, which returns `413 EntityTooLarge`; Pro lets it be
raised in Storage settings). The README object is uploaded first so a transport or auth problem shows before
the large one.

## Tests

`pnpm --filter companion test` runs against the in-process fake client and fake API (no League, no network).
`build/bundle.test.ts` bundles to a temp file and runs it under plain `node` with `--version` and `--help`,
so the packaging path is checked on every machine; the exe itself only runs on Windows.
