import type { Role, Side } from '@customs/core';

/**
 * The Discord embeds, as pure functions (M3.1 teams, M3.3 result).
 *
 * Nothing in this file reads the database, the clock or the environment: it takes plain data
 * — names, roles, display ratings, an explanation string, a timestamp — and returns the JSON
 * body of a webhook POST. `webhook.ts` is the only I/O, `assemble.ts` is the only place that
 * turns rows into these inputs, and both of those are testable because this one is not.
 *
 * The layout, the field names, the colours and every string are `docs/05-design.md`
 * ("Discord embeds") and the sit-out copy is M2.15's, verbatim. Neither is a suggestion: an
 * engineer who wants different wording asks product for it.
 */

/** Bar colours, as the integers the API passes (`05-design.md`, dark palette). */
export const ACCENT_COLOR = 14_721_854;
export const BLUE_COLOR = 7_054_839;
export const RED_COLOR = 15_363_945;

/** Lane order. Every list of five is printed in it, on both embeds, so the two line up. */
const LANE_ORDER: readonly Role[] = ['top', 'jungle', 'mid', 'adc', 'support'];

/**
 * A display name we have, or `null` for a player the database has never been told about.
 * `null` renders as `Someone` (M3.10) — at render time, here, and never stored anywhere.
 */
export type PlayerName = string | null;

/**
 * M3.10's fallback. One word, at the display boundary, on every surface.
 *
 * `lib/ingest/balance.ts` borrows the same constant for the name it hands core, because core
 * writes that name into `splits.explanation` and three surfaces quote that sentence verbatim
 * (M3.15). One word, spelled in one place, whether it is rendered or stored.
 */
export const NAMELESS_PLAYER = 'Someone';

/** `05-design.md`: truncate a display name at 32 characters with an ellipsis. */
const MAX_NAME_LENGTH = 32;

export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface Embed {
  color: number;
  title: string;
  url?: string;
  description?: string;
  fields: EmbedField[];
  footer: { text: string };
  timestamp: string;
}

/** The body of a webhook POST. One embed; we never post content or mentions. */
export interface WebhookPayload {
  embeds: Embed[];
}

export interface TeamsPlayer {
  puuid: string;
  name: PlayerName;
  role: Role;
  /** `displayRating(mu)`, already rounded by core. */
  rating: number;
  /** Not on a main role in this split (core's `isOffRole`). */
  offRole: boolean;
}

/**
 * Why the sitters are sitting. M2.15's two clauses, plus M3.12's third one for the first
 * balance of a night.
 *
 * `first-sit-out` is the case where everyone around is tied on games tonight *and* nobody
 * around has a sit-out on record: the comparator has fallen through to PUUID order, so
 * `longest-since` would be stating a fact about a history that does not exist and sending the
 * reader looking for a night they sat out that never happened (product, 2026-09-09).
 */
export type SitOutReason = 'most-games' | 'longest-since' | 'first-sit-out';

export type SeatLine =
  /** Somebody leaves the ten and somebody takes their slot. */
  | { kind: 'swap'; sitter: PlayerName; mover: PlayerName }
  /** A mover with nobody to swap with: ten around, one of them watching, nobody sitting. */
  | { kind: 'open-slot'; mover: PlayerName };

export interface TeamsEmbedInput {
  /** Five, lane order enforced here anyway. */
  blue: readonly TeamsPlayer[];
  red: readonly TeamsPlayer[];
  /** `splits.explanation`, verbatim. Never recomposed, never shortened. */
  explanation: string;
  /** Only when somebody sits. */
  sitOut: { names: readonly PlayerName[]; reason: SitOutReason } | null;
  /** Only when somebody has to move, which is not the same question. */
  seats: readonly SeatLine[];
  lobby: { name: string | null; password: string | null };
  /**
   * Which of the lobby's stored splits this post is, and how many the lobby has (M3.2).
   *
   * Absent for a fresh balance, which is always rank 1 and keeps the plain title. A reroll
   * passes the promoted split's rank so the title says how far down the list the group has
   * gone; nothing else about the embed changes.
   */
  promoted?: PromotedSplit | undefined;
  /** The tonight page, or `undefined` when there is no honest URL to post. */
  url?: string | undefined;
  /** ISO 8601. Injected, so this function has no clock. */
  timestamp: string;
}

