import type { NextResponse } from 'next/server';
import { startSeason } from '@/lib/admin/seasons';
import type { AdminContext } from '@/lib/adminRoute';
import { type StartSeasonRequest, startSeasonResponseSchema } from './schema';

/** See `app/api/admin/players/handler.ts` for why the handler is not inside `route.ts`. */
export async function handleStartSeason(
  input: StartSeasonRequest,
  context: AdminContext,
): Promise<NextResponse> {
  const result = await startSeason(context.client, input.name);
  if (!result.ok) return context.fail(result.status, result.error);

  const season = result.value;
  return context.respond(
    startSeasonResponseSchema,
    {
      ok: true,
      season: { id: season.id, name: season.name, startsAt: season.startsAt, isActive: true },
    },
    `${season.name} is now the active season`,
  );
}
