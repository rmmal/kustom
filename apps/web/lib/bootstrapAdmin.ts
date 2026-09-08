import { readServerEnv } from './env';
import type { ServiceClient } from './supabase';

/**
 * The first admin (`docs/04-decisions.md`, 2026-09-08): a migration cannot read the deployment
 * environment, so `public.bootstrap_admin(puuid)` does the insert-or-promote and the API calls
 * it with `BOOTSTRAP_ADMIN_PUUID`. The function is idempotent, so calling it again is a no-op.
 *
 * Run lazily on the first companion request of a process rather than from `instrumentation.ts`:
 * a build-time or cold-start hook would have to cope with the database being unreachable, and
 * nothing needs the admin to exist before the first request does.
 */

let inFlight: Promise<void> | null = null;

/** Runs `bootstrap_admin` at most once per process. Never throws: a failure only logs. */
export function ensureBootstrapAdmin(client: ServiceClient): Promise<void> {
  inFlight ??= runBootstrapAdmin(client);
  return inFlight;
}

/** Tests only: forget that this process has already bootstrapped. */
export function resetBootstrapAdmin(): void {
  inFlight = null;
}

async function runBootstrapAdmin(client: ServiceClient): Promise<void> {
  let puuid: string | undefined;
  try {
    puuid = readServerEnv().BOOTSTRAP_ADMIN_PUUID;
  } catch {
    // Not configured at all. The caller is about to fail on the client anyway.
    return;
  }

  if (!puuid) return;

  const { error } = await client.rpc('bootstrap_admin', { p_puuid: puuid });
  if (error) {
    console.warn(`bootstrap_admin failed for ${puuid}: ${error.message}`);
  }
}
