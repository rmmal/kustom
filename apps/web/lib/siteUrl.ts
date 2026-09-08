import { readAuthEnv } from './env';

/**
 * The origin OAuth comes back to.
 *
 * `NEXT_PUBLIC_SITE_URL` wins when it is set (that is the one value a hosted deploy must pin,
 * because Supabase only redirects to allow-listed URLs). Otherwise it is taken from the
 * request: `x-forwarded-*` on Vercel, the request URL in `next dev`.
 */
export function siteOrigin(request: Request): string {
  try {
    const configured = readAuthEnv().NEXT_PUBLIC_SITE_URL;
    if (configured) return configured;
  } catch {
    // Not configured at all; fall through to the request.
  }

  const host = firstHeaderValue(request.headers.get('x-forwarded-host')) ?? request.headers.get('host');
  const proto = firstHeaderValue(request.headers.get('x-forwarded-proto'));
  if (host) {
    return `${proto ?? (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https')}://${host}`;
  }

  return new URL(request.url).origin;
}

function firstHeaderValue(value: string | null): string | null {
  if (value === null) return null;
  const first = value.split(',')[0]?.trim();
  return first && first.length > 0 ? first : null;
}
