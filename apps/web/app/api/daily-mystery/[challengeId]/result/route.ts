import { mysteryGuessResponseSchema } from '@customs/db/schemas';
import { jsonError, jsonOk } from '@/lib/http';
import { visitorFromRequest, withMysteryCookie } from '@/lib/mystery/request';
import { loadResultForVisitor } from '@/lib/mystery/service';
import { getServiceClient } from '@/lib/supabase';
import { nightTimeZone } from '@/lib/tonight/night';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Fresh community numbers for a visitor who already locked today's guess.
 * Refuses anyone who has not submitted — distribution stays hidden until then.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ challengeId: string }> },
): Promise<Response> {
  const visitorId = visitorFromRequest(request);
  if (visitorId === null) return jsonError(400, 'anonymous visitor id is required');

  const { challengeId } = await context.params;
  const result = await loadResultForVisitor(getServiceClient(), {
    challengeId,
    visitorId,
    timeZone: nightTimeZone(),
  });
  if ('error' in result) return jsonError(result.status, result.error);
  return withMysteryCookie(
    jsonOk(mysteryGuessResponseSchema, { ok: true, result: result.result }),
    visitorId,
  );
}
