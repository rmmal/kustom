import type { NextResponse } from 'next/server';
import { startLobbyRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Open tonight's lobby on somebody's client (M4.2): one `create_lobby` command for the host the
 * server picked, and the invites follow off its ack.
 *
 * Session-gated like every other admin route: 401 without a session, 403 for anyone who is not
 * `players.is_admin`. The body carries nothing but where a form post goes back to.
 */
export async function POST(request: Request): Promise<NextResponse> {
  return startLobbyRoute()(request);
}