/** `splits.rank` of the split being posted, and how many splits the lobby stored. */
export interface PromotedSplit {
  rank: number;
  splitCount: number;
}

export interface ResultPlayer {
  puuid: string;
  name: PlayerName;
  /** `null` when neither the scoreboard nor the split says where they played. */
  role: Role | null;
  /** `displayRating(muAfter)`. */
  rating: number;
  /** `displayRating(muAfter) - displayRating(muBefore)`, from `displayDelta`. */
  delta: number;
}

export interface ResultEmbedInput {
  winningSide: Side;
  durationS: number;
  blue: readonly ResultPlayer[];
  red: readonly ResultPlayer[];
  /** The chosen split's `blue_win_prob`, or `null` when this game had no stored split. */
  blueWinProb: number | null;
  /** The single highest `damage_to_champs`, or `null` when the block carried none. */
  topDamage: { name: PlayerName; damage: number } | null;
  seasonName: string;
  /** Which game of the season this is, or `null` when it could not be counted. */
  gameNumber: number | null;
  url?: string | undefined;
  timestamp: string;
}

/**
 * The teams embed: two columns with role and display rating, the explanation verbatim, the
 * sit-out copy when somebody sits, and the lobby name and password so a straggler can get in.
 */
export function teamsEmbed(input: TeamsEmbedInput): WebhookPayload {
  const blue = inLaneOrder(input.blue);
  const red = inLaneOrder(input.red);

  // The rotation goes first (`05-design.md`, revised 2026-09-09): "Swap: Omar out, Nadia in."
  // is the one line in the message that has to happen before anybody can play, and behind ten
  // rating lines plus a wrapped explanation it was landing below the fold on a phone. Discord
  // groups only *consecutive* inline fields, so a block field in front of Blue and Red does not
  // break their pairing, and on a ten-person night neither field exists and the embed is
  // byte-identical to what shipped.
  const fields: EmbedField[] = [];

  if (input.sitOut !== null && input.sitOut.names.length > 0) {
    fields.push({ name: 'Sitting out', value: sitOutLine(input.sitOut.names, input.sitOut.reason) });
  }
  if (input.seats.length > 0) {
    fields.push({ name: 'Seats', value: input.seats.map(seatLine).join('\n') });
  }

  fields.push(
    { name: `Blue · ${sumRatings(blue)}`, value: blue.map(teamsLine).join('\n'), inline: true },
    { name: `Red · ${sumRatings(red)}`, value: red.map(teamsLine).join('\n'), inline: true },
  );

  const lobby = lobbyFieldValue(input.lobby);
  if (lobby !== null) fields.push({ name: 'Lobby', value: lobby });

  return {
    embeds: [
      {
        color: ACCENT_COLOR,
        title: teamsTitle(input.promoted),
        ...(input.url === undefined ? {} : { url: input.url }),
        description: input.explanation,
        fields,
        // With no url the title is not a link, so the footer must not promise one
        // (`05-design.md`): telling a friend to tap something that is not there is worse than
        // saying nothing.
        footer: { text: teamsFooter(input.url) },
        timestamp: input.timestamp,
      },
    ],
  };
}

/**
 * The result embed: who won, how long it took, the top damage, and what it did to each
 * player's rating.
 *
 * The two columns keep their side's position — blue first, always — so "my column" is in the
 * same place it was in the teams embed. There is no team total of deltas and there never will
 * be one: the two sides do not sum to zero, and printing that invites an argument about a
 * thing that is working correctly (`00-product.md`, "The numbers on the screen").
 */
export function resultEmbed(input: ResultEmbedInput): WebhookPayload {
  const winner = input.winningSide === 100 ? 'Blue' : 'Red';
  const description = [favoredClause(input.blueWinProb), topDamageClause(input.topDamage)]
    .filter((clause) => clause !== null)
    .join(' ');

  return {
    embeds: [
      {
        color: input.winningSide === 100 ? BLUE_COLOR : RED_COLOR,
        title: `${winner} wins · ${formatDuration(input.durationS)}`,
        ...(input.url === undefined ? {} : { url: input.url }),
        ...(description.length > 0 ? { description } : {}),
        fields: [
          { name: 'Blue', value: inLaneOrder(input.blue).map(resultLine).join('\n'), inline: true },
          { name: 'Red', value: inLaneOrder(input.red).map(resultLine).join('\n'), inline: true },
        ],
        footer: {
          text:
            input.gameNumber === null ? input.seasonName : `${input.seasonName} · game ${input.gameNumber}`,
        },
        timestamp: input.timestamp,
      },
    ],
  };
}

