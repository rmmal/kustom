/**
 * The anonymous browser id Daily Mystery stores locally. Not a player. Not a login.
 * The cookie is the server's copy of the same string so a return visit can reopen
 * today's closed case without asking the visitor to type anything.
 */

export const MYSTERY_VISITOR_COOKIE = 'cn_mystery_vid';
export const MYSTERY_VISITOR_STORAGE = 'anonymous_visitor_id';
export const MYSTERY_VISITOR_MAX_AGE_S = 60 * 60 * 24 * 400;

const VISITOR_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function isVisitorId(value: string | undefined | null): value is string {
  return typeof value === 'string' && VISITOR_RE.test(value);
}

export function newVisitorId(): string {
  return crypto.randomUUID();
}

export function readStoredVisitorId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(MYSTERY_VISITOR_STORAGE);
    return isVisitorId(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function writeStoredVisitorId(id: string): void {
  if (typeof window === 'undefined' || !isVisitorId(id)) return;
  try {
    window.localStorage.setItem(MYSTERY_VISITOR_STORAGE, id);
  } catch {
    // Private mode can refuse localStorage. The cookie still identifies the visit.
  }
}

export function ensureStoredVisitorId(): string {
  const existing = readStoredVisitorId();
  if (existing !== null) return existing;
  const created = newVisitorId();
  writeStoredVisitorId(created);
  return created;
}
