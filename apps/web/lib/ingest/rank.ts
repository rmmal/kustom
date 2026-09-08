import type { CompanionRankPayload, PlayerUpdate } from '@customs/db';
import type { ServiceClient } from '../supabase';
import { ensurePlayers } from './players';

/**
 * Rank ingest. The companion reports its own rank every few hours and the rank of every
 * unknown PUUID it sees in a lobby (M2.4), so this accepts any PUUID rather than only the
 * token's own player — the rank is a lookup the client did, not a claim about identity.
 *
 * `packages/core` turns the tier and division strings into a seed and treats anything it does
 * not recognise as unranked, so the strings are stored exactly as the client said them.
 *
 * The payload may also carry `gameName`/`tagLine` from the same sweep (M2.4). Those are
 * applied even when the queue is one we do not seed from: a name is a name whatever ladder it
 * came off.
 */

/** The only queue whose rank seeds a rating (`docs/01-architecture.md` "Rating model"). */
export const SEEDING_QUEUE = 'RANKED_SOLO_5x5';

export interface RankIngestResult {
  playerId: string;
  /** False when the payload was for a queue we do not seed from; the row is untouched. */
  stored: boolean;
}

export async function ingestRank(
  client: ServiceClient,
  payload: CompanionRankPayload,
  now: Date = new Date(),
): Promise<RankIngestResult> {
  // The names ride along with the rank (M2.4): the sweep looks up exactly the PUUIDs whose
  // Riot ID we are missing, because a lobby member carries none. `ensurePlayers` applies the
  // M1.7 rule — `display_name` follows `game_name` while it is automatic and an admin's
  // override is never touched — and writes nothing when neither was sent.
  const playerIds = await ensurePlayers(client, [
    { puuid: payload.puuid, gameName: payload.gameName, tagLine: payload.tagLine },
  ]);
  const playerId = playerIds.get(payload.puuid);
  if (playerId === undefined) throw new Error(`ingestRank: player ${payload.puuid} was not created`);

  if (payload.queue !== SEEDING_QUEUE) {
    return { playerId, stored: false };
  }

  const patch: PlayerUpdate = {
    rank_tier: payload.tier,
    rank_division: payload.division,
    rank_lp: payload.lp,
    rank_updated_at: now.toISOString(),
  };

  const { error } = await client.from('players').update(patch).eq('id', playerId);
  if (error) throw new Error(`ingestRank: update failed: ${error.message}`);

  return { playerId, stored: true };
}
