import { displayRating, ordinal } from '@customs/core';
import type { Metadata } from 'next';
import { type AdminPlayerRow, listAdminPlayers } from '@/lib/admin/players';
import { getActiveSeason } from '@/lib/admin/seasons';
import { requireAdmin } from '@/lib/adminPage';
import { getServiceClient } from '@/lib/supabase';
import { Empty, Notices, RoleSelect, type SearchParams, shortPuuid } from '../../_components/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Players — Customs Night admin',
  robots: { index: false, follow: false },
};

/**
 * Every player, with the three things only an admin can change: roles, the Discord link and
 * the admin flag.
 *
 * Read with the service-role client, so `discord_id` is visible — `players_public` (what every
 * public page reads) does not carry it.
 */
export default async function AdminPlayersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [params, admin] = await Promise.all([searchParams, requireAdmin()]);
  const client = getServiceClient();
  const season = await getActiveSeason(client);
  const players = await listAdminPlayers(client, season?.id ?? null);

  return (
    <main>
      <h1>Players</h1>
      <p className="admin-muted">
        {players.length} player{players.length === 1 ? '' : 's'}. Ratings are the active season
        {season === null ? ' (none active)' : ` (${season.name})`}. A row appears on its own the first time a
        PUUID shows up in a lobby, a game or a rank report — there is no "add player".
      </p>

      <Notices params={params} />

      {players.length === 0 ? (
        <Empty>
          No players yet. Run the companion once, or post a lobby to{' '}
          <span className="admin-mono">/api/companion/lobby</span>, and the rows appear here.
        </Empty>
      ) : (
        <div className="admin-scroll">
          <table>
            <thead>
              <tr>
                <th>PUUID</th>
                <th>Name</th>
                <th>Riot ID</th>
                <th>Rank</th>
                <th>Rating</th>
                <th>Roles</th>
                <th>Discord</th>
                <th>Admin</th>
              </tr>
            </thead>
            <tbody>
              {players.map((player) => (
                <PlayerRow key={player.id} player={player} actingPlayerId={admin.playerId} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function PlayerRow({ player, actingPlayerId }: { player: AdminPlayerRow; actingPlayerId: string }) {
  const isSelf = player.id === actingPlayerId;

  return (
    <tr>
      <td className="admin-mono" title={player.puuid}>
        {shortPuuid(player.puuid)}
      </td>
      <td>{player.displayName ?? '—'}</td>
      <td>{player.gameName === null ? '—' : `${player.gameName}#${player.tagLine ?? '???'}`}</td>
      <td>{formatRank(player)}</td>
      <td>{formatRating(player)}</td>
      <td>
        {/* Both roles are posted together, so "none" clears rather than meaning "unchanged". */}
        <form method="post" action="/api/admin/players">
          <input type="hidden" name="action" value="set-roles" />
          <input type="hidden" name="playerId" value={player.id} />
          <RoleSelect name="mainRole" value={player.mainRole} label="main" />
          <RoleSelect name="secondaryRole" value={player.secondaryRole} label="second" />
          <button type="submit">Save</button>
        </form>
      </td>
      <td>
        <form method="post" action="/api/admin/players">
          <input type="hidden" name="action" value="set-discord" />
          <input type="hidden" name="playerId" value={player.id} />
          <input
            type="text"
            name="discordId"
            inputMode="numeric"
            size={20}
            defaultValue={player.discordId ?? ''}
            placeholder="snowflake, empty to unlink"
            aria-label={`Discord id for ${player.displayName ?? player.puuid}`}
          />
          <button type="submit">Save</button>
        </form>
      </td>
      <td>
        <form method="post" action="/api/admin/players">
          <input type="hidden" name="action" value="set-admin" />
          <input type="hidden" name="playerId" value={player.id} />
          <input type="hidden" name="isAdmin" value={player.isAdmin ? 'false' : 'true'} />
          <span>{player.isAdmin ? 'yes' : 'no'}</span>
          {/* An admin may not remove their own flag: the last one out would lock everyone out. */}
          <button type="submit" disabled={isSelf && player.isAdmin}>
            {player.isAdmin ? 'Remove' : 'Make admin'}
          </button>
        </form>
      </td>
    </tr>
  );
}

function formatRank(player: AdminPlayerRow): string {
  if (player.rankTier === null) return 'unranked';
  const division = player.rankDivision === null ? '' : ` ${player.rankDivision}`;
  const lp = player.rankLp === null ? '' : ` ${player.rankLp} LP`;
  return `${player.rankTier}${division}${lp}`;
}

/**
 * Display rating and ordinal both come from `@customs/core`; nothing here does its own
 * arithmetic on a rating, so what an admin sees is what the balancer and the leaderboard see.
 */
function formatRating(player: AdminPlayerRow): string {
  if (player.rating === null) return '—';
  const { mu, sigma, games, wins } = player.rating;
  return `${displayRating(mu)} (ord ${ordinal({ mu, sigma }).toFixed(2)}, ${wins}/${games})`;
}
