import process from 'node:process';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { mintCompanionToken } from '../lib/companionAuth.ts';
import { ensurePlayers } from '../lib/ingest/players.ts';

/**
 * Mints a companion token for a PUUID and prints it once.
 *
 * This exists because the companion needs a token before `/admin` does (M1.6 replaces it with
 * a button). It writes the SHA-256 hash to `companion_tokens.token_hash`; the raw token below
 * is the only time anyone sees it.
 *
 *   pnpm --filter web mint-token <puuid> [label]
 *
 * Reads `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `apps/web/.env.local`
 * (loaded by the package script's `--env-file-if-exists`) or from the ambient environment.
 */

async function main(): Promise<void> {
  const [puuid, label] = process.argv.slice(2);
  if (!puuid) {
    console.error('usage: pnpm --filter web mint-token <puuid> [label]');
    process.exitCode = 1;
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error('mint-token: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    console.error('mint-token: put them in apps/web/.env.local (see .env.example)');
    process.exitCode = 1;
    return;
  }

  const client = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const playerIds = await ensurePlayers(client, [{ puuid }]);
  const playerId = playerIds.get(puuid);
  if (playerId === undefined) throw new Error(`mint-token: could not create a player for ${puuid}`);

  const { token, tokenHash } = mintCompanionToken();
  const { error } = await client
    .from('companion_tokens')
    .insert({ player_id: playerId, token_hash: tokenHash, label: label ?? 'dev' });
  if (error) throw new Error(`mint-token: insert failed: ${error.message}`);

  console.log(`player_id ${playerId}`);
  console.log(`puuid     ${puuid}`);
  console.log(`label     ${label ?? 'dev'}`);
  console.log('');
  console.log(token);
}

await main();
