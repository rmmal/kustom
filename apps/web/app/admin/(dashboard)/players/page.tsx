import { displayRating, ordinal } from '@customs/core';
import type { Metadata } from 'next';
import { playerLabel, shortPuuid } from '@/lib/admin/playerName';
import { type AdminPlayerRow, listAdminPlayers } from '@/lib/admin/players';
import { getActiveSeason } from '@/lib/admin/seasons';
import { requireAdmin } from '@/lib/adminPage';
import { getServiceClient } from '@/lib/supabase';
import { AdminForm } from '../../_components/AdminForm';
import { Empty, formatDay, Notices, RoleSelect, type SearchParams } from '../../_components/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Players — Kustom admin',
  robots: { index: false, follow: false },
};

/**
 * Every player, with the five things only an admin can change: the name the group uses, roles,
 * the Discord link, the admin flag and backfill approval (M5.1).
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
        PUUID shows up in a lobby, a game or a rank report — there is no "add player". A name follows the Riot
        ID until you set one here; clear the field to put it back on automatic.
      </p>
      {/* Product's copy, verbatim (M5.1): the decision an admin is being asked to make is
          "whose PC is this", and nothing else on this page says it. */}
      <p className="admin-muted">
        Backfill lets a player&apos;s companion send past customs from their client&apos;s match history. Turn
        it on once you know whose PC it is.
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
                <th>Backfill</th>
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
  // Never a blank cell and never a bare PUUID where a name exists: the same chain every other
  // admin surface uses, and the label the forms below refer to.
  const label = playerLabel(player);

  return (
    <tr>
      <td className="admin-mono" title={player.puuid}>
        {shortPuuid(player.puuid)}
      </td>
      <td>
        {/* The readable name first, then the field that overrides it: an admin has to see what
            the group currently reads before deciding to change it, and on a row that is still on
            automatic the field is empty while this line already says a name. */}
        <div>{label}</div>
        <AdminForm action="/api/admin/players" kind="players">
          <input type="hidden" name="action" value="set-name" />
          <input type="hidden" name="playerId" value={player.id} />
          <input
            type="text"
            name="displayName"
            size={14}
            maxLength={40}
            defaultValue={player.displayName ?? ''}
            placeholder="follows the Riot ID"
            aria-label={`Name for ${label}`}
          />
          <button type="submit">Save</button>
        </AdminForm>
      </td>
      <td>{player.gameName === null ? '—' : `${player.gameName}#${player.tagLine ?? '???'}`}</td>
      <td>{formatRank(player)}</td>
      <td>{formatRating(player)}</td>
      <td>
        {/* Both roles are posted together, so "none" clears rather than meaning "unchanged". */}
        <AdminForm action="/api/admin/players" kind="players">
          <input type="hidden" name="action" value="set-roles" />
          <input type="hidden" name="playerId" value={player.id} />
          <RoleSelect name="mainRole" value={player.mainRole} label="main" />
          <RoleSelect name="secondaryRole" value={player.secondaryRole} label="second" />
          <button type="submit">Save</button>
        </AdminForm>
      </td>
      <td>
        <AdminForm action="/api/admin/players" kind="players">
          <input type="hidden" name="action" value="set-discord" />
          <input type="hidden" name="playerId" value={player.id} />
          <input
            type="text"
            name="discordId"
            inputMode="numeric"
            size={20}
            defaultValue={player.discordId ?? ''}
            placeholder="snowflake, empty to unlink"
            aria-label={`Discord id for ${label}`}
          />
          <button type="submit">Save</button>
        </AdminForm>
      </td>
      <td>
        <AdminForm action="/api/admin/players" kind="players">
          <input type="hidden" name="action" value="set-admin" />
          <input type="hidden" name="playerId" value={player.id} />
          <input type="hidden" name="isAdmin" value={player.isAdmin ? 'false' : 'true'} />
          <span>{player.isAdmin ? 'yes' : 'no'}</span>
          {/* An admin may not remove their own flag: the last one out would lock everyone out. */}
          <button type="submit" disabled={isSelf && player.isAdmin}>
            {player.isAdmin ? 'Remove' : 'Make admin'}
          </button>
        </AdminForm>
      </td>
      <td>
        {/* Three states in one cell, then the one control (M5.1). `asked` is the companion
            having knocked at `/api/companion/backfill/scan` and been told no — the marker is
            there so an admin knows somebody is waiting rather than having to be asked. */}
        <AdminForm action="/api/admin/players" kind="players">
          <input type="hidden" name="action" value="set-backfill" />
          <input type="hidden" name="playerId" value={player.id} />
          <input
            type="hidden"
            name="approved"
            value={player.backfillApprovedAt === null ? 'true' : 'false'}
          />
          <span>{formatBackfill(player)}</span>{' '}
          <button type="submit">{player.backfillApprovedAt === null ? 'Allow' : 'Revoke'}</button>
        </AdminForm>
      </td>
    </tr>
  );
}

/** `off` / `asked <date>` / `on since <date>`, exactly the three states the brief names. */
function formatBackfill(player: AdminPlayerRow): string {
  if (player.backfillApprovedAt !== null) return `on since ${formatDay(player.backfillApprovedAt)}`;
  if (player.backfillRequestedAt !== null) return `asked ${formatDay(player.backfillRequestedAt)}`;
  return 'off';
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
