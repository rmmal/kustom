/**
 * "Saying who you are, on every start" (M2.3): one `GET /api/companion/me` before anything else, and
 * immediately after the first-run prompt. On 200 one line, `signed in as <displayName>`. On 401 one plain
 * sentence naming the admin page, no stack trace, and the process keeps running: the token may be revoked
 * mid-season and the queue still has work. On a network error or a 5xx, say the API is not answering yet and
 * carry on. This call never blocks the watcher or the queue; it is one attempt, and its answer is a log line.
 */

import { companionMeResponseSchema } from '@customs/db/schemas';
import { type ApiClient, describeFailure } from './api.js';
import type { CompanionLogger } from './log.js';

export const ME_API_PATH = '/api/companion/me';

export type IdentityOutcome =
  | {
      readonly status: 'ok';
      readonly puuid: string;
      readonly playerId: string;
      readonly displayName: string | null;
    }
  /** The API answered and said no (401, or any other 4xx). */
  | { readonly status: 'refused'; readonly httpStatus: number; readonly error: string }
  /** No usable answer: network, 5xx, a body we could not read. */
  | { readonly status: 'unavailable'; readonly reason: string };

export const TOKEN_REFUSED_SENTENCE =
  'The API refused this companion token; mint a new one on the admin page, paste it into config.json and start the companion again.';

export async function checkIdentity(api: ApiClient): Promise<IdentityOutcome> {
  const result = await api.request('GET', ME_API_PATH, undefined, companionMeResponseSchema, 1);
  if (result.ok) {
    return {
      status: 'ok',
      puuid: result.data.puuid,
      playerId: result.data.playerId,
      displayName: result.data.displayName,
    };
  }
  if (result.reason === 'http' && result.status >= 400 && result.status < 500) {
    return { status: 'refused', httpStatus: result.status, error: result.error };
  }
  return { status: 'unavailable', reason: describeFailure(result) };
}

/** The one line a friend sees for each outcome. */
export function identityLine(outcome: IdentityOutcome): string {
  switch (outcome.status) {
    case 'ok':
      return `signed in as ${outcome.displayName ?? `player ${outcome.puuid} (no display name yet)`}`;
    case 'refused':
      return TOKEN_REFUSED_SENTENCE;
    case 'unavailable':
      return `the API is not answering yet (${outcome.reason}); it will be retried with every post`;
  }
}

export function announceIdentity(outcome: IdentityOutcome, logger: CompanionLogger): void {
  const line = identityLine(outcome);
  switch (outcome.status) {
    case 'ok':
      logger.info(line, { puuid: outcome.puuid, playerId: outcome.playerId });
      return;
    case 'refused':
      logger.error(line, { status: outcome.httpStatus });
      return;
    case 'unavailable':
      logger.warn(line);
      return;
  }
}
