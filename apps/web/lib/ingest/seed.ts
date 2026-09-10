import { type Rating, seedFromRank } from '@customs/core';

/**
 * Where a player's history starts (M5.7).
 *
 * A rating is a fold, and a fold needs a first value. That value used to be recomputed from
 * `players.rank_tier` every time anybody asked — by the live fold when it created somebody's
 * `ratings` row, and again from scratch by every `rebuild-ratings`. The two agree only while
 * nobody's rank moves: the day a friend climbs, the next rebuild re-seeds their whole history
 * from the new rank and every number on their page shifts with nothing able to say why.
 *
 * So the seed is **stored, once, by the fold that first rated the player** (`0012`:
 * `ratings.seed_mu`, `seed_sigma`, `seed_rank_tier`, `seed_rank_division`) and nothing ever
 * rewrites it. This file is that rule: how the columns are read, how they are written, and what
 * a fold uses when they are empty.
 *
 * It is deliberately not in `packages/core` — core knows `seedFromRank` and nothing about a
 * `ratings` row — and deliberately not in `fold.ts`, which takes no database shape at all.
 */

/** The seed a fold started from, with the rank it was read from. */
export interface StoredSeed {
  rating: Rating;
  /** `players.rank_tier` as it was when the seed was taken. Null is unranked, a real answer. */
  rankTier: string | null;
  rankDivision: string | null;
}

/**
 * The four seed columns of a `ratings` row, exactly as PostgREST returns and accepts them.
 *
 * `seed_mu` being null is what "no seed stored" means; the database's `ratings_seed_pair` check
 * keeps mu and sigma both-or-neither so that reading one of them is enough.
 */
export interface SeedColumns {
  seed_mu: number | null;
  seed_sigma: number | null;
  seed_rank_tier: string | null;
  seed_rank_division: string | null;
}

/** The stored seed of a row, or null when it has none (a row written before `0012`). */
export function readSeed(row: SeedColumns): StoredSeed | null {
  if (row.seed_mu === null || row.seed_sigma === null) return null;
  return {
    rating: { mu: row.seed_mu, sigma: row.seed_sigma },
    rankTier: row.seed_rank_tier,
    rankDivision: row.seed_rank_division,
  };
}

/** The same, the other way round: what to send in an insert or an upsert. */
export function seedColumns(seed: StoredSeed | null): SeedColumns {
  if (seed === null) {
    return { seed_mu: null, seed_sigma: null, seed_rank_tier: null, seed_rank_division: null };
  }
  return {
    seed_mu: seed.rating.mu,
    seed_sigma: seed.rating.sigma,
    seed_rank_tier: seed.rankTier,
    seed_rank_division: seed.rankDivision,
  };
}

/**
 * What a fold starts this player from: **the stored seed if there is one**, and their current
 * rank if there is not.
 *
 * The preference is the whole of M5.7. A rank read from the client last night says where
 * somebody is now; it does not say where the fold that produced their stored history began, and
 * once a game has been rated only the second question matters.
 */
export function seedFor(
  stored: StoredSeed | null,
  rankTier: string | null,
  rankDivision: string | null,
): StoredSeed {
  if (stored !== null) return stored;
  return { rating: seedFromRank(rankTier, rankDivision), rankTier, rankDivision };
}

/**
 * Do two seeds say the same thing? Used to decide whether a write would change anything.
 *
 * Exact equality on the numbers, with none of `RATING_EPSILON`'s tolerance, and that is safe
 * rather than lucky: the only comparison anybody makes is between a row's stored seed and the
 * seed a fold is about to write back for it, and {@link seedFor} hands back the stored object
 * untouched when there is one. A seed is never recomputed and compared to its round-tripped
 * self, which is the case the tolerance in `rebuild.ts` exists for.
 */
export function sameSeed(a: StoredSeed | null, b: StoredSeed | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.rating.mu === b.rating.mu &&
    a.rating.sigma === b.rating.sigma &&
    a.rankTier === b.rankTier &&
    a.rankDivision === b.rankDivision
  );
}
