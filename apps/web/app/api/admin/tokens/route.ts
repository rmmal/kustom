import { withAdminAuth } from '@/lib/adminRoute';
import { handleAdminTokens } from './handler';
import { adminTokensRequestSchema } from './schema';

// node:crypto mints the token, so this route is not edge-compatible.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Mint a companion token (shown once) or revoke one. Session-gated: 401 without a session,
 * 403 for anyone who is not `players.is_admin`.
 */
export const POST = withAdminAuth(adminTokensRequestSchema, handleAdminTokens, {
  redirectTo: '/admin/tokens',
});
