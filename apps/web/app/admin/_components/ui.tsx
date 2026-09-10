import type { ReactNode } from 'react';

/**
 * The handful of pieces every admin page repeats. Plain server components: the admin area has
 * no client JavaScript at all, so every interaction is a form post to `/api/admin/*`.
 */

export type SearchParams = Record<string, string | string[] | undefined>;

/** First value of a query parameter, or null. */
export function readParam(params: SearchParams, key: string): string | null {
  const value = params[key];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * The `?notice=` / `?error=` line a form post redirects back with. Both are sentences this app
 * wrote; React escapes them on the way out regardless.
 */
export function Notices({ params }: { params: SearchParams }): ReactNode {
  const notice = readParam(params, 'notice');
  const error = readParam(params, 'error');

  return (
    <>
      {error === null ? null : (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}
      {notice === null ? null : <p className="admin-notice">{notice}</p>}
    </>
  );
}

/**
 * A player's inferred roles, read-only (M5.17).
 *
 * This cell used to be two role pickers and a Save button. Roles are now read off the games
 * people play — recomputed after every rated game and after every rebuild — so the cell states
 * the answer and the number of games behind it, and there is nothing to press. The sentence
 * itself is `formatInferredRoles` in `lib/admin/players.ts`, which the page and this component
 * share so the markup can never disagree with the string.
 */
export function InferredRoles({ pair, inferredAt }: { pair: string; inferredAt: string | null }): ReactNode {
  return (
    <span
      className="admin-muted"
      title={inferredAt === null ? undefined : `inferred ${formatDay(inferredAt)}`}
    >
      {pair}
    </span>
  );
}

/** A deliberately boring empty state. Every list page has one. */
export function Empty({ children }: { children: ReactNode }): ReactNode {
  return <p className="admin-empty">{children}</p>;
}

/**
 * `2026-09-08`, the day only. For a column where the minute is noise: when backfill was asked
 * for or allowed (M5.1) is a fact about a day, and the row is narrow enough already.
 */
export function formatDay(value: string | null): string {
  if (value === null) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().slice(0, 10);
}

/** `2026-09-08 19:04 UTC`. Fixed format, so server and client agree and sorting reads right. */
export function formatTimestamp(value: string | null): string {
  if (value === null) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${parsed.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}
