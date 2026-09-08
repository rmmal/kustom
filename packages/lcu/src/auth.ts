/**
 * Auth header and URL construction for the local client.
 * See docs/03-lcu-reference.md "Connecting".
 */

/** The client only listens on loopback. Never anything else. */
export const LCU_HOST = '127.0.0.1';

/** The Basic auth user is always `riot`; the password comes from the lockfile. */
export const LCU_USER = 'riot';

/** `Basic base64("riot:<password>")`. */
export function basicAuthHeader(password: string, user: string = LCU_USER): string {
  return `Basic ${Buffer.from(`${user}:${password}`, 'utf8').toString('base64')}`;
}

export function httpBaseUrl(port: number, host: string = LCU_HOST): string {
  return `https://${host}:${port}`;
}

export function wsBaseUrl(port: number, host: string = LCU_HOST): string {
  return `wss://${host}:${port}`;
}

/**
 * Joins a base URL and an endpoint path. Paths must be absolute (`/lol-summoner/v1/current-summoner`),
 * may carry a query string, and are used verbatim: callers are responsible for `encodeURIComponent`
 * on path parameters such as a Riot ID game name.
 */
export function buildUrl(base: string, path: string): string {
  if (!path.startsWith('/')) {
    throw new Error(`LCU path must start with "/": ${path}`);
  }
  return `${base}${path}`;
}
