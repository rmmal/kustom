import { roleTonightRoute } from './handler';

// The service-role client and the session lookup keep this on Node.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Set (or clear) the role a player wants for tonight (M3.6).
 *
 * Session-gated, and the first route of the **third class**: a Supabase session with a linked
 * player and no `is_admin`. 401 without a session, 403 for a session with no linked player,
 * 403 for a body that names somebody else's PUUID unless the caller is an admin.
 */
export const POST = roleTonightRoute();
