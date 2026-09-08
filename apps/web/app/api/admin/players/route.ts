import { withAdminAuth } from '@/lib/adminRoute';
import { handleAdminPlayers } from './handler';
import { adminPlayersRequestSchema } from './schema';

// The service-role client and node:crypto (through the session lookup) keep this on Node.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Set a player's roles, link or unlink their Discord id, or change their admin flag.
 * Session-gated: 401 without a session, 403 for anyone who is not `players.is_admin`.
 */
export const POST = withAdminAuth(adminPlayersRequestSchema, handleAdminPlayers, {
  redirectTo: '/admin/players',
});
