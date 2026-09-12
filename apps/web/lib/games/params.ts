import { puuidSchema } from '@customs/db';

/**
 * `?p=` on `/games`: the puuid of the person whose customs the list is filtered to.
 *
 * Absent is the group list. A repeated parameter or a placeholder puuid is not a person,
 * so the page 404s rather than silently showing everyone.
 */

export function parseFocusPuuid(value: string | string[] | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return null;
  const parsed = puuidSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
