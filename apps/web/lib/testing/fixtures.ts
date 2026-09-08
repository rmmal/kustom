import { type CompanionGameEogPayload, companionGamePayloadSchema } from '@customs/db/schemas';

/**
 * Request bodies for tests. Plain JSON, exactly what the companion would put on the wire, so
 * the same fixture can be posted to a route handler and parsed for a unit test.
 */

export const ROLES_IN_ORDER = ['top', 'jungle', 'mid', 'adc', 'support'] as const;

export interface EogBodyOptions {
  gameId: number;
  puuids: readonly string[];
  partyId?: string | null;
  gameType?: string | null;
  winningSide?: 100 | 200;
  startedAt?: string;
}

/** A ten-player end-of-game body: five on 100, five on 200, in the order given. */
export function eogBody(options: EogBodyOptions): Record<string, unknown> {
  const participants = options.puuids.map((puuid, index) => ({
    puuid,
    side: index < 5 ? 100 : 200,
    role: ROLES_IN_ORDER[index % 5],
    championId: 100 + index,
    kills: index,
    deaths: 10 - index,
    assists: index * 2,
    gold: 10_000 + index * 100,
    damageToChamps: 20_000 + index * 250,
    cs: 150 + index,
  }));

  return {
    phase: 'eog',
    gameId: options.gameId,
    partyId: options.partyId ?? null,
    gameType: options.gameType === undefined ? 'CUSTOM_GAME' : options.gameType,
    startedAt: options.startedAt ?? '2026-09-08T20:00:00.000Z',
    durationS: 1_920,
    winningSide: options.winningSide ?? 100,
    participants,
    raw: { gameId: options.gameId, gameType: options.gameType ?? 'CUSTOM_GAME', participants },
  };
}

/** The same body, parsed: what a route handler sees after zod. */
export function eogPayload(options: EogBodyOptions): CompanionGameEogPayload {
  const parsed = companionGamePayloadSchema.parse(eogBody(options));
  if (parsed.phase !== 'eog') throw new Error('eogPayload: expected the eog phase');
  return parsed;
}

/** Ten unique PUUIDs namespaced by a run id, so reruns never collide. */
export function testPuuids(runId: string, count = 10): string[] {
  return Array.from({ length: count }, (_, index) => `it-${runId}-p${index}`);
}

/** A game id that is unique per run and stays inside `Number.MAX_SAFE_INTEGER`. */
export function testGameId(): number {
  return Date.now() * 1_000 + Math.floor(Math.random() * 1_000);
}
