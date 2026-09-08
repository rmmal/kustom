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
        Starting a season ends the current one and makes the new one active, in one go. It does{' '}
        <strong>not</strong> carry anyone&rsquo;s rating over. Everyone starts the new season unrated, the
        leaderboard goes back to empty, and it takes about a month of nightly games before it means anything
        again. Carrying ratings over is not built yet, so only start a season when the group has agreed to it.
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
        <Empty>
          No seasons at all. That should not be possible — the database is created with Season 1 already
          running, so something is wrong with it.
        </Empty>
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
