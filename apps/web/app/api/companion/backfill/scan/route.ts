import { companionBackfillScanRequestSchema, companionBackfillScanResponseSchema } from '@customs/db/schemas';
import { withCompanionAuth } from '@/lib/companionRoute';
import { jsonOk } from '@/lib/http';
import { markBackfillRequested, selectBackfillApproval, selectUnknownGameIds } from '@/lib/ingest/backfill';

// node:crypto hashes the bearer token, so this route is not edge-compatible.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `POST /api/companion/backfill/scan` (M5.1): "which of these games do you already have, and
 * may I send the rest?"
 *
 * One round trip answers both, which is what keeps the walker off the client's back: an id we
 * already have is never worth a `GET /lol-match-history/v1/games/{gameId}`, and the detail
 * fetch is the expensive part of a backfill pass.
 *
 * **The contract is the doc comment on `companionBackfillScanRequestSchema`**
 * (`packages/db/src/schemas/companionResponses.ts`) and is deliberately not restated here.
 * Two things this file is responsible for keeping true:
 *
 * - Not approved is `{ approved: false, unknown: [] }` — never a leak of which games exist,
 *   and never a 404, which the companion reads as "the route is not deployed yet, wait".
 * - `players.backfill_requested_at` is set on the first unapproved scan and never moved.
 *
 * Approval is the token's *player*, read fresh on every call, so an admin's `Revoke` takes
 * effect on the next pass without touching a token.
 *
 * This route writes nothing else. The games themselves go to `POST /api/companion/game` with
 * `source: 'backfill'`, which stores them and does not rate them: `pnpm --filter web
 * rebuild-ratings` (M5.2) is what turns a batch into ratings.
 */
export const POST = withCompanionAuth(
  companionBackfillScanRequestSchema,
  async (payload, { client, identity }) => {
    const approval = await selectBackfillApproval(client, identity.playerId);

    if (!approval.approved) {
      const first = await markBackfillRequested(client, identity.playerId, new Date());
      if (first) {
        console.info(`backfill: ${identity.puuid} asked to send match history; approve it on /admin/players`);
      }
      return jsonOk(companionBackfillScanResponseSchema, { ok: true, approved: false, unknown: [] });
    }

    const unknown = await selectUnknownGameIds(client, payload.gameIds);
    return jsonOk(companionBackfillScanResponseSchema, { ok: true, approved: true, unknown });
  },
);
