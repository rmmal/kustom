import type { NextResponse } from 'next/server';
import { startSeason } from '@/lib/admin/seasons';
import type { AdminContext } from '@/lib/adminRoute';
import { type StartSeasonRequest, startSeasonResponseSchema } from './schema';

/** See `app/api/admin/players/handler.ts` for why the handler is not inside `route.ts`. */
export async function handleStartSeason(
  input: StartSeasonRequest,
  context: AdminContext,
): Promise<NextResponse> {
  const result = await startSeason(context.client, {
    name: input.name,
    confirmSeasonName: input.confirmSeasonName,
  });
  // A missing or wrong confirmation lands here as a 400: the envelope for a JSON caller, a 303
  // back to `/admin/seasons` with `?error=` for the form. Nothing was written either way.
  if (!result.ok) return context.fail(result.status, result.error);

  const { started, ended } = result.value;
  return context.respond(
    startSeasonResponseSchema,
    {
      ok: true,
      season: { id: started.id, name: started.name, startsAt: started.startsAt, isActive: true },
      endedSeason: ended === null ? null : { id: ended.id, name: ended.name },
    },
    // What just happened, both halves of it: what ended and what the group is looking at now.
    ended === null
      ? `${started.name} is now the active season, and its leaderboard starts empty.`
      : `${ended.name} has ended. ${started.name} is now the active season, and its leaderboard starts empty.`,
  );
}
