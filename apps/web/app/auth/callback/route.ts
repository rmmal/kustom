import { NextResponse } from 'next/server';
import { internalPathSchema } from '@/lib/admin/formValues';
import { ServerEnvError } from '@/lib/env';
import { jsonError } from '@/lib/http';
import { siteOrigin } from '@/lib/siteUrl';
import { createAuthClient, requestCookieJar } from '@/lib/supabaseAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Where Discord (through Supabase Auth) comes back to. Exchanges the one-time code for a
 * session and writes the session cookies onto the redirect.
 *
 * `?next` is validated as a path on this site before it is used, so the callback cannot be
 * turned into an open redirect.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const origin = siteOrigin(request);

  const providerError = url.searchParams.get('error_description') ?? url.searchParams.get('error');
  if (providerError !== null) {
    return NextResponse.redirect(loginUrl(origin, providerError));
  }

  const code = url.searchParams.get('code');
  if (code === null) {
    return NextResponse.redirect(loginUrl(origin, 'Discord did not send a code'));
  }

  const nextParam = url.searchParams.get('next');
  const parsedNext = nextParam === null ? null : internalPathSchema.safeParse(nextParam);
  const next = parsedNext?.success ? parsedNext.data : '/admin';

  const jar = requestCookieJar(request);
  try {
    const client = createAuthClient(jar);
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (error !== null) {
      console.error(`auth callback failed: ${error.message}`);
      return NextResponse.redirect(loginUrl(origin, error.message));
    }
  } catch (error) {
    if (error instanceof ServerEnvError) {
      console.error(`auth callback: ${error.message}`);
      return jsonError(500, 'server is not configured');
    }
    throw error;
  }

  return jar.applyTo(NextResponse.redirect(new URL(next, origin)));
}

function loginUrl(origin: string, error: string): URL {
  const url = new URL('/admin/login', origin);
  url.searchParams.set('error', error);
  return url;
}
