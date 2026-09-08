/**
 * The one place that turns a `players` row into something a human reads (M1.7).
 *
 * Every admin surface uses it, so no page can invent its own fallback and end up showing a
 * blank cell or a bare PUUID fragment where another page shows a name. The chain is
 * `display_name`, then the Riot ID, then a PUUID fragment as a last resort — a row first seen
 * in an end-of-game block has no `gameName` at all until a lobby or rank post names it, so the
 * last resort is reachable and has to read as an identifier rather than as nothing.
 *
 * Pure and string-only: unit-tested next to the other admin rules, not through a page.
 */

export interface NameableRow {
  puuid: string;
  displayName: string | null;
  gameName: string | null;
  tagLine?: string | null;
}

/** The first eight characters of a PUUID: enough to recognise a row, short enough to read. */
export function shortPuuid(puuid: string): string {
  return puuid.length <= 12 ? puuid : `${puuid.slice(0, 8)}…`;
}

/**
 * `Hamoodi`, else `Ahmed#EUW`, else `a1b2c3d4…`.
 *
 * Whitespace-only values count as absent: an admin who saves a name of spaces gets the Riot ID
 * back rather than an empty cell (the route stores null for that, but a row written before this
 * existed, or by hand in Studio, can still hold one).
 */
export function playerLabel(row: NameableRow): string {
  const displayName = row.displayName?.trim();
  if (displayName) return displayName;

  const gameName = row.gameName?.trim();
  if (gameName) {
    const tagLine = row.tagLine?.trim();
    return tagLine ? `${gameName}#${tagLine}` : gameName;
  }

  return shortPuuid(row.puuid);
}
