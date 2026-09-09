# Kustom companion

This little app watches your League client and tells the bot who is in the lobby and who won, so nobody
has to pick teams or report scores. It only reads the client — it never plays for you and never clicks
anything in a game.

## 1. Download it

Get `Kustom.exe` from the link in the group chat —
<https://github.com/suyaser/kustom-releases/releases/latest/download/Kustom.exe>, which always
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
src/backfill.ts      past customs from match history, 60 s after connect then every 6 h, via the queue (M5.1)
src/commandRunner.ts GET /api/companion/commands every 5 s while the client is up; create lobby / invite /
                     switch side through packages/lcu; ack or nack. Each kind gated on its docs/03 row (M4.1)
src/executed.ts      commands-done.json: the execute-once record a lost ack is re-sent from (M4.1)
src/verifyCommands.ts  --verify-commands: the human-run live probe of the three writes; report + fixtures (M4.1)
src/log.ts           daily JSON log file (debug) plus the console (info)
build/               the release build (M2.6): bundle, exe, publish
```

### The token prompt (M2.19)

The first Windows run of 0.1.0 saved a corrupted token: Windows Terminal wraps a paste in bracketed-paste
markers (`ESC[200~` ... `ESC[201~`), the raw-mode reader dropped the `ESC` and kept `[200~`, and the API said
401 to `[200~<token>[201~`. Since 0.1.1 the hidden prompt (`HiddenLineReader` in `src/config.ts`) swallows
whole escape sequences even across chunk boundaries, and every path the token comes in by — the hidden prompt,
a piped stdin, `--show-token`, and `config.json` itself — goes through `cleanTokenInput`, which strips escape
sequences, control characters, surrounding whitespace and quotes.

A token from the admin page is 32 random bytes as base64url: exactly 43 characters from `A-Z a-z 0-9 - _`
(`apps/web/lib/companionAuth.ts` `mintCompanionToken`; the shape is pinned in `src/config.ts` and
`config.test.ts` checks it against the same `randomBytes(32).toString('base64url')`). A paste of any other
shape gets one sentence — `That does not look like a token from the admin page (expected 43 characters,
letters, digits, - and _). Try pasting it again.` — and another go, three in all, then the companion says so
and exits. A saved `config.json` whose token has the wrong shape is treated as "no token": the prompt runs
again with `the saved token does not look like one from the admin page`, and `apiBase` is kept. That is what
fixes the PC that ran 0.1.0: start 0.1.1, paste again.

```
Kustom.exe --show-token                # echo the token as it is typed (console only; never the log)
set CUSTOMS_NIGHT_SHOW_TOKEN=1 && Kustom.exe   # the same, for a shortcut that cannot pass flags
```

`--show-token` exists for a terminal that cannot paste into a hidden prompt (some remote-desktop and
older-console setups). It changes only what the console shows while typing; the token is still never written
to the log, which knows it only as a secret to redact.

### Verifying the lobby writes (M4.1)

```
pnpm --filter companion verify-commands       # from the repo: fixtures land in packages/lcu/fixtures/<patch>/
Kustom.exe --verify-commands            # packaged: fixtures land in %APPDATA%\customs-night\fixtures\<patch>\
set CUSTOMS_NIGHT_VERIFY_COMMANDS=1 && Kustom.exe   # the same, for a shortcut that cannot pass flags
```

The three lobby writes (create, invite, switch side) are community-documented and `unverified` in
`docs/03-lcu-reference.md`, so the command runner refuses each kind (`endpoint_unverified`) until a person has
run this mode against a live client and pasted the report back. It needs the client in `None` or `Lobby`, one
friend online, no token and no API. It asks before every probe, runs one POST per kind by default (the draft
and full-side repeats are opt-in), prints request, status and body shape, and writes
`%APPDATA%\customs-night\verify-commands-<patch>-<date>.txt` plus one fixture per POST. Paste the report and the
fixtures back; the engineer writes the reference rows and flips `LOBBY_WRITE_VERIFICATION` in
`packages/lcu/src/writes.ts`. Nothing in this mode flips anything itself.

### Finding a League that is not in `C:\Riot Games` (M2.19)

Discovery is `@customs/lcu` `createLockfileDiscovery`, and runs in this order: `lockfilePath` from
`config.json`, then the path it last found through the process list, then the platform default, then — on
Windows only, and only when none of those exist — the process list: PowerShell `Get-CimInstance Win32_Process`
for `LeagueClientUx.exe` (`wmic` if PowerShell cannot start), the lockfile beside its `ExecutablePath`, and
failing that `--app-port=` / `--remoting-auth-token=` off its `CommandLine`. The shell-out runs at most once
per 15 s and never throws; if it fails, the companion keeps polling the paths. `waiting for the League client`
prints what was tried plus `If League is installed somewhere else, add lockfilePath to config.json` whenever
no `lockfilePath` is configured:

```json
{ "apiBase": "https://kustom-delta.vercel.app", "companionToken": "...", "lockfilePath": "D:\\Games\\Riot Games\\League of Legends\\lockfile" }
```

The manual path always wins and is the way out if the process list is not available to a non-admin user (a
client started elevated hides its `ExecutablePath` and `CommandLine`). Status of the fallback is
`observed on Windows: pending` in `docs/03-lcu-reference.md` until a Windows run with a custom install shows
`League client found at a non-default install` in the log.

### Running from source

```
pnpm --filter companion dev            # tsx src/main.ts; API origin defaults to http://localhost:3000
CUSTOMS_NIGHT_CONFIG_DIR=/tmp/cn pnpm --filter companion dev   # a throwaway config directory
CUSTOMS_NIGHT_LOG_LEVEL=debug pnpm --filter companion dev      # everything the file gets, on the console too
```

### Building the exe

One file, `dist/Kustom.exe`, no installer, no sidecar. The version is `package.json` `version`.

The product is Kustom and the exe, the console banner (`Kustom companion <version> starting`), `--help`, the
first-run prompt and the release title all say so (M2.20, 0.1.3). `Customs Night` stays the repo's codename:
the package name, the `CUSTOMS_NIGHT_*` environment variables and esbuild defines, the `User-Agent`
(`customs-night-companion/<version>`), the API's `service: customs-night` health literal, and the
`%APPDATA%\customs-night` config directory, which is a path an existing install already has its token in.

```
pnpm --filter companion bundle       # esbuild: src/main.ts + workspace deps -> dist/kustom.cjs
pnpm --filter companion build:win    # bundle, then Node SEA -> dist/Kustom.exe + Kustom.exe.sha256
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
`v<version>`, assets `Kustom.exe`, `Kustom.exe.sha256` and `README.txt`. The link for the group
chat never changes:

```
https://github.com/suyaser/kustom-releases/releases/latest/download/Kustom.exe
```

`pnpm --filter companion publish:gh` runs `gh release create` (the script is `publish:gh` because pnpm intercepts a script named `publish`) with the `gh` CLI's own login (`gh auth login`
once; no token variable). If `gh` is not logged in it prints the exact command and exits 1. Bump `version`
in `package.json` before a release: a tag that already exists is refused by GitHub, which is the point.

### Tests

`pnpm --filter companion test` runs against the in-process fake client and fake API (no League, no network).
`build/bundle.test.ts` bundles to a temp file and runs it under plain `node` with `--version` and `--help`,
so the packaging path is checked on every machine; the exe itself only runs on Windows.
