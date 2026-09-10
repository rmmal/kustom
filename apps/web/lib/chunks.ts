/**
 * One id list, cut into lists short enough to be a URL.
 *
 * **A PostgREST filter is a URL**, and a long enough `in` list is answered `414 URI too long`
 * by the gateway before Postgres sees it — which is not theoretical: reading a busy week's
 * board against a database with a few hundred players hit it on the first try (2026-09-10).
 * Ten rows a game also means ninety games is nine hundred scoreboard rows, which is the other
 * reason this number is small.
 *
 * It lived in `lib/board/load.ts` until M5.21, when the board started reading its streak from
 * `lib/stats/load.ts` — which was already importing this function *out* of the board. One
 * module both loaders import is the whole reason this file exists; there is no cycle to reason
 * about and no second definition of the chunk size.
 */

/** How many ids go in one `in (…)` list. */
const ID_CHUNK = 90;

/**
 * The unique ids, in lists short enough to be a URL. Empty in, nothing out — a caller with no
 * ids makes **no request at all**, which is what `[]` means and `undefined` does not.
 *
 * Exported for its unit test: it is two lines of arithmetic that only fails on a database
 * bigger than any test fixture, which is exactly the kind of code that ships broken.
 */
export function inChunks(ids: readonly string[]): string[][] {
  const unique = [...new Set(ids)];
  const chunks: string[][] = [];
  for (let start = 0; start < unique.length; start += ID_CHUNK) {
    chunks.push(unique.slice(start, start + ID_CHUNK));
  }
  return chunks;
}
