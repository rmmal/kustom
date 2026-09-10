import type { Embed, EmbedField } from './embeds';

/**
 * Discord's length limits, in one place, applied where the embeds are built (M4.12).
 *
 * Discord does not truncate. A field value of 1025 characters is a 400 on the **whole** webhook,
 * so one long line loses the post — the teams, the result, the board — not just itself. Every
 * value in `embeds.ts` is a join of lines that each carry a name we do not control, and
 * `renderName` escaping markdown can double a 32-character name to 64: ten `Swap:` lines of
 * escapable names is a `Seats` value of ~1500 characters (reviewer, 2026-09-11). So the guard
 * lives here and every builder emits through it.
 *
 * Three rules, and they are the whole file:
 *
 * 1. **Below the limit it is the identity.** `fieldValue` joins and returns; it does not
 *    normalise, re-escape or re-order. Every existing snapshot is byte-identical, which is how
 *    you can tell the guard is off the normal path.
 * 2. **Cuts land on line boundaries.** A field is a list of lines and a cut drops whole lines,
 *    so a name is never sliced in half and a backslash is never separated from the character it
 *    escapes. One `…` line marks where lines went, at the first gap.
 * 3. **The line that matters survives.** Each line carries a `keep` rank and the lowest rank
 *    goes first, the lowest line of a rank before the ones above it. The side line of `Seats`
 *    outranks the move lines, an award's first line outranks the tie's extra names, and a board
 *    is all one rank so it loses its bottom rows.
 *
 * Only when a single line is itself over the limit does {@link cutText} cut inside it — and even
 * then it refuses to end on a half-written escape or half a surrogate pair.
 */

/** The one this task is about: an embed field's `value`. */
export const FIELD_VALUE_LIMIT = 1024;
/** An embed field's `name`. */
export const FIELD_NAME_LIMIT = 256;
/** The embed's `title`. */
export const TITLE_LIMIT = 256;
/** The embed's `description` — the explanation, verbatim, and the window's date range. */
export const DESCRIPTION_LIMIT = 4096;
/** `footer.text`. */
export const FOOTER_LIMIT = 2048;
/** Title + description + every field name and value + the footer, summed. */
export const TOTAL_LIMIT = 6000;

/** The mark a cut leaves: its own line between lines, and the last character inside one. */
export const ELLIPSIS = '…';

/**
 * A line of a field value, with how hard it fights to stay.
 *
 * `keep` defaults to 0, which is what a plain string means, so a field whose lines are all
 * equal is written as an array of strings and loses its last lines first.
 */
export interface KeptLine {
  text: string;
  /** Higher survives longer. {@link KEEP_LAST_STANDING} is the highest rank in use. */
  keep?: number;
}

export type FieldLine = string | KeptLine;

/**
 * The rank of a line that has to be in the post for the post to do its job: the side line of
 * `Seats`, the winner's first line of an award. Nothing outranks it, so it is the survivor.
 */
export const KEEP_LAST_STANDING = 1;

interface RankedLine {
  text: string;
  keep: number;
}

/**
 * The field value: the lines joined, cut to `limit` on line boundaries if they do not fit.
 *
 * Identity below the limit. Above it, lines are dropped one at a time — lowest `keep` first,
 * and within a rank the **lowest line** first, so a field keeps its top and its keepers — until
 * the rendered value fits. One `…` line stands where the first dropped line was; further gaps
 * are not marked twice, because a value full of ellipses says less than the lines it replaced.
 */
export function fieldValue(lines: readonly FieldLine[], limit: number = FIELD_VALUE_LIMIT): string {
  const ranked: RankedLine[] = lines.map((line) =>
    typeof line === 'string' ? { text: line, keep: 0 } : { text: line.text, keep: line.keep ?? 0 },
  );

  const whole = ranked.map((line) => line.text).join('\n');
  if (whole.length <= limit) return whole;

  const order = ranked
    .map((line, index) => ({ keep: line.keep, index }))
    .sort((a, b) => a.keep - b.keep || b.index - a.index)
    .map((entry) => entry.index);

  const dropped = new Set<number>();
  for (const index of order) {
    // Never drop the last line standing: a field with an empty value is as rejected as a field
    // with an over-long one. The survivor is the highest-ranked, lowest-indexed line.
    if (dropped.size >= ranked.length - 1) break;
    dropped.add(index);
    const rendered = render(ranked, dropped);
    if (rendered.length <= limit) return rendered;
  }

  return cutText(render(ranked, dropped), limit);
}

