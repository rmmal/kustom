import type { NextResponse } from 'next/server';
import { promoteSplit } from '@/lib/admin/reroll';
import { type AdminContext, type AdminRouteOptions, withAdminAuth } from '@/lib/adminRoute';
import { postTeamsForSplit } from '@/lib/discord/post';
import { siteOrigin } from '@/lib/siteUrl';
import { type RerollRequest, rerollRequestSchema, rerollResponseSchema } from './schema';

/**
 * Reroll (M3.2). See `app/api/admin/players/handler.ts` for why the handler is not in
 * `route.ts`; here there is a second reason — the lobby id comes from the path, so the route
 * curries it in and the tests can too.
 *
 * Promote, then post. In that order and never the other way round: the promotion is what the
 * group agreed to and it stands whatever Discord answers. The response says whether the
 * message went out, and nothing retries it.
 */
export async function handleReroll(
  lobbyId: string,
  input: RerollRequest,
  context: AdminContext,
): Promise<NextResponse> {
  const result = await promoteSplit(context.client, { lobbyId, splitId: input.splitId });
  // A lobby that is not `balanced`, a split of another lobby, or a third press: the envelope
  // for a JSON caller, a 303 back to `/admin` with `?error=` for the form. Nothing was written
  // and nothing was posted either way.
  if (!result.ok) return context.fail(result.status, result.error);

  const { splitId, rank, splitCount, promoted } = result.value;

  // Already chosen: 200, nothing promoted, nothing posted. Two taps produce one message.
  const outcome = promoted
    ? await postTeamsForSplit(context.client, splitId, { requestOrigin: siteOrigin(context.request) })
    : null;

  return context.respond(
    rerollResponseSchema,
    {
      ok: true,
      lobbyId,
      splitId,
      rank,
      splitCount,
      promoted,
      post: outcome === null ? null : outcome.status,
    },
    notice({ rank, splitCount, promoted, post: outcome === null ? null : outcome.status }),
  );
}

/** What `/admin` says after the press, in the words the channel just saw. */
function notice(result: {
  rank: number;
  splitCount: number;
  promoted: boolean;
  post: 'posted' | 'skipped' | 'failed' | null;
}): string {
  if (!result.promoted) {
    return `Split ${result.rank} was already the one on the board. Nothing was posted.`;
  }

  const rerolls = Math.max(result.splitCount - 1, result.rank - 1);
  const which =
    result.rank === 1
      ? 'Split 1 is back on the board.'
      : `Split ${result.rank} is up: reroll ${result.rank - 1} of ${rerolls}.`;

  switch (result.post) {
    case 'posted':
      return `${which} Posted to Discord.`;
    case 'skipped':
      return `${which} No webhook is configured, so nothing was posted.`;
    default:
      return `${which} Discord did not take the post, but the teams stand.`;
  }
}

/**
 * The route, with the lobby id from the path already in hand.
 *
 * `redirectTo` is `/admin`, which is where the only reroll control lives until the tonight
 * page grows its own (M3.4).
 */
export function rerollRoute(
  lobbyId: string,
  options: AdminRouteOptions = {},
): (request: Request) => Promise<NextResponse> {
  return withAdminAuth(rerollRequestSchema, (input, context) => handleReroll(lobbyId, input, context), {
    redirectTo: '/admin',
    ...options,
  });
}