/**
 * `Teams are set`, and `Teams are set · reroll 1 of 2` when an admin has promoted split 2
 * (M3.2, `05-design.md` "The title on a reroll").
 *
 * Split 1 keeps the plain title, including when an admin promotes it back: it is the teams
 * the balancer chose, whatever route it took to be on the board again. The count comes from
 * how many splits the lobby actually stored — core returns three, so it reads `of 2` — rather
 * than from a literal, because a lobby that stored fewer must not promise a reroll it has not
 * got.
 */
export function teamsTitle(promoted: PromotedSplit | undefined): string {
  if (promoted === undefined || promoted.rank <= 1) return 'Teams are set';
  const rerolls = Math.max(promoted.splitCount - 1, promoted.rank - 1);
  return `Teams are set · reroll ${promoted.rank - 1} of ${rerolls}`;
}

/** `` `top` Hana · 1434 `` , plus ` · off-role` on the line of whoever is off it. */
function teamsLine(player: TeamsPlayer): string {
  return `\`${player.role}\` ${renderName(player.name)} · ${player.rating}${player.offRole ? ' · off-role' : ''}`;
}

/** `` `adc` Bilal · 1667 (-46) ``. The same shape as a teams line, on purpose. */
function resultLine(player: ResultPlayer): string {
  const role = player.role === null ? '' : `\`${player.role}\` `;
  return `${role}${renderName(player.name)} · ${player.rating} (${formatDelta(player.delta)})`;
}

/**
 * `+43`, `-46`, and `+0` / `-0` for a change too small to round to a point.
 *
 * Signed always: `(0)` never appears, because one unsigned entry in a column of ten signed
 * ones reads as a bug (`05-design.md`, "Rating delta"). ASCII `-`, not U+2212 — Discord has no
 * font control and these lines get copy-pasted. `-0 >= 0` is true in JavaScript, so the
 * negative zero has to be asked about by identity before anything else looks at the sign.
 */
export function formatDelta(delta: number): string {
  if (Object.is(delta, -0)) return '-0';
  return delta >= 0 ? `+${delta}` : String(delta);
}

