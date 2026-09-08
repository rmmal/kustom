import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { type AdminAuthResult, type AdminIdentity, resolveAdmin } from './adminAuth';
import { getServiceClient } from './supabase';
import { readOnlyCookieJar } from './supabaseAuth';

/**
 * The admin gate for server components.
 *
 * Wrapped in React's `cache` so the gated layout and the page inside it share one
 * `auth.getUser()` round trip and one `players` lookup per request.
 *
 * Server components cannot write cookies, so the jar here is read-only; `middleware.ts`
 * refreshes the session for `/admin` navigations.
 */
export const currentAdmin: () => Promise<AdminAuthResult> = cache(async () => {
  const store = await cookies();
  return resolveAdmin(
    readOnlyCookieJar(store.getAll().map(({ name, value }) => ({ name, value }))),
    getServiceClient(),
  );
});

/**
 * Same, but null when the check itself could not run — the environment is incomplete or
 * Supabase is unreachable. Only `/admin/login` uses it: that page must still render its button
 * when the database is down, and every gated page redirects there anyway.
 */
export async function currentAdminOrNull(): Promise<AdminAuthResult | null> {
  try {
    return await currentAdmin();
  } catch (error) {
    console.error('admin session check failed', error);
    return null;
  }
}

/**
 * The admin, or a redirect to `/admin/login`. A signed-in non-admin lands there too, with the
 * reason and a sign-out button: bouncing them anywhere else would just loop.
 */
export async function requireAdmin(): Promise<AdminIdentity> {
  const result = await currentAdmin();
  if (result.ok) return result.admin;

  if (result.status === 401) redirect('/admin/login');
  redirect(`/admin/login?denied=${encodeURIComponent(result.error)}`);
}