/** The surviving lines in their original order, with one `…` where the first gap is. */
function render(lines: readonly RankedLine[], dropped: ReadonlySet<number>): string {
  const out: string[] = [];
  let marked = false;
  for (const [index, line] of lines.entries()) {
    if (dropped.has(index)) {
      if (!marked) {
        out.push(ELLIPSIS);
        marked = true;
      }
      continue;
    }
    out.push(line.text);
  }
  return out.join('\n');
}

/**
 * A hard character cut, for the things that are one string and not a list of lines: the title,
 * the description, the footer — and the single line that is over the limit all by itself.
 *
 * The last character is `…` and the cut never lands **inside a markdown escape**: a run of
 * backslashes before the cut has to be even, or the backslash that is left behind escapes the
 * `…` and eats it. Nor inside a surrogate pair, which would leave a lone half-character that
 * renders as a replacement box.
 */
export function cutText(value: string, limit: number): string {
  if (value.length <= limit) return value;
  if (limit <= 0) return '';

  let end = limit - 1;
  while (
    end > 0 &&
    (isHighSurrogate(value.charCodeAt(end - 1)) || trailingBackslashes(value, end) % 2 === 1)
  ) {
    end -= 1;
  }
  return end <= 0 ? ELLIPSIS : `${value.slice(0, end)}${ELLIPSIS}`;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/** How many backslashes run backwards from `end`. An odd count means the last one escapes. */
function trailingBackslashes(value: string, end: number): number {
  let count = 0;
  while (end - count > 0 && value.charAt(end - count - 1) === '\\') count += 1;
  return count;
}

/**
 * The last thing every builder does. It applies the limits the builders cannot see from where
 * they stand: the title, the description, the footer, the field names — and the 6000-character
 * total, which is a property of the assembled embed and of nothing inside it.
 *
 * **The description is cut first** when the total is over. It is the longest single string on a
 * teams post (`splits.explanation`, verbatim) and the only one that is prose rather than a list
 * somebody has to read line by line; the fields are the message. Only if losing the description
 * outright is still not enough do field values give ground, from the last field backwards —
 * `Lobby`, then `Red`, then `Blue` — and even there the cut keeps each value's first and last
 * line, which is where every keeper of every field we build already is.
 *
 * Field values pass through {@link fieldValue} again here. That is a no-op on a value the
 * builder already fitted, and it is the net under a value that reached the embed some other way.
 */
export function guardEmbed(embed: Embed): Embed {
  const title = cutText(embed.title, TITLE_LIMIT);
  const footerText = cutText(embed.footer.text, FOOTER_LIMIT);
  const fields: EmbedField[] = embed.fields.map((field) => ({
    ...field,
    name: cutText(field.name, FIELD_NAME_LIMIT),
    value: fieldValue(endsKept(field.value)),
  }));

  // A field the builder did not set stays unset; one it set to an empty string stays that, so
  // this pass cannot add or remove a key. Only its length is this function's business.
  let description =
    embed.description === undefined ? undefined : cutText(embed.description, DESCRIPTION_LIMIT);

  let over = total(title, description, fields, footerText) - TOTAL_LIMIT;

  if (over > 0 && description !== undefined) {
    const cut = cutText(description, Math.max(0, description.length - over));
    over -= description.length - cut.length;
    description = cut;
  }

  for (let index = fields.length - 1; index >= 0 && over > 0; index -= 1) {
    const field = fields[index];
    if (field === undefined) continue;
    // At most down to a bare `…`: a field Discord will accept, saying that something was here.
    const cut = fieldValue(endsKept(field.value), Math.max(1, field.value.length - over));
    over -= field.value.length - cut.length;
    fields[index] = { ...field, value: cut };
  }

  return {
    ...embed,
    title,
    ...(description === undefined ? {} : { description }),
    fields,
    footer: { ...embed.footer, text: footerText },
  };
}

/**
 * A value we did not build line by line, ranked: the first line and the last line are keepers.
 *
 * A superset of every builder's own ranking, and cheap insurance — whichever end a field puts
 * its keeper at, this pass keeps both and takes from the middle.
 */
function endsKept(value: string): FieldLine[] {
  const lines = value.split('\n');
  return lines.map((text, index) => ({
    text,
    keep: index === 0 || index === lines.length - 1 ? KEEP_LAST_STANDING : 0,
  }));
}

/** Discord counts the title, the description, every field name and value, and the footer. */
function total(
  title: string,
  description: string | undefined,
  fields: readonly EmbedField[],
  footerText: string,
): number {
  const inFields = fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0);
  return title.length + (description?.length ?? 0) + inFields + footerText.length;
}
