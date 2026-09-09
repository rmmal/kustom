import { selfLinkRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Link the signed-in Discord account to a player row, once, by picking yourself out of
 * tonight's lobby (M3.6).
 *
 * 401 without a session, 403 for a session with no Discord identity, 403 for a PUUID that is
 * not in tonight's lobby, 409 for a player somebody is already linked to and for a session
 * that is already linked. An admin can undo any link on `/admin/players`.
 */
export const POST = selfLinkRoute();
