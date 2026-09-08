import type { Metadata } from 'next';
import { listSeasons } from '@/lib/admin/seasons';
import { requireAdmin } from '@/lib/adminPage';
import { getServiceClient } from '@/lib/supabase';
import { Empty, formatTimestamp, Notices, type SearchParams } from '../../_components/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Seasons — Customs Night admin',
  robots: { index: false, follow: false },
};

/**
 * Seasons. Starting one closes the current one and activates the new one in a single
 * transaction (`public.start_season`), because exactly one season may be active and a gap
 * would break every game insert.
 */
export default async function AdminSeasonsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [params] = await Promise.all([searchParams, requireAdmin()]);
  const seasons = await listSeasons(getServiceClient());

  return (
    <main>
      <h1>Seasons</h1>
      <p className="admin-muted">
        Starting a season ends the current one and makes the new one active, in one transaction. It does{' '}
        <strong>not</strong> carry ratings forward: copying <span className="admin-mono">mu</span> and
        resetting <span className="admin-mono">sigma</span> is M5.3. Until then everyone starts the new season
        unrated.
      </p>

      <Notices params={params} />

      <h2>Start a season</h2>
      <form method="post" action="/api/admin/seasons">
        <label>
          <span className="admin-muted">name </span>
          <input type="text" name="name" required placeholder="Season 2" aria-label="Season name" />
        </label>
        <button type="submit">Start</button>
      </form>

      <h2>All seasons</h2>
      {seasons.length === 0 ? (
        <Empty>No seasons. That should not happen — `0001_init.sql` inserts Season 1.</Empty>
      ) : (
        <div className="admin-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Started</th>
                <th>Ended</th>
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              {seasons.map((season) => (
                <tr key={season.id}>
                  <td>{season.name}</td>
                  <td>{formatTimestamp(season.startsAt)}</td>
                  <td>{formatTimestamp(season.endsAt)}</td>
                  <td>{season.isActive ? 'active' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
