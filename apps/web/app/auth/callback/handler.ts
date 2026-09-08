import { NextResponse } from 'next/server';
import { forgetNext, nextUrl, readNextCookie } from '@/lib/authNext';
import { ServerEnvError } from '@/lib/env';
import { jsonError } from '@/lib/http';
import { siteOrigin } from '@/lib/siteUrl';
import { createAuthClient, type RequestCookieJar, requestCookieJar } from '@/lib/supabaseAuth';

/**
 * The callback, with the one thing that needs a network round trip injected.
 *
 * `route.ts` wires the real Supabase exchange. A test can drive the whole route — the cookie,
 * the validation, the redirect, the cleared cookie — without an OAuth provider, which is the
 * only way the "lands on the page you started from" rule can be checked at all.
 */

export interface AuthCallbackDeps {
  /**
   * Trades the one-time code for a session and writes the session cookies into the jar.
   * Returns the error rather than throwing it: a bad code is an answer, not a crash.
   */
  exchangeCode: (code: string, jar: RequestCookieJar) => Promise<{ error: { message: string } | null }>;
}

/** The real one. Throws {@link ServerEnvError} when Supabase is not configured. */
export const supabaseExchange: AuthCallbackDeps['exchangeCode'] = async (code, jar) => {
  const client = createAuthClient(jar);
  const { error } = await client.auth.exchangeCodeForSession(code);
  return { error: error === null ? null : { message: error.message } };
};

export async function handleAuthCallback(request: Request, deps: AuthCallbackDeps): Promise<NextResponse> {
  const url = new URL(request.url);
  const origin = siteOrigin(request);
  // Read before anything can fail: every exit below clears the cookie.
  const destination = nextUrl(readNextCookie(request), origin);

  const providerError = url.searchParams.get('error_description') ?? url.searchParams.get('error');
  if (providerError !== null) {
    return forgetNext(NextResponse.redirect(loginUrl(origin, providerError)), origin);
  }

  const code = url.searchParams.get('code');
  if (code === null) {
    return forgetNext(NextResponse.redirect(loginUrl(origin, 'Discord did not send a code')), origin);
  }

  const jar = requestCookieJar(request);
  try {
    const { error } = await deps.exchangeCode(code, jar);
    if (error !== null) {
      console.error(`auth callback failed: ${error.message}`);
      return forgetNext(NextResponse.redirect(loginUrl(origin, error.message)), origin);
    }
  } catch (error) {
    if (error instanceof ServerEnvError) {
      console.error(`auth callback: ${error.message}`);
      return jsonError(500, 'server is not configured');
    }
    throw error;
  }

  return forgetNext(jar.applyTo(NextResponse.redirect(destination)), origin);
}

function loginUrl(origin: string, error: string): URL {
  const url = new URL('/admin/login', origin);
  url.searchParams.set('error', error);
  return url;
}
