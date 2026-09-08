# Customs Night

Team balancer and stats for our nightly League of Legends customs. A desktop companion reads the League client,
the server balances teams and keeps ratings, Discord shows the result and splits voice. Nobody checks in, nobody
reports a score.

- `CLAUDE.md` is the brief for implementing agents: repo map, rules, definition of done.
- `docs/00-product.md` what we are building and why.
- `docs/01-architecture.md` components, data model, rating and balancing.
- `docs/02-milestones.md` the work queue and its status.
- `docs/03-lcu-reference.md` every League client endpoint we touch, with verification status.
- `docs/04-decisions.md` append-only decision log.

Start with M0 in the milestones doc. It needs a Windows PC with League installed.

## Development

Requires Node 22+ (developed on 25), pnpm 12, the Supabase CLI, and Docker for the local database.

```
pnpm install
pnpm -r typecheck
pnpm -r test
pnpm lint
pnpm --filter web dev     # http://localhost:3000
```

The full command list, including the database ones, is in `CLAUDE.md` under Commands. Database setup is in
`packages/db/README.md`.

Layout: `apps/web` (Next.js App Router, the API), `packages/core` (pure balancer and rating),
`packages/db` (migrations, generated types, shared zod schemas), `packages/lcu` (League client bridge).
Packages are imported as `@customs/core`, `@customs/db`, `@customs/lcu` and ship TypeScript source, so
there is no build step before `dev` or `test`.
