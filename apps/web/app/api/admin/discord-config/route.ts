import { withAdminAuth } from '@/lib/adminRoute';
import { handleDiscordConfig } from './handler';
import { discordConfigRequestSchema } from './schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Save the guild id, the results webhook and the voice channel ids the bot (M4) moves people
 * between. Session-gated: 401 without a session, 403 for anyone who is not `players.is_admin`.
 */
export const POST = withAdminAuth(discordConfigRequestSchema, handleDiscordConfig, {
  redirectTo: '/admin/discord',
});
