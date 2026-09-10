import Link from 'next/link';
import type { ReactNode } from 'react';
import { requireAdmin } from '@/lib/adminPage';

export const dynamic = 'force-dynamic';

/**
 * The gate. Every page in this route group is admin-only, checked here, server-side, against
 * `players.is_admin` — never in the browser and never from anything the request supplied.
 *
 * The route group `(dashboard)` keeps `/admin/login` out of it while leaving the URLs alone:
 * this layout wraps `/admin`, `/admin/players`, `/admin/tokens`, `/admin/games`,
 * `/admin/discord` and `/admin/seasons`.
 */
export default async function AdminDashboardLayout({ children }: { children: ReactNode }) {
  const admin = await requireAdmin();

  return (
    <>
      <nav className="admin-nav">
        <Link href="/admin">Admin</Link>
        <Link href="/admin/players">Players</Link>
        <Link href="/admin/tokens">Tokens</Link>
        <Link href="/admin/games">Games</Link>
        <Link href="/admin/discord">Discord</Link>
        <Link href="/admin/seasons">Seasons</Link>
        <Link href="/">Tonight</Link>
      </nav>

      <div className="admin-identity">
        <span>
          signed in as {admin.discordName ?? admin.displayName ?? admin.puuid}{' '}
          <span className="admin-muted">(discord {admin.discordId})</span>
        </span>
        <form method="post" action="/auth/signout">
          <button type="submit">Sign out</button>
        </form>
      </div>

      {children}
    </>
  );
}
