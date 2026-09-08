# Decisions

Append-only. One row per decision that the code or docs would otherwise leave ambiguous. Newest at the bottom.

| Date | Decision | Why | Alternatives rejected |
|---|---|---|---|
| 2026-09-08 | Build our own instead of using In-House Queue | Existing bots need manual reporting and equal-start ratings; we want zero-input and rank seeding. | In-House Queue (free, good baseline, still the fallback), MatchBalancer ($5.99/mo, no Discord) |
| 2026-09-08 | Companion app is phase 1, not a later add-on | It is the only way to get results and rosters without a human step, and it replaces the Riot public API. | Manual `/result` command with vote confirmation |
| 2026-09-08 | Supabase for database, auth, realtime | Hosted Postgres with the rest included; Discord OAuth is a checkbox. | Bare Postgres on Neon plus separate auth and pub/sub |
| 2026-09-08 | API lives in Next.js route handlers, not Supabase edge functions | One runtime and deploy; `packages/core` imports cleanly. | Edge functions (Deno toolchain), separate Fastify service |
| 2026-09-08 | Companion is a Node CLI packaged as an exe; tray wrapper deferred to M6 | Keeps the project all TypeScript, shares `packages/lcu`. | Tauri or Electron from day one, Overwolf |
| 2026-09-08 | Players keyed by PUUID; Discord link optional and admin-managed | Riot IDs are renamable; balancing and stats need no Discord identity. | Require Discord OAuth before playing |
| 2026-09-08 | No check-in. Roster comes from the custom lobby | The lobby is the truth about who is playing. A check-in is a form people skip. | Discord button check-in, web check-in as the primary flow |
| 2026-09-08 | Discord webhook in M3, bot process only in M4 for voice | Posting needs no process; voice moves do. | Full bot from the start |
| 2026-09-08 | OpenSkill for ratings, balance on mu, leaderboard on mu - 2 sigma, display mu * 60 | Team-aware rating with uncertainty; display scale reads like familiar MMR numbers. | Elo, Glicko-2 per player, raw TrueSkill port |
| 2026-09-08 | Role multipliers 1.00 / 0.93 / 0.85 for main / secondary / fill | Simple, explainable, tunable in one constant with tests. | Per-role ratings (too sparse for our game count) |
| 2026-09-08 | Backfill (M5) is the recovery path for missed games, never manual entry | Keeps ratings honest; manual entry invites disputes. | Admin manual result entry |
