import type { NextResponse } from 'next/server';
import { openingOnPcLine, type StartLobbyOptions, startLobby } from '@/lib/admin/lobbyStart';
import { type AdminContext, type AdminRouteOptions, redirectBack, withAdminAuth } from '@/lib/adminRoute';
import { safeNextPath } from '@/lib/authNext';
// Registers the `onAcked` listener that fans the invites out (M4.2) and the `balanced` listener
// that queues `switch_side` (M4.1). A side-effect import, exactly as on the companion routes:
// with this line removed the press still queues its `create_lobby` and nothing else happens.
import '@/lib/commands/register';
import { nightTimeZone } from '@/lib/tonight/night';
import { type StartLobbyRequest, startLobbyRequestSchema, startLobbyResponseSchema } from './schema';

/**
 * Start a lobby (M4.2). The rules — who hosts, the name, the password, the four refusals — are
 * `lib/admin/lobbyStart.ts`; this is the boundary and nothing else.
 *
 * **Admin-gated for now** (`04-decisions.md`, 2026-09-10). M4.2's brief opens the press to any
 * signed-in visitor with a `players` row through M3.6's third route class, and that class does
 * not exist yet; keeping the rules in a helper and the session check in the wrapper is what
 * makes widening it later an auth swap rather than a rewrite.
 *
 * Both shapes, like every other admin write: the envelope for a JSON caller, a 303 back to the
 * page carrying the sentence for a browser form, and authentication failures always the
 * envelope so "401 without a session, 403 for a non-admin" is one assertion either way.
 */
export async function handleStartLobby(
  input: StartLobbyRequest,
  context: AdminContext,
  options: StartLobbyOptions = {},
): Promise<NextResponse> {
  const back = safeNextPath(input.redirectTo) ?? context.redirectTo;

  const result = await startLobby(
    context.client,
    // The presser comes from the **session**, never from the body: whose client opens a lobby is
    // a real decision, and a body that could name someone else would be a request to open a
    // lobby on a stranger's PC.
    { pressedByPlayerId: context.admin.playerId },
    { timeZone: nightTimeZone(), ...options },
  );

  if (!result.ok) {
    // One of the four sentences, every one of them a 409 and none of them a write.
    return context.form
      ? redirectBack(context.request, back, { error: result.error })
      : context.fail(result.status, result.error);
  }

  const value = result.value;
  const message = openingOnPcLine(value.hostName);
  if (context.form) return redirectBack(context.request, back, { notice: message });

  return context.respond(
    startLobbyResponseSchema,
    {
      ok: true,
      commandId: value.commandId,
      host: { playerId: value.host.playerId, puuid: value.host.puuid, name: value.hostName },
      lobbyName: value.lobbyName,
      lobbyPassword: value.lobbyPassword,
      cycle: value.cycle,
      expiresAt: value.expiresAt,
    },
    message,
  );
}

export interface StartLobbyRouteOptions extends AdminRouteOptions {
  /** Tests only: the clock, the gate override and the password source. */
  start?: StartLobbyOptions;
}

/**
 * The route. `redirectTo` defaults to `/admin`; the tonight page's no-JavaScript fallback sends
 * `/` in the body (M3.4) and its JavaScript control posts JSON and never navigates.
 */
export function startLobbyRoute(
  options: StartLobbyRouteOptions = {},
): (request: Request) => Promise<NextResponse> {
  const { start, ...routeOptions } = options;
  return withAdminAuth(
    startLobbyRequestSchema,
    (input, context) => handleStartLobby(input, context, start ?? {}),
    { redirectTo: '/admin', ...routeOptions },
  );
}
