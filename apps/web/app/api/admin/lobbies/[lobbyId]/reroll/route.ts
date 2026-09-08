import type { NextResponse } from 'next/server';
import { rerollRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Promote split 2 or 3 of a balanced lobby and post it again (M3.2).
 *
 * Session-gated like every other admin route: 401 without a session, 403 for anyone who is
 * not `players.is_admin`. The lobby is the path, the split is the body.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ lobbyId: string }> },
): Promise<NextResponse> {
  const { lobbyId } = await context.params;
  return rerollRoute(lobbyId)(request);
}
