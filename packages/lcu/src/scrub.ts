/**
 * Keeps secrets out of recorded WebSocket events.
 *
 * `OnJsonApiEvent` carries everything the client does, including login sessions (`/lol-login/v1/session` has
 * an `idToken`), RSO tokens (`/lol-rso-auth/v1/authorization`), Riot Client auth and chat. The recorder writes
 * to `fixtures/`, which is committed, so:
 *  - events whose URI is on the deny-list are written without `data` (URI and event type only, flagged
 *    `redacted: true`), so M0.3 still sees which events fire;
 *  - every other event has its `data` walked and any key that smells like a credential replaced;
 *  - frames the parser refused get the same treatment (`scrubDroppedFrame`), never the raw text.
 */

import type { LcuEvent } from './socket.js';

/** URI prefixes whose payloads are never written. */
export const SENSITIVE_URI_PREFIXES: readonly string[] = [
  '/lol-rso-auth',
  '/lol-login',
  '/riotclient/auth',
  '/riot-client-auth',
  '/rso-auth',
  '/lol-chat',
  '/lol-game-client-chat',
  '/lol-hovercard',
  // Server-push messages; the gsm game-update ones carry the player's game credentials inside a JSON string.
  // The companion never reads this prefix.
  '/riot-messaging-service',
  '/lol-cookie-jar',
  '/lol-license-agreement',
  '/lol-email-verification',
  '/lol-account-verification',
  '/lol-purchase-widget',
  '/lol-store',
  '/lol-riot-client-auth',
];

/** Any URI containing one of these words is treated as sensitive too. (`session` is deliberately absent: `/lol-gameflow/v1/session` is needed.) */
const SENSITIVE_URI_WORDS = /token|auth|credential|password|secret/i;

export function isSensitiveUri(uri: string): boolean {
  const lower = uri.toLowerCase();
  if (SENSITIVE_URI_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
    return true;
  }
  return SENSITIVE_URI_WORDS.test(uri);
}

/** Keys whose values are replaced inside otherwise-kept payloads. */
const SENSITIVE_KEY =
  /token|password|secret|cookie|authorization|credential|jwt|bearer|encryptionkey|spectatorkey|observerencryptionkey|packetcop/i;

export const REDACTED = '[redacted]';

/**
 * A string value that looks like JSON is scrubbed as JSON and re-serialised: the client nests whole payloads
 * as strings (`/riot-messaging-service` `payload`, for one), and a key-based scrub that stopped at the string
 * boundary let `playerCredentials.encryptionKey` through. Anything that starts like JSON but does not parse
 * gets the free-text scrub over its whole length.
 */
function scrubString(text: string): string {
  const head = text.trimStart();
  if (!(head.startsWith('{') || head.startsWith('['))) {
    return text;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return scrubText(text, text.length);
  }
  return JSON.stringify(scrubValue(parsed));
}

/** Returns a deep copy of `value` with every sensitive key's value replaced, looking inside JSON strings too. */
export function scrubValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return scrubString(value);
  }
  if (Array.isArray(value)) {
    return value.map(scrubValue);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : scrubValue(inner);
    }
    return out;
  }
  return value;
}

export type ScrubbedEvent =
  | { readonly kind: 'kept'; readonly event: LcuEvent }
  | { readonly kind: 'redacted'; readonly event: Omit<LcuEvent, 'data'> };

/** What may be written to disk for an event. */
export function scrubEvent(event: LcuEvent): ScrubbedEvent {
  if (isSensitiveUri(event.uri)) {
    return { kind: 'redacted', event: { topic: event.topic, uri: event.uri, eventType: event.eventType } };
  }
  return { kind: 'kept', event: { ...event, data: scrubValue(event.data) } };
}

/** Redacts `key: value` / `"key": "value"` pairs for credential-looking keys inside free text. */
const SENSITIVE_TEXT_PAIR =
  /("?[\w-]*(?:token|password|secret|cookie|authorization|credential|jwt|bearer|encryptionkey|spectatorkey|packetcop)[\w-]*"?\s*[:=]\s*)("(?:[^"\\]|\\.)*"?|[^,;\s}\]]+)/gi;

export const DROPPED_PREVIEW_CHARS = 200;

/** A bounded prefix of `text` with credential-looking pairs replaced. */
export function scrubText(text: string, maxChars: number = DROPPED_PREVIEW_CHARS): string {
  return text
    .slice(0, maxChars)
    .replace(SENSITIVE_TEXT_PAIR, (_match, prefix: string) => `${prefix}"${REDACTED}"`);
}

function findUri(value: unknown, depth = 0): string | undefined {
  if (depth > 4 || !value || typeof value !== 'object') {
    return undefined;
  }
  if (!Array.isArray(value)) {
    const uri = (value as Record<string, unknown>).uri;
    if (typeof uri === 'string') {
      return uri;
    }
  }
  for (const inner of Object.values(value as Record<string, unknown>)) {
    const found = findUri(inner, depth + 1);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

export type ScrubbedDroppedFrame =
  /** Parsed, and its URI is on the deny-list: nothing but the URI survives. */
  | { readonly dropped: true; readonly redacted: true; readonly uri: string }
  /** Parsed, not sensitive by URI: the frame with credential-looking keys replaced. */
  | { readonly dropped: true; readonly frame: unknown }
  /** Not JSON: a bounded, text-scrubbed preview. Never the full text. */
  | { readonly dropped: true; readonly preview: string };

/**
 * What may be written for a frame the parser refused. A frame can fail `LcuEventFrameSchema` (unknown
 * `eventType`, extra field) and still be a login or RSO payload, so it gets the same treatment as a good
 * event, with a text fallback when it is not JSON at all.
 */
export function scrubDroppedFrame(raw: string): ScrubbedDroppedFrame {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { dropped: true, preview: scrubText(raw) };
  }
  const uri = findUri(parsed);
  if (uri !== undefined && isSensitiveUri(uri)) {
    return { dropped: true, redacted: true, uri };
  }
  return { dropped: true, frame: scrubValue(parsed) };
}
