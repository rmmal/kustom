import { NAMELESS_PLAYER, type PlayerName } from '../discord/embeds';

/**
 * Every sentence the tonight page says, in one file, spelled the way product and
 * `docs/05-design.md` spell them. Nothing here is composed from a template an engineer
 * invented, and nothing here is edited without product.
 *
 * The two surfaces that quote a **stored** string — the explanation line and, through it, the
 * off-role clause (M3.7) — are not in this file at all: they are rendered verbatim from
 * `splits.explanation` and may never be recomposed.
 */

/** M1.10's sentence, unchanged word for word, so the wording does not move under people. */
export const IDLE_SENTENCE =
  'When ten of you are in a custom lobby with the companion running, the teams show up here.';

/** The link under it. `/leaderboard` is M3.5; the copy is fixed now so the page is complete. */
export const IDLE_LINK_LABEL = 'Last night and the board';

/** The header strip when there is no lobby tonight. A label, not a sentence: no "yet". */
export const IDLE_HEADER = 'Nothing tonight';

/** The member list with nobody in it. Not an illustration, not a spinner. */
export const EMPTY_LOBBY = 'Nobody in the lobby yet.';

/** Beyond the ten a custom lobby can seat. */
export const AROUND_LABEL = 'Around';

/**
 * M3.10's one quiet line, under the block and never per row. It appears while any row on
 * screen reads `Someone` and disappears with the last of them.
 */
export const NAMELESS_HINT = "Names fill in after someone's first game.";

/** `05-design.md`, "Explanation line": the ghost button on the strip. */
export const REROLL_LABEL = 'Reroll';

/**
 * The sit-out strip (05-design.md, "Sit-out notice"; product, 2026-09-08 — final).
 *
 * Two versions and no third: the general one, and the second-person one for a viewer who is
 * signed in, linked, and one of the people sitting. Nobody else's strip changes.
 */
export function sitOutGeneral(names: string): string {
  return `Sitting out this game: ${names}. Each game goes to whoever has played least tonight, so they are first in line for the next one.`;
}

export const SIT_OUT_VIEWER =
  'You are sitting this one out. Each game goes to whoever has played least tonight, so you are first in line for the next one.';

/** `05-design.md`: truncate a display name at 32 characters with an ellipsis. */
const MAX_NAME_LENGTH = 32;

/**
 * The name as the **web** prints it: the newest display name we have, trimmed, cut at 32
 * characters, and `Someone` when we have none (M3.10).
 *
 * Deliberately not `renderName` from `lib/discord/embeds.ts`, which escapes Discord markdown:
 * a backslash before an underscore is right in a channel and wrong on a page, where a name is
 * text in a `<span>` and React escapes what needs escaping. The fallback word is imported
 * rather than retyped — one word, spelled in one place, on every surface.
 */
export function renderWebName(name: PlayerName): string {
  const trimmed = (name ?? '').trim();
  if (trimmed.length === 0) return NAMELESS_PLAYER;
  return trimmed.length > MAX_NAME_LENGTH ? `${trimmed.slice(0, MAX_NAME_LENGTH - 1)}…` : trimmed;
}

/** True when this row will print the fallback, which is what turns the hint line on. */
export function isNameless(name: PlayerName): boolean {
  return (name ?? '').trim().length === 0;
}

/** `Sara and Deniz`, `Sara, Deniz and Ali` (05-design.md, "Sit-out notice"). */
export function joinWebNames(names: readonly PlayerName[]): string {
  const rendered = names.map(renderWebName);
  if (rendered.length <= 1) return rendered[0] ?? '';
  return `${rendered.slice(0, -1).join(', ')} and ${rendered[rendered.length - 1]}`;
}
