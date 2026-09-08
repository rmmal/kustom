import type { Metadata } from 'next';
import { playerLabel } from '@/lib/admin/playerName';
import { listAdminPlayers } from '@/lib/admin/players';
import { listAdminTokens } from '@/lib/admin/tokens';
import { requireAdmin } from '@/lib/adminPage';
import { getServiceClient } from '@/lib/supabase';
import { Empty, formatTimestamp, Notices, type SearchParams } from '../../_components/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Companion tokens — Customs Night admin',
  robots: { index: false, follow: false },
};

/**
 * Mint and revoke companion tokens — the button that replaces
 * `pnpm --filter web mint-token` (M1.5).
 *
 * Minting answers with a one-off page carrying the raw token; the table below only ever knows
 * that a token exists, because the database only stores its SHA-256 hash.
 */
export default async function AdminTokensPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [params] = await Promise.all([searchParams, requireAdmin()]);
  const client = getServiceClient();
  const [tokens, players] = await Promise.all([listAdminTokens(client), listAdminPlayers(client, null)]);

  return (
    <main>
      <h1>Companion tokens</h1>
      <p className="admin-muted">
        One token per companion install. The raw token is shown once, on the page you land on after minting;
        only its hash is stored. Revoking sets <span className="admin-mono">revoked_at</span> and the API
        refuses the token from the next request on — the row stays, so{' '}
        <span className="admin-mono">last_seen_at</span> remains as the trail of a token that may have leaked.
      </p>

      <Notices params={params} />

      <h2>Mint</h2>
      {players.length === 0 ? (
        <Empty>No players yet, so there is nobody to mint a token for.</Empty>
      ) : (
        <form method="post" action="/api/admin/tokens">
          <input type="hidden" name="action" value="mint" />
          <label>
            <span className="admin-muted">player </span>
            <select name="playerId" aria-label="Player" defaultValue={players[0]?.id ?? ''}>
              {players.map((player) => (
                <option key={player.id} value={player.id}>
                  {playerLabel(player)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="admin-muted">label </span>
            <input type="text" name="label" placeholder="bilal's desktop" aria-label="Label" />
          </label>
          <button type="submit">Mint token</button>
        </form>
      )}

      <h2>Tokens</h2>
      {tokens.length === 0 ? (
        <Empty>
          No tokens yet. Mint one above and send it to whoever runs the companion — they paste it in when the
          companion asks.
        </Empty>
      ) : (
        <div className="admin-scroll">
          <table>
            <thead>
              <tr>
                <th>Player</th>
                <th>Label</th>
                <th>Created</th>
                <th>Last seen</th>
                <th>Revoked</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tokens.map((token) => (
                <tr key={token.id}>
                  {/* The name, the Riot ID, then a PUUID fragment: minting for the wrong
                      person is a live credential handed to the wrong friend (M1.7). */}
                  <td title={token.puuid}>{playerLabel(token)}</td>
                  <td>{token.label ?? '—'}</td>
                  <td>{formatTimestamp(token.createdAt)}</td>
                  <td>{formatTimestamp(token.lastSeenAt)}</td>
                  <td>{token.revokedAt === null ? 'active' : formatTimestamp(token.revokedAt)}</td>
                  <td>
                    {token.revokedAt === null ? (
                      <form method="post" action="/api/admin/tokens">
                        <input type="hidden" name="action" value="revoke" />
                        <input type="hidden" name="tokenId" value={token.id} />
                        <button type="submit">Revoke</button>
                      </form>
                    ) : (
                      <span className="admin-muted">revoked</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
