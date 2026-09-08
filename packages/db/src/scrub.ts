/**
 * Keeps chat credentials out of `games.raw`.
 *
 * The end-of-game block carries the post-game chat room's credentials — `mucJwtDto` (a signed
 * JWT) and `multiUserChatPassword` — and `games` is **public-read** under RLS
 * (`0001_init.sql`), so storing the block verbatim publishes them. That is a leak, not
 * hygiene: this runs on the server, before the insert, every time.
 *
 * The companion may scrub too (M2.3 writes the block to disk first), but the server is the one
 * that has to be right, because old companion binaries keep running in people's tray for
 * months.
 *
 * Same convention and same marker as `packages/lcu/src/scrub.ts`, which does the wider
 * key-pattern scrub for recorded WebSocket events. This one is deliberately narrow: `games.raw`
 * is the thing every later column can be recomputed from (architecture "Data model"), so it
 * loses exactly the two values that are secret and nothing else.
 */

export const REDACTED = '[redacted]';

/** The keys whose values never reach the database, at any depth, in any casing. */
export const EOG_SECRET_KEYS: readonly string[] = ['mucJwtDto', 'multiUserChatPassword'];

const SECRET_KEYS = new Set(EOG_SECRET_KEYS.map((key) => key.toLowerCase()));

/** True for a key we replace. Case-insensitive: the client has renamed keys' casing before. */
export function isEogSecretKey(key: string): boolean {
  return SECRET_KEYS.has(key.toLowerCase());
}

/**
 * A deep copy of `value` with every `mucJwtDto` and `multiUserChatPassword` replaced by
 * `"[redacted]"`, however deep and however many. Everything else — key order, nulls, numbers,
 * arrays, empty objects — is preserved, so a scrubbed block still parses as the block it was.
 *
 * The input is never mutated: the caller keeps the original for anything it still needs, and
 * only the return value is stored.
 */
export function scrubRawEogBlock<T>(value: T): T {
  return scrub(value) as T;
}

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (typeof value !== 'object' || value === null) return value;

  // Object.fromEntries defines properties instead of assigning them, so a `__proto__` key in
  // a client payload stays an ordinary key rather than becoming the object's prototype.
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, inner]) => [
      key,
      isEogSecretKey(key) ? REDACTED : scrub(inner),
    ]),
  );
}
