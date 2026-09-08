import type { Metadata } from 'next';
import Link from 'next/link';
import { getActiveSeason } from '@/lib/admin/seasons';
import { requireAdmin } from '@/lib/adminPage';
import { getServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Admin — Customs Night',
  robots: { index: false, follow: false },
};

/** The index: who you are, which season is live, and where everything is. */
export default async function AdminIndexPage() {
  const admin = await requireAdmin();
  const season = await getActiveSeason(getServiceClient());

  return (
    <main>
      <h1>Admin</h1>
      <p className="admin-muted">
        Everything here writes through <span className="admin-mono">/api/admin/*</span>, which checks the
        session on the server. The rest of the site is public and needs no account.
      </p>

      <h2>You</h2>
      <dl>
        <dt>Discord</dt>
        <dd>
          {admin.discordName ?? 'unknown name'} <span className="admin-mono">{admin.discordId}</span>
        </dd>
        <dt>Player</dt>
        <dd>
          {admin.displayName ?? 'no display name yet'} <span className="admin-mono">{admin.puuid}</span>
        </dd>
        <dt>Email</dt>
        <dd>{admin.email ?? '—'}</dd>
      </dl>

      <h2>Active season</h2>
      <p>{season === null ? 'No season is active. Start one on the seasons page.' : season.name}</p>

      <h2>Pages</h2>
      <ul>
        <li>
          <Link href="/admin/players">Players</Link> — roles (including back to flexible), Discord links,
          admin flags
        </li>
        <li>
          <Link href="/admin/tokens">Companion tokens</Link> — mint and revoke
        </li>
        <li>
          <Link href="/admin/discord">Discord config</Link> — webhook and channel ids
        </li>
        <li>
          <Link href="/admin/seasons">Seasons</Link> — start a new one
        </li>
      </ul>
    </main>
  );
}
