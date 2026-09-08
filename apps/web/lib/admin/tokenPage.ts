/**
 * The one-time page a freshly minted companion token is shown on.
 *
 * It is a hand-written document rather than a React page because the token must exist in
 * exactly one HTTP response and never in a URL, a cookie or a database column: the route
 * handler that mints it answers with this, and a refresh re-posts nothing, so there is no
 * second chance to read it. Deliberately minimal markup — M3.0 restyles the admin area.
 */

export interface MintedTokenPageInput {
  token: string;
  puuid: string;
  label: string | null;
  /** Where "back to tokens" goes. */
  backTo: string;
}

export function renderMintedTokenPage(input: MintedTokenPageInput): string {
  const label = input.label ?? 'no label';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Companion token</title>
    <style>
      :root { color-scheme: light dark; }
      body { font: 16px/1.5 system-ui, sans-serif; margin: 0 auto; max-width: 40rem; padding: 1.5rem; }
      code { display: block; overflow-wrap: anywhere; padding: 0.75rem; border: 1px solid; border-radius: 0.25rem; font-size: 1rem; }
      dt { font-weight: 600; }
      dd { margin: 0 0 0.5rem; }
    </style>
  </head>
  <body>
    <h1>Companion token</h1>
    <p><strong>Copy it now.</strong> Only its hash is stored, so this is the only time it is shown.</p>
    <code>${escapeHtml(input.token)}</code>
    <dl>
      <dt>PUUID</dt><dd>${escapeHtml(input.puuid)}</dd>
      <dt>Label</dt><dd>${escapeHtml(label)}</dd>
    </dl>
    <p>Paste it into the companion's first-run prompt (<code>%APPDATA%/customs-night/config.json</code>).</p>
    <p><a href="${escapeHtml(input.backTo)}">Back to tokens</a></p>
  </body>
</html>
`;
}

/** Everything interpolated above goes through this. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
