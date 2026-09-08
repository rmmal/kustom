# apps/web

The Next.js app: the API the companion posts to, the public pages, and `/admin`.

```
app/api/companion/*   bearer companion token, zod-validated (M1.5)
app/api/admin/*       Supabase session + players.is_admin, zod-validated (M1.6)
app/admin/*           the admin pages. Server components, plain forms, no client JavaScript
app/auth/*            sign in with Discord, the OAuth callback, sign out
lib/                  auth, the service-role client, ingest, admin reads and writes
proxy.ts              refreshes the admin session cookie (Next 16's name for middleware)
```

```
pnpm --filter web dev         http://localhost:3000
pnpm --filter web test        vitest; the integration tests skip without the local stack
pnpm --filter web build
pnpm --filter web mint-token <puuid> [label]   # /admin/tokens does this with a button now
```

Environment: copy the `apps/web` block of the repo's `.env.example` into `apps/web/.env.local`.
`supabase status -o env` (from `packages/db`) prints the local URL and keys.

## The companion API

Four routes, all bearer-token gated by `withCompanionAuth` / `withCompanionIdentity`
(`lib/companionRoute.ts`), which resolves the identity from the token **before** it parses the
body. The token decides who the caller is; nothing in a payload does.

```
GET  /api/companion/me      who this token is: { ok, puuid, playerId, displayName }. Writes nothing.
POST /api/companion/lobby   the whole member list, every time it changes. Idempotent on partyId.
                            answers ranksNeeded[] (M2.4) and recheckInMs (null until M2.5).
POST /api/companion/game    phase in_progress | eog. Idempotent on gameId.
POST /api/companion/rank    one queue's rank reading for one puuid.
```

Request **and** response schemas live in `@customs/db/schemas` (`companion.ts`,
`companionResponses.ts`), not beside the routes, because the companion imports the same
definitions — see "The companion wire contract" in `packages/db/README.md` for the field-by-field
rules and where each value comes from in the client. Refusals before any write: 403 for a lobby or
game the caller was not in, 422 for a non-custom game, a block nobody won (a remake or
`TerminatedInError`) or a duplicated participant, 400 for a body that does not parse.

## The admin area

`/admin` is gated twice, both server-side:

- **Pages** — `app/admin/(dashboard)/layout.tsx` calls `requireAdmin()` (`lib/adminPage.ts`).
  `/admin/login` sits outside that route group, which is why the group exists.
- **Writes** — every `app/api/admin/*` route is wrapped in `withAdminAuth()`
  (`lib/adminRoute.ts`), which answers **401 without a session and 403 for anyone who is not
  `players.is_admin`**, before it looks at the body.

The gate itself is `lib/adminAuth.ts`: the session is exchanged for a verified user with
`auth.getUser()`, the Discord snowflake is read from `user.identities[]` where
`provider === 'discord'`, and that snowflake is matched against `players.discord_id` with the
**service role** (anon and authenticated cannot read `players` at all). `user_metadata` is never
trusted for identity — a signed-in user can write it themselves with `auth.updateUser()`.

Pages read and write through the service-role client, so nothing in the browser holds anything
but the anon key and the session cookie.

The pages are deliberately unstyled beyond `app/admin/admin.css` (system colours, a scrolling
table). M3.0 brings the design system; this area is five people on a laptop and should not
pre-empt it.

## Setting up Discord sign-in

No OAuth app exists yet. Once someone creates one:

1. <https://discord.com/developers/applications> → **New Application** → name it (Customs Night).
2. **OAuth2** → **Redirects** → add one per environment. This is Supabase's callback, not ours:
   - local stack: `http://127.0.0.1:54321/auth/v1/callback`
   - hosted: `https://<project-ref>.supabase.co/auth/v1/callback`
3. Copy the **Client ID** and a **Client Secret**.
4. Local: put them in your shell as `SUPABASE_AUTH_DISCORD_CLIENT_ID` and
   `SUPABASE_AUTH_DISCORD_SECRET`, then `pnpm db:stop && pnpm db:start`. The provider block is
   already in `packages/db/supabase/config.toml`; with the variables unset the CLI only warns,
   so everyone else's stack still starts.
   Hosted: Authentication → Providers → Discord, paste them there.
5. Supabase → Authentication → URL Configuration: site URL and the allow-list must include the
   app's own `/auth/callback` (`http://127.0.0.1:3000/auth/callback` locally; the local
   `config.toml` already allows `127.0.0.1:3000`).

Scopes are Supabase's default, `identify email`. `identify` is what carries the snowflake the
gate matches on; nothing else is needed.

### The first admin

`players.discord_id` is what `/admin` matches a session against, and the first admin is seeded by
**PUUID** (`BOOTSTRAP_ADMIN_PUUID` → `public.bootstrap_admin()`), which leaves them unable to
sign in. Set `BOOTSTRAP_ADMIN_DISCORD_ID` as well, once: the first request that needs it links
that snowflake to the bootstrap PUUID and never touches a link that already exists. After that
first sign-in, everyone else is linked from `/admin/players` and both variables can stay set
(they are idempotent) or be removed.
