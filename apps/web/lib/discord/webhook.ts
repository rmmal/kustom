import type { ServiceClient } from '../supabase';
import type { WebhookPayload } from './embeds';

/**
 * The only I/O in `lib/discord`: one POST to the webhook URL in `discord_config`.
 *
 * Rules this file exists to keep (M3.1, "Webhook missing, or Discord refuses the post"):
 *
 * - **It never throws.** Every caller is a lobby hook, and a hook that throws is a night with
 *   no teams on the tonight page. Failures are one log line and a returned status.
 * - **It never loops.** Five seconds a try, one retry on a 5xx or a network error, one wait
 *   on a 429 that tells us how long. Then it gives up: the tonight page is the other surface
 *   and it must not depend on Discord having accepted anything.
 * - **No secret leaves this file.** The webhook URL is a bearer credential (`discord_config`
 *   has no read policy at all); it is never logged, never returned, never put in an error.
 */

/** How long one attempt may take. Discord answers a webhook in well under a second. */
export const WEBHOOK_TIMEOUT_MS = 5_000;

/** Attempts in total, not retries: one try, then one more. */
const MAX_ATTEMPTS = 2;

/** A 429 we will wait out. Anything longer and the post is stale by the time it lands. */
const MAX_RETRY_AFTER_MS = 5_000;

/** How long to wait before the retry of a 5xx or a network error. */
const RETRY_DELAY_MS = 500;

export interface WebhookOutcome {
  /** `posted` — Discord took it. `skipped` — nothing configured. `failed` — it did not land. */
  status: 'posted' | 'skipped' | 'failed';
  /** The HTTP status of the last attempt, when there was one. */
  httpStatus: number | null;
  /** Why it did not land. Never contains the URL. */
  reason: string | null;
  attempts: number;
}

export interface WebhookOptions {
  /** Injected in tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injected in tests so a 429 does not cost the suite a second. */
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * POST one payload. Resolves with what happened; never rejects.
 *
 * `?wait=true` is deliberately not used: we do not need the created message back, and asking
 * for it makes Discord hold the connection open for the message to be persisted.
 */
export async function postWebhookPayload(
  url: string,
  payload: WebhookPayload,
  options: WebhookOptions = {},
): Promise<WebhookOutcome> {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const sleep = options.sleep ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? WEBHOOK_TIMEOUT_MS;

  let lastStatus: number | null = null;
  let lastReason = 'no attempt was made';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await doFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      // A timeout is an `AbortError` and reads the same as a refused connection from here:
      // nothing landed, and one more try is all we owe it.
      lastReason = error instanceof Error ? error.name : 'network error';
      lastStatus = null;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      break;
    }

    lastStatus = response.status;
    const retryAfterMs = response.status === 429 ? await readRetryAfterMs(response) : null;
    // Drain the body so the socket is released; nothing here reads it.
    if (response.status !== 429) await response.text().catch(() => '');

    if (response.ok) {
      return { status: 'posted', httpStatus: response.status, reason: null, attempts: attempt };
    }

    if (response.status === 429 && attempt < MAX_ATTEMPTS) {
      lastReason = 'rate limited';
      await sleep(Math.min(retryAfterMs ?? RETRY_DELAY_MS, MAX_RETRY_AFTER_MS));
      continue;
    }

    lastReason = `HTTP ${response.status}`;
    // A 4xx is our payload or a dead webhook; retrying it changes nothing.
    if (response.status < 500 || attempt >= MAX_ATTEMPTS) break;
    await sleep(RETRY_DELAY_MS);
  }

  return { status: 'failed', httpStatus: lastStatus, reason: lastReason, attempts: MAX_ATTEMPTS };
}

/**
 * Discord's 429 body is `{ retry_after: 0.75 }` in seconds; the `retry-after` header is the
 * fallback. An unreadable body is not an error — the caller falls back to its own delay.
 */
async function readRetryAfterMs(response: Response): Promise<number | null> {
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && 'retry_after' in body) {
      const value = (body as { retry_after: unknown }).retry_after;
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value * 1_000;
    }
  } catch {
    // Not JSON. The header may still say.
  }

  const header = response.headers.get('retry-after');
  const seconds = header === null ? Number.NaN : Number.parseFloat(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : null;
}

/**
 * The configured webhook URL, or `null`.
 *
 * The oldest row with a URL wins: `discord_config` is keyed by guild and this group has one
 * guild, but a leftover row from a second one must not be able to silently take over the
 * posting by being written more recently. `/admin/discord` says so when there is more than
 * one row.
 */
export async function selectWebhookUrl(client: ServiceClient): Promise<string | null> {
  const { data, error } = await client
    .from('discord_config')
    .select('webhook_url')
    .not('webhook_url', 'is', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(`discord: reading discord_config failed: ${error.message}`);
    return null;
  }

  const url = data?.webhook_url?.trim();
  return url && url.length > 0 ? url : null;
}

/** Said once per process, not once per lobby: an unconfigured webhook is not an incident. */
let warnedAboutMissingWebhook = false;

/** Tests only. */
export function resetWebhookWarning(): void {
  warnedAboutMissingWebhook = false;
}

/**
 * Read the config and post. `label` is what the log line calls this message, and it is the
 * only thing about the message that is ever logged.
 */
export async function postToWebhook(
  client: ServiceClient,
  payload: WebhookPayload,
  label: string,
  options: WebhookOptions = {},
): Promise<WebhookOutcome> {
  const url = await selectWebhookUrl(client);
  if (url === null) {
    if (!warnedAboutMissingWebhook) {
      warnedAboutMissingWebhook = true;
      console.info('discord: no webhook configured; skipping posts until one is set in /admin/discord');
    }
    return { status: 'skipped', httpStatus: null, reason: 'no webhook configured', attempts: 0 };
  }

  const outcome = await postWebhookPayload(url, payload, options);
  if (outcome.status === 'failed') {
    console.error(`discord: posting the ${label} failed after ${outcome.attempts}: ${outcome.reason}`);
  }
  return outcome;
}
