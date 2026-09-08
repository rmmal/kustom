import { NextResponse } from 'next/server';
import { ServerEnvError } from '@/lib/env';
import { jsonError } from '@/lib/http';
import { siteOrigin } from '@/lib/siteUrl';
import { createAuthClient, requestCookieJar } from '@/lib/supabaseAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Ends the session and clears its cookies. POST only: a GET sign-out can be triggered by any
 * image tag on any page.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const origin = siteOrigin(request);
  const jar = requestCookieJar(request);

  try {
    const client = createAuthClient(jar);
    const { error } = await client.auth.signOut();
    if (error !== null) console.warn(`sign-out: ${error.message}`);
  } catch (error) {
    if (error instanceof ServerEnvError) {
      console.error(`sign-out: ${error.message}`);
      return jsonError(500, 'server is not configured');
    }
    throw error;
  }

  return jar.applyTo(NextResponse.redirect(new URL('/admin/login', origin), 303));
}
