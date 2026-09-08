import { z } from 'zod';

/**
 * Server-side environment, read once per process and validated with zod like every other
 * boundary. Nothing in here is ever imported from a client component: `SUPABASE_SERVICE_ROLE_KEY`
 * bypasses RLS, so it must never reach the browser bundle.
 *
 * Every variable named here is listed in the repo's `.env.example`.
 */
const serverEnvSchema = z.object({
  /** Same URL the browser uses; only the key differs. */
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  /** Bypasses RLS. Server only. */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  /**
   * Optional. When set, the first request of a process promotes this PUUID to admin through
   * `public.bootstrap_admin()` (idempotent). See `lib/bootstrapAdmin.ts`.
   */
  BOOTSTRAP_ADMIN_PUUID: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined)),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Reads and validates the server environment.
 *
 * Throws {@link ServerEnvError} rather than returning a half-configured object: a route that
 * cannot reach the database must answer 500, not write somewhere unexpected.
 */
export function readServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const parsed = serverEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: source.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: source.SUPABASE_SERVICE_ROLE_KEY,
    BOOTSTRAP_ADMIN_PUUID: source.BOOTSTRAP_ADMIN_PUUID,
  });

  if (!parsed.success) {
    const names = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new ServerEnvError(`missing or invalid environment: ${names}`);
  }

  return parsed.data;
}

/** Thrown when the process is not configured to talk to Supabase. */
export class ServerEnvError extends Error {
  override name = 'ServerEnvError';
}
