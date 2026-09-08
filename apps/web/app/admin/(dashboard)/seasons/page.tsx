import type { Metadata } from 'next';
import { getActiveSeason, listSeasons } from '@/lib/admin/seasons';
import { requireAdmin } from '@/lib/adminPage';
import { NO_ACTIVE_SEASON_MESSAGE } from '@/lib/season';
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
 *
 * It is also the only button here that cannot be undone, so it takes a typed confirmation
 * (M3.9): the name of the season being ended, spelled out next to the field because an admin
 * on a phone should not have to go and find it.
 */
export default async function AdminSeasonsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [params] = await Promise.all([searchParams, requireAdmin()]);
  const client = getServiceClient();
  const [seasons, active] = await Promise.all([listSeasons(client), getActiveSeason(client)]);

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
      {active === null ? (
        // Verbatim the sentence the companion API answers a game post with while this is true
        // (M2.18), then what it means here: there is nothing to end, so the form is one field.
        <p className="admin-error" role="alert">
          {NO_ACTIVE_SEASON_MESSAGE} There is nothing to end, so starting one here makes it active straight
          away.
        </p>
      ) : null}
      <form method="post" action="/api/admin/seasons" className="admin-stacked">
        <label className="admin-field">
          <span>Name of the new season</span>
          <input type="text" name="name" required placeholder="Season 2" size={24} />
        </label>

        {active === null ? null : (
          <label className="admin-field">
            {/* The name to type is spelled out here, not left in a placeholder: the point of
                the field is that the admin reads which season they are about to end. */}
            <span>
              To confirm, type the name of the season you are ending: <strong>{active.name}</strong>
            </span>
            <input
              type="text"
              name="confirmSeasonName"
              required
              size={24}
              aria-label={`Type ${active.name} to confirm`}
            />
          </label>
        )}

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
