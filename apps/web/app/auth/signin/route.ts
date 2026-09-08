import { NextResponse } from 'next/server';
import { internalPathSchema } from '@/lib/admin/formValues';
import { ServerEnvError } from '@/lib/env';
import { jsonError } from '@/lib/http';
import { siteOrigin } from '@/lib/siteUrl';
import { createAuthClient, requestCookieJar } from '@/lib/supabaseAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Starts the Discord OAuth flow.
 *
 * Server-side rather than a `signInWithOAuth()` call from the browser: the PKCE code verifier
 * is then written by the same cookie jar that `/auth/callback` reads it back from, and
 * `/admin/login` stays a plain form with no client JavaScript.
 *
 * POST only, because a GET would let any page on the internet bounce a visitor through Discord.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let next = '/admin';
  try {
    const form = await request.formData();
    const candidate = form.get('next');
    if (typeof candidate === 'string') {
      const parsed = internalPathSchema.safeParse(candidate);
      if (parsed.success) next = parsed.data;
    }
  } catch {
    // No body is fine: /admin is the default.
  }

  const origin = siteOrigin(request);
  const jar = requestCookieJar(request);

  try {
    const client = createAuthClient(jar);
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'discord',
      options: { redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });

    if (error !== null || !data.url) {
      const reason = error?.message ?? 'Discord sign-in is not configured';
      console.error(`sign-in failed: ${reason}`);
      return NextResponse.redirect(loginUrl(origin, reason), 303);
    }

    return jar.applyTo(NextResponse.redirect(data.url, 303));
  } catch (error) {
    if (error instanceof ServerEnvError) {
      console.error(`sign-in: ${error.message}`);
      return jsonError(500, 'server is not configured');
    }
    throw error;
  }
}

function loginUrl(origin: string, error: string): URL {
  const url = new URL('/admin/login', origin);
  url.searchParams.set('error', error);
  return url;
}
