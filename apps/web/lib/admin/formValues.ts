import { roleSchema } from '@customs/db/schemas';
import { z } from 'zod';

/**
 * The vocabulary the admin forms and the admin JSON API share.
 *
 * An HTML form can only send strings, and "clear this field" has to be expressible: M1.6 exists
 * partly because a null `main_role` means flexible (M1.4) and there was no way back to it. So
 * every nullable field accepts `""` and `"none"` as well as `null`, and both mean null. A JSON
 * caller can send a real `null`; a browser sends the empty option; the route sees the same
 * value.
 */

/** `''` and `'none'` are the form's way of saying null. */
export const nullableRoleSchema = z
  .union([roleSchema, z.null(), z.literal(''), z.literal('none')])
  .transform((value) => (value === '' || value === 'none' || value === null ? null : value));

/** Trimmed text where empty means null: a cleared Discord id or channel id. */
export const nullableTextSchema = z.union([z.string(), z.null()]).transform((value) => {
  const trimmed = (value ?? '').trim();
  return trimmed.length === 0 ? null : trimmed;
});

/** Trimmed text that must not be empty. */
export const requiredTextSchema = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value.length > 0, 'must not be empty');

/** A checkbox or a hidden field: `true`/`false` as a string, or a real boolean from JSON. */
export const booleanFieldSchema = z
  .union([z.boolean(), z.literal('true'), z.literal('false'), z.literal('on'), z.literal('')])
  .transform((value) => value === true || value === 'true' || value === 'on');

/** A `players.id` or `companion_tokens.id`. Never used to decide who the caller is. */
export const idSchema = z.uuid();

/**
 * A path on this site, for redirects. Anything that is not a single-slash-rooted path is
 * rejected, which is what stops `?next=https://evil.example` from turning the OAuth callback
 * into an open redirect.
 */
export const internalPathSchema = z
  .string()
  .refine(
    (value) => value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\'),
    'must be a path on this site',
  );
