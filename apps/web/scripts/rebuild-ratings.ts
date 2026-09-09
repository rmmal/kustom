import process from 'node:process';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { formatRebuildReport, rebuildRatings } from '../lib/ingest/rebuild.ts';

/**
 * `pnpm --filter web rebuild-ratings` (M5.2).
 *
 * Folds every rated-eligible game of a season, in `started_at` order, from seeds, and writes
 * the answer once at the end. Run it after a backfill batch (M5.1) — a batch of old customs is
 * stored unrated until this runs — or any time the numbers need to be provably the fold of the
 * games rather than the history of the writes.
 *
 *   pnpm --filter web rebuild-ratings [--dry-run] [--force] [--prune] [--season <id>]
 *
 *   --dry-run   compute and report; write nothing.
 *   --force     skip the guard that refuses while a lobby is live.
 *   --prune     delete `ratings` rows for players with no rated game in the season.
 *   --season    a season id; the active season by default.
 *
 * Everything except the argument parsing and the printing is `lib/ingest/rebuild.ts`, which is
 * what the integration tests drive. This file is a command, not a place for rules.
 *
 * Exit codes: 0 fine, 1 refused or a data problem, 2 the fence tripped — run it again.
 *
 * Reads `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `apps/web/.env.local`
 * (loaded by the package script's `--env-file-if-exists`) or from the ambient environment.
 * Point them at production only when you mean to rebuild production.
 */

interface Args {
  dryRun: boolean;
  force: boolean;
  prune: boolean;
  seasonId: string | null;
}

function parseArgs(argv: readonly string[]): Args | null {
  const args: Args = { dryRun: false, force: false, prune: false, seasonId: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--force') args.force = true;
    else if (arg === '--prune') args.prune = true;
    else if (arg === '--season') {
      const value = argv[index + 1];
      if (value === undefined) return null;
      args.seasonId = value;
      index += 1;
    } else return null;
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) {
    console.error('usage: pnpm --filter web rebuild-ratings [--dry-run] [--force] [--prune] [--season <id>]');
    process.exitCode = 1;
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error('rebuild-ratings: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    console.error('rebuild-ratings: put them in apps/web/.env.local (see .env.example)');
    process.exitCode = 1;
    return;
  }

  const client = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const started = Date.now();
  const result = await rebuildRatings(client, {
    seasonId: args.seasonId,
    force: args.force,
    dryRun: args.dryRun,
    prune: args.prune,
  });

  if (!result.ok) {
    if (result.report !== null) console.log(formatRebuildReport(result.report));
    console.error(result.message);
    // 2 is the fence: the command is idempotent, so running it again is free and is the fix.
    process.exitCode = result.code === 'fence' ? 2 : 1;
    return;
  }

  console.log(formatRebuildReport(result.report));
  console.log(`took          ${Date.now() - started} ms`);

  if (result.report.problems.length > 0) {
    console.error(
      `rebuild-ratings: ${result.report.problems.length} problem(s) above; nothing else is wrong`,
    );
    process.exitCode = 1;
  }
}

await main();
