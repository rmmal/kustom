import { z } from 'zod';

/**
 * Which customs `/games` and `/fun` are listing. The client's `gameMode` is the authority —
 * it is on both the end-of-game block and the match-history detail, and both land in
 * `games.raw`.
 *
 * **Summoner's Rift is the default.** ARAM is the other list. Anything else (Kiwi, a missing
 * mode that is not CLASSIC) is on neither: these pages are the two maps the group actually
 * plays as customs, not a third dump.
 */

export const QUEUE_ORDER = ['sr', 'aram'] as const;

export type QueueKind = (typeof QUEUE_ORDER)[number];

/** `/games` and `/fun` open on Rift. One tap is Howling Abyss. */
export const GAMES_QUEUE: QueueKind = 'sr';

export const queueKindSchema = z.enum(QUEUE_ORDER);

/**
 * The `?queue=` value, or `null` for anything that is not one of the two.
 *
 * Absent is the page's default (Rift). An unknown value is a 404, same rule as `?window=`.
 */
export function parseQueue(value: string | string[] | undefined, fallback: QueueKind): QueueKind | null {
  if (value === undefined) return fallback;
  const parsed = queueKindSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * The client's `gameMode` off `games.raw`: `CLASSIC`, `ARAM`, `KIWI`, or null when the
 * block never named one.
 */
export function gameModeFromRaw(raw: unknown): string | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const mode = (raw as { gameMode?: unknown }).gameMode;
  if (typeof mode !== 'string') return null;
  const trimmed = mode.trim();
  return trimmed === '' ? null : trimmed.toUpperCase();
}

/**
 * Whether a stored mode belongs on this list.
 *
 * Rift is `CLASSIC` and a missing mode (every night captured before this page existed was
 * Rift). ARAM is only `ARAM`. Kiwi and anything else stay off both lists.
 */
export function matchesQueue(gameMode: string | null | undefined, queue: QueueKind): boolean {
  const mode = (gameMode ?? '').trim().toUpperCase();
  if (queue === 'aram') return mode === 'ARAM';
  return mode === '' || mode === 'CLASSIC';
}
