# Customs Night companion

This little app watches your League client and tells the bot who is in the lobby and who won, so nobody
has to pick teams or report scores. It only reads the client — it never plays for you and never clicks
anything in a game.

## 1. Download it

Get `CustomsNight.exe` from the link in the group chat —
<https://github.com/suyaser/kustom-releases/releases/latest/download/CustomsNight.exe>, which always
gives you the newest one — and put it somewhere you will find it again. Your desktop is fine. You do not
need a GitHub account.

Windows may say it does not recognise the app. Click **More info**, then **Run anyway**. It says that
about anything that is not from a big company.

## 2. Paste your token

Double-click it. The first time, it asks for a token. If it is your first time, join one of our custom
lobbies first so the bot knows you exist, then ask for the token. Whoever runs the admin page makes one for
you and sends it over — ask them for it. Paste it in and press Enter. You will not see it as you type; that
is on purpose.

It remembers the token, so this is the only time you do this.

## 3. Leave it running

That is the whole job. Play League as usual. When you are in a custom lobby with the others, the teams
show up in Discord on their own, and the result lands on the site when the game ends.

Keep the window open while you play. Closing it breaks nothing — you just stop being the one reporting —
but if nobody has it open when a game ends, that game is not counted.

## If something looks wrong

The app writes down everything it did. Press Windows+R, paste `%APPDATA%\customs-night\logs`, press
Enter, and send the newest file to whoever set this up. There are no passwords in it.

Your token is in `%APPDATA%\customs-night\config.json`. Do not paste that file anywhere; it is yours.

---

## Building it (for us)

Everything above the rule is the friend-facing copy from the M2.6 brief in `docs/02-milestones.md`, verbatim;
`build/publish.ts` ships it beside the download as `README.txt`. Change it there and here together, or not at
all. What follows is for whoever builds and publishes the exe.

```
src/main.ts          startup, flags (--version, --help), signals
src/config.ts        %APPDATA%\customs-night\config.json, the first-run prompt, DEFAULT_API_BASE
src/connection.ts    the state machine: disconnected -> connected -> watching, reconnect forever
src/lobbyWatcher.ts  POST /api/companion/lobby on every roster change (M2.2)
src/gameWatcher.ts   end-of-game capture, disk queue, POST /api/companion/game (M2.3)
src/rankSync.ts      own rank every 6 h, other ranks when the server asks (M2.4)
src/log.ts           daily JSON log file (debug) plus the console (info)
build/               the release build (M2.6): bundle, exe, publish
```

### Running from source

```
pnpm --filter companion dev            # tsx src/main.ts; API origin defaults to http://localhost:3000
CUSTOMS_NIGHT_CONFIG_DIR=/tmp/cn pnpm --filter companion dev   # a throwaway config directory
CUSTOMS_NIGHT_LOG_LEVEL=debug pnpm --filter companion dev      # everything the file gets, on the console too
```

### Building the exe

One file, `dist/CustomsNight.exe`, no installer, no sidecar. The version is `package.json` `version`.

```
pnpm --filter companion bundle       # esbuild: src/main.ts + workspace deps -> dist/customs-night.cjs
pnpm --filter companion build:win    # bundle, then Node SEA -> dist/CustomsNight.exe + CustomsNight.exe.sha256
pnpm --filter companion build:host   # the same, for this machine (macOS/Linux): a runnable check of the pipeline
pnpm --filter companion publish:gh   # GitHub release v<version> with the exe, its hash and README.txt
pnpm --filter companion release      # build:win, then publish:gh
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

### Publishing

Releases are GitHub release assets on the public repo `suyaser/kustom-releases` (the app repo stays
private; the Supabase bucket could not take a 90 MB object on the Free plan). One release per version, tag
`v<version>`, assets `CustomsNight.exe`, `CustomsNight.exe.sha256` and `README.txt`. The link for the group
chat never changes:

```
https://github.com/suyaser/kustom-releases/releases/latest/download/CustomsNight.exe
```

`pnpm --filter companion publish:gh` runs `gh release create` (the script is `publish:gh` because pnpm intercepts a script named `publish`) with the `gh` CLI's own login (`gh auth login`
once; no token variable). If `gh` is not logged in it prints the exact command and exits 1. Bump `version`
in `package.json` before a release: a tag that already exists is refused by GitHub, which is the point.

### Tests

`pnpm --filter companion test` runs against the in-process fake client and fake API (no League, no network).
`build/bundle.test.ts` bundles to a temp file and runs it under plain `node` with `--version` and `--help`,
so the packaging path is checked on every machine; the exe itself only runs on Windows.
