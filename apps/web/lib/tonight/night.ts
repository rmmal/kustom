import { DEFAULT_NIGHT_TIME_ZONE, isValidTimeZone, nightStart } from '../night';

/**
 * "Tonight", for the tonight page: the 06:00 boundary of the night containing `now`, in
 * `CUSTOMS_NIGHT_TZ` (M2.5, `lib/night.ts`).
 *
 * **This is a server helper and the browser never has one.** The boundary is computed here,
 * once per request, and travels to the client inside the snapshot; the alternative is a second
 * copy of `night.ts`'s calendar arithmetic in the browser bundle, and two definitions of which
 * night it is — one of which would be in a timezone the deployment did not configure.
 *
 * Not `readServerEnv()`: that requires `SUPABASE_SERVICE_ROLE_KEY`, and the tonight page is
 * public and reads with the anon key. Same variable, same validator, one less thing this page
 * needs to be configured with.
 */
export function tonightStart(now: Date = new Date()): Date {
  return nightStart(now, nightTimeZone());
}

/**
 * `CUSTOMS_NIGHT_TZ`, validated, or the group's own zone.
 *
 * Every surface that turns an instant into words for a reader needs this — the night boundary
 * above, and the date beside a game on `/p/[puuid]` (M3.5) — and reading the variable in two
 * places is how two pages end up in two timezones. Server only: the browser has no environment,
 * which is why both callers are server components and the answer travels in their output.
 */
export function nightTimeZone(): string {
  const configured = process.env.CUSTOMS_NIGHT_TZ?.trim();
  return configured && isValidTimeZone(configured) ? configured : DEFAULT_NIGHT_TIME_ZONE;
}
