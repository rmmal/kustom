/**
 * `splits.roster_key` is the denormalised "which ten people were these" key. The API
 * writes it when it stores a split and looks it up to find the most recent chosen split
 * for the same ten players, which is what the balancer takes as `lastSplit`.
 *
 * Sorted so the key does not depend on team, side, or the order the client listed them.
 */
export function rosterKey(puuids: readonly string[]): string {
  if (puuids.length === 0) {
    throw new Error('rosterKey: needs at least one puuid');
  }

  const sorted = [...puuids].sort();
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] === sorted[i - 1]) {
      throw new Error(`rosterKey: duplicate puuid ${String(sorted[i])}`);
    }
  }

  return sorted.join(',');
}
