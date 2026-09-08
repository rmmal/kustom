import type { NextResponse } from 'next/server';
import { handleAuthCallback, supabaseExchange } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Where Discord (through Supabase Auth) comes back to. Exchanges the one-time code for a
 * session and writes the session cookies onto the redirect.
 *
 * The destination comes from the cookie `/auth/signin` set, never from the query string: the
 * URL Supabase is allowed to come back to has to be the bare `/auth/callback` (M1.11). The
 * cookie is validated as a path on this site before it is used, so the callback cannot be
 * turned into an open redirect, and it is cleared on every answer this route gives — success,
 * provider error or bad code — so a destination never outlives its round trip.
 *
 * The logic is in `handler.ts` so a test can run it without an OAuth provider.
 */
export function GET(request: Request): Promise<NextResponse> {
  return handleAuthCallback(request, { exchangeCode: supabaseExchange });
}