/** `34:12`, and `1:02:03` for the long ones. */
export function formatDuration(durationS: number): string {
  const total = Math.max(0, Math.round(durationS));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** `47.3k` over a thousand, the plain number below it. */
export function formatDamage(damage: number): string {
  return damage >= 1_000 ? `${(damage / 1_000).toFixed(1)}k` : String(Math.round(damage));
}

/**
 * The name as it is printed: the display name, truncated at 32 characters, or `Someone` for a
 * player the database has no name for yet (M3.10). The fallback is a rendering rule and
 * nothing else — it is never written to `players`.
 *
 * A name is **text, not markup**. Riot IDs carry underscores and asterisks, and one stray
 * backtick closes the role's code span and swallows the rest of the field. So the markdown
 * characters are backslash-escaped — **last**, on the already-truncated string, so an escape
 * can never be sliced away from the character it belongs to and the 32 characters stay the 32
 * characters a reader sees (`05-design.md`, 2026-09-09).
 */
export function renderName(name: PlayerName): string {
  const trimmed = (name ?? '').trim();
  if (trimmed.length === 0) return NAMELESS_PLAYER;
  const cut = trimmed.length > MAX_NAME_LENGTH ? `${trimmed.slice(0, MAX_NAME_LENGTH - 1)}…` : trimmed;
  return escapeMarkdown(cut);
}

/** Backtick, `*`, `_`, `~`, `|` and the backslash itself. There is no name we want italicised. */
function escapeMarkdown(value: string): string {
  return value.replace(/([`*_~|\\])/g, '\\$1');
}

/** `Customs Night · more on the tonight page`, or just the name when there is no link. */
function teamsFooter(url: string | undefined): string {
  return url === undefined ? 'Customs Night' : 'Customs Night · more on the tonight page';
}

/** `Sara and Deniz`, `Sara, Deniz and Ali` (M2.15). */
export function joinNames(names: readonly PlayerName[]): string {
  const rendered = names.map(renderName);
  if (rendered.length <= 1) return rendered[0] ?? '';
  return `${rendered.slice(0, -1).join(', ')} and ${rendered[rendered.length - 1]}`;
}

/** M2.15's and M3.12's copy, verbatim. Product owns all three; none is composed elsewhere. */
function sitOutLine(names: readonly PlayerName[], reason: SitOutReason): string {
  return `Sitting out: ${joinNames(names)} — ${SIT_OUT_CLAUSES[reason]}.`;
}

/** The three clauses. Words from `05-design.md`, "Sit-out fields"; nothing derives them. */
const SIT_OUT_CLAUSES: Readonly<Record<SitOutReason, string>> = {
  'most-games': 'most games tonight',
  'longest-since': 'longest since they last sat out',
  'first-sit-out': 'nobody has sat out before, so somebody had to be first',
};

/** M2.15's two seat lines, verbatim. */
function seatLine(move: SeatLine): string {
  if (move.kind === 'open-slot') return `${renderName(move.mover)} is playing — take the open slot.`;
  return `Swap: ${renderName(move.sitter)} out, ${renderName(move.mover)} in.`;
}

/**
 * `` `customs-night` · password `4471` ``.
 *
 * The password half is dropped when the client did not report one — which is every lobby
 * until M4.1 creates them itself — and the whole field is absent when the name is unknown
 * too. Never empty, never the word "unknown" (M3.1 acceptance check 5).
 */
function lobbyFieldValue(lobby: { name: string | null; password: string | null }): string | null {
  const name = lobby.name?.trim() ?? '';
  const password = lobby.password?.trim() ?? '';
  if (name.length === 0 && password.length === 0) return null;
  if (name.length === 0) return `Password \`${password}\``;
  return password.length === 0 ? `\`${name}\`` : `\`${name}\` · password \`${password}\``;
}

/**
 * `Blue was favored 54%.` Past tense, because the game has been played; the teams embed's
 * present-tense clause is core's and this one is not a recomposition of it — it is the same
 * number said about a game that is over.
 *
 * The coin flip is `Neither side was favored.` and not core's `Even 50%.` (M3.11, product
 * 2026-09-09): under the headline `Red wins · 34:12`, beside a full past-tense sentence,
 * *even, 50%* reads as a scoreline before it reads as a prediction — and on a first night,
 * everyone unrated and every split gap 0, it is the first result sentence the group ever
 * reads. The number goes with it, because 50 is what "neither" means. Core's fragment in the
 * teams explanation is untouched and stays core's.
 */
function favoredClause(blueWinProb: number | null): string | null {
  if (blueWinProb === null) return null;
  const percent = Math.round(blueWinProb * 100);
  if (percent > 50) return `Blue was favored ${percent}%.`;
  if (percent < 50) return `Red was favored ${100 - percent}%.`;
  return 'Neither side was favored.';
}

function topDamageClause(top: { name: PlayerName; damage: number } | null): string | null {
  if (top === null) return null;
  return `Top damage: ${renderName(top.name)}, ${formatDamage(top.damage)}.`;
}

function inLaneOrder<T extends { role: Role | null; puuid: string }>(players: readonly T[]): T[] {
  return [...players].sort((a, b) => {
    const rankA = a.role === null ? LANE_ORDER.length : LANE_ORDER.indexOf(a.role);
    const rankB = b.role === null ? LANE_ORDER.length : LANE_ORDER.indexOf(b.role);
    if (rankA !== rankB) return rankA - rankB;
    return a.puuid < b.puuid ? -1 : a.puuid > b.puuid ? 1 : 0;
  });
}

/**
 * The number beside the side's name: the sum of five display ratings. It is not the gap —
 * the gap is computed on effective (role-adjusted) skill and lives in the explanation, which
 * is the only place the word appears.
 */
function sumRatings(players: readonly TeamsPlayer[]): number {
  return players.reduce((total, player) => total + player.rating, 0);
}
