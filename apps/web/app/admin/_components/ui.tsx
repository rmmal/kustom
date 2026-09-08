import { ROLES } from '@customs/core';
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
 * A role picker whose first option is "none", which posts `""` and is stored as null.
 *
 * A null main role means flexible (M1.4). Being able to get back to it is the reason M1.6
 * lists a role editor at all, so the empty option is not decoration.
 */
export function RoleSelect({
  name,
  value,
  label,
}: {
  name: string;
  value: string | null;
  label: string;
}): ReactNode {
  return (
    <label>
      <span className="admin-muted">{label} </span>
      <select name={name} defaultValue={value ?? ''} aria-label={label}>
        <option value="">none</option>
        {ROLES.map((role) => (
          <option key={role} value={role}>
            {role}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A deliberately boring empty state. Every list page has one. */
export function Empty({ children }: { children: ReactNode }): ReactNode {
  return <p className="admin-empty">{children}</p>;
}

/** `2026-09-08 19:04 UTC`. Fixed format, so server and client agree and sorting reads right. */
export function formatTimestamp(value: string | null): string {
  if (value === null) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${parsed.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}
