/**
 * Reported in the `User-Agent` of every API call and on the first console line.
 *
 * The packaged exe (M2.6) stamps the release version at build time through an esbuild `define`
 * (`__CUSTOMS_NIGHT_VERSION__`, read from `apps/companion/package.json`). Under `pnpm --filter companion dev`
 * the define is absent and the version says so.
 */

declare const __CUSTOMS_NIGHT_VERSION__: string | undefined;

export const COMPANION_VERSION: string =
  typeof __CUSTOMS_NIGHT_VERSION__ === 'string' ? __CUSTOMS_NIGHT_VERSION__ : '0.0.0-dev';

export const USER_AGENT = `customs-night-companion/${COMPANION_VERSION} (${process.platform})`;
