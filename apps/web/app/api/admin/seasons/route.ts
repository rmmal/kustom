import { withAdminAuth } from '@/lib/adminRoute';
import { handleStartSeason } from './handler';
import { startSeasonRequestSchema } from './schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Start a new season: closes the current one and activates the new one in one transaction.
 * Session-gated: 401 without a session, 403 for anyone who is not `players.is_admin`.
 */
export const POST = withAdminAuth(startSeasonRequestSchema, handleStartSeason, {
  redirectTo: '/admin/seasons',
});
