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
  const configured = process.env.CUSTOMS_NIGHT_TZ?.trim();
  const timeZone = configured && isValidTimeZone(configured) ? configured : DEFAULT_NIGHT_TIME_ZONE;
  return nightStart(now, timeZone);
}
