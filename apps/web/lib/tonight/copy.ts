import { NAMELESS_PLAYER, type PlayerName } from '../discord/embeds';
import { PLAYERS_PER_GAME } from '../lobbyState';

/**
 * Every sentence the tonight page says, in one file, spelled the way product and
 * `docs/05-design.md` spell them ("Copy — final (product 2026-09-09)"). Nothing here is
 * composed from a template an engineer invented, and nothing here is edited without product.
 *
 * The two surfaces that quote a **stored** string — the explanation line and, through it, the
 * off-role clause (M3.7) — are not in this file at all: they are rendered verbatim from
 * `splits.explanation` and may never be recomposed.
 */

/* ---------------------------------------------------------------------------
 * The status strip's headline. One word or phrase per state, upper case, in the display cut:
 * it is read at arm's length, and the sentence under it never repeats it.
 * ------------------------------------------------------------------------- */

/**
 * No lobby tonight. Not `NOTHING TONIGHT`: this is the screen a friend hits at 19:00 from a
 * WhatsApp link, and "nothing tonight" reads as *the night is off* to a group that plays every
 * night — and it is false in the other idle case, an abandoned lobby.
 */
export const HEADLINE_IDLE = 'NOBODY IN YET';

/** The count is the other half: `9 IN THE LOBBY`. */
export const HEADLINE_FILLING = 'IN THE LOBBY';

export const HEADLINE_BALANCED = 'TEAMS ARE SET';

export const HEADLINE_IN_GAME = 'IN GAME';

/** Not `FINAL`: that is the broadcast lower-third word this design has no room for. */
export const HEADLINE_FINISHED = 'GAME OVER';

/* ---------------------------------------------------------------------------
 * The strip's sentence: the page's one polite live region, two lines reserved so that a
 * change of count moves nothing under a thumb.
 * ------------------------------------------------------------------------- */

/** M1.10's sentence, unchanged word for word, so the wording does not move under people. */
export const IDLE_SENTENCE =
  'When ten of you are in a custom lobby with the companion running, the teams show up here.';

/**
 * Nobody has joined yet — said **once**, in the strip, and never again under the rack. A rack
 * of ten `open` seats is the picture; this is the fact.
 */
export const EMPTY_LOBBY = 'Nobody in the lobby yet.';

export const BALANCED_SENTENCE = 'Split by rating and role. Nobody picked the teams.';

export const IN_GAME_SENTENCE = 'Ratings move when it ends.';

export const FINISHED_SENTENCE = 'Ratings are updated. The leaderboard has the rest.';

/** Eleven or more around: the ten play and the sit-out strip explains who is not in them. */
export const OVERFULL_SENTENCE = 'Ten play, the rest sit out this game.';

/** Ten in, nothing to do: the balancer runs on the companion's next post. */
export const TEN_IN_SENTENCE = 'Teams in a moment.';

/**
 * How many are still missing, as a **word** — the digit is already 44px above it in the
 * headline. Index 1 is one seat left to fill, which is the line under `9 IN THE LOBBY`.
 *
 * A full and an empty lobby are not in here: they have sentences of their own
 * ({@link EMPTY_LOBBY}, {@link TEN_IN_SENTENCE}, {@link OVERFULL_SENTENCE}).
 */
const COUNTDOWN_WORDS = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'] as const;

/** The strip's sentence while the lobby fills. The one text that changes without a state change. */
export function fillingSentence(around: number): string {
  if (around <= 0) return EMPTY_LOBBY;
  if (around > PLAYERS_PER_GAME) return OVERFULL_SENTENCE;
  if (around === PLAYERS_PER_GAME) return TEN_IN_SENTENCE;
  return `${COUNTDOWN_WORDS[PLAYERS_PER_GAME - around]} more to go.`;
}

/* ---------------------------------------------------------------------------
 * The seat rack.
 * ------------------------------------------------------------------------- */

/** The rack's header: `SEATS · 9 of 10`, and the `rating` legend right-aligned over the column. */
export const RACK_LABEL = 'SEATS';

export const RACK_LEGEND = 'rating';

export function rackCount(around: number): string {
  return `${Math.min(around, PLAYERS_PER_GAME)} of ${PLAYERS_PER_GAME}`;
}

/** A seat nobody is in. Lower case, mono, on `bg`: recessed below the card. */
export const OPEN_SEAT = 'open';

/**
 * One line under the rack, and only while **no** member on screen has a role — where the word
 * `flexible` on nine rows would be a column of identical grey words rather than information.
 * `the bot`, because that is what product calls it on every other surface.
 */
export const ALL_FLEXIBLE_HINT = 'Nobody has set a role tonight, so the bot can put anyone anywhere.';

/** A row for somebody who has declared nothing, on a screen where somebody else has. */
export const FLEXIBLE_ROLE = 'flexible';

/** Beyond the ten a custom lobby can seat. */
export const AROUND_LABEL = 'Around';

/* ---------------------------------------------------------------------------
 * Team cards.
 * ------------------------------------------------------------------------- */

/**
 * The legend in a team card's header, when that card has a seat off its role (the designer,
 * 2026-09-10, `05-design.md` "The `· off-role` legend in a team card header").
 *
 * It is the key to the amber dot on the rows below it, dressed like every other mono
 * micro-label on the page — `rating`, `SEATS`, `live`, `open` — and never `brand` itself: the
 * one amber in a header bar is the dot.
 *
 * The suffix is visually hidden. The bare word straight after `RED` reads as a property of the
 * side; `off-role seats in this card` is what a listener moving header to header needs, and the
 * plural is a category, like `rating` over a column of many, so nothing pluralises at render.
 */
export const OFF_ROLE_LEGEND = 'off-role';

export const OFF_ROLE_LEGEND_SUFFIX = ' seats in this card';

/**
 * The one punctuation mark between a heading and its legend, the same one the rack header's
 * `SEATS · 9 of 10` uses. In its own `aria-hidden` span and **not** a CSS `::before`:
 * generated content is announced by VoiceOver, and this is punctuation.
 */
export const HEAD_SEPARATOR = '·';

/**
 * M3.10's one quiet line, under the block and never per row. It appears while any row on
 * screen reads `Someone` and disappears with the last of them.
 */
export const NAMELESS_HINT = "Names fill in after someone's first game.";

/* ---------------------------------------------------------------------------
 * Teams, the sit-out strip and the result.
 * ------------------------------------------------------------------------- */

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
