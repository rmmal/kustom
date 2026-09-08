import type { Role } from '@customs/core';

/**
 * The Discord embeds, as pure functions (M3.1 teams; M3.3 adds the result embed here).
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

/** Lane order. Every list of five is printed in it, on both embeds, so the two line up. */
const LANE_ORDER: readonly Role[] = ['top', 'jungle', 'mid', 'adc', 'support'];

/**
 * A display name we have, or `null` for a player the database has never been told about.
 * `null` renders as `Someone` (M3.10) — at render time, here, and never stored anywhere.
 */
export type PlayerName = string | null;

/** M3.10's fallback. One word, at the display boundary, on every surface. */
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

/** Why the sitters are sitting. M2.15's two reason clauses, and no third. */
export type SitOutReason = 'most-games' | 'longest-since';

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
  /** The tonight page, or `undefined` when there is no honest URL to post. */
  url?: string | undefined;
  /** ISO 8601. Injected, so this function has no clock. */
  timestamp: string;
}

/**
 * The teams embed: two columns with role and display rating, the explanation verbatim, the
 * sit-out copy when somebody sits, and the lobby name and password so a straggler can get in.
 */
export function teamsEmbed(input: TeamsEmbedInput): WebhookPayload {
  const blue = inLaneOrder(input.blue);
  const red = inLaneOrder(input.red);

  const fields: EmbedField[] = [
    { name: `Blue · ${sumRatings(blue)}`, value: blue.map(teamsLine).join('\n'), inline: true },
    { name: `Red · ${sumRatings(red)}`, value: red.map(teamsLine).join('\n'), inline: true },
  ];

  if (input.sitOut !== null && input.sitOut.names.length > 0) {
    fields.push({ name: 'Sitting out', value: sitOutLine(input.sitOut.names, input.sitOut.reason) });
  }
  if (input.seats.length > 0) {
    fields.push({ name: 'Seats', value: input.seats.map(seatLine).join('\n') });
  }

  const lobby = lobbyFieldValue(input.lobby);
  if (lobby !== null) fields.push({ name: 'Lobby', value: lobby });

  return {
    embeds: [
      {
        color: ACCENT_COLOR,
        title: 'Teams are set',
        ...(input.url === undefined ? {} : { url: input.url }),
        description: input.explanation,
        fields,
        footer: { text: 'Customs Night · more on the tonight page' },
        timestamp: input.timestamp,
      },
    ],
  };
}

/** `` `top` Hana · 1434 `` , plus ` · off-role` on the line of whoever is off it. */
function teamsLine(player: TeamsPlayer): string {
  return `\`${player.role}\` ${renderName(player.name)} · ${player.rating}${player.offRole ? ' · off-role' : ''}`;
}

/**
 * The name as it is printed: the display name, truncated at 32 characters, or `Someone` for a
 * player the database has no name for yet (M3.10). The fallback is a rendering rule and
 * nothing else — it is never written to `players`.
 */
export function renderName(name: PlayerName): string {
  const trimmed = (name ?? '').trim();
  if (trimmed.length === 0) return NAMELESS_PLAYER;
  return trimmed.length > MAX_NAME_LENGTH ? `${trimmed.slice(0, MAX_NAME_LENGTH - 1)}…` : trimmed;
}

/** `Sara and Deniz`, `Sara, Deniz and Ali` (M2.15). */
export function joinNames(names: readonly PlayerName[]): string {
  const rendered = names.map(renderName);
  if (rendered.length <= 1) return rendered[0] ?? '';
  return `${rendered.slice(0, -1).join(', ')} and ${rendered[rendered.length - 1]}`;
}

/** M2.15's copy, verbatim. Product owns both sentences; neither is composed anywhere else. */
function sitOutLine(names: readonly PlayerName[], reason: SitOutReason): string {
  const clause = reason === 'most-games' ? 'most games tonight' : 'longest since they last sat out';
  return `Sitting out: ${joinNames(names)} — ${clause}.`;
}

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

function inLaneOrder<T extends { role: Role; puuid: string }>(players: readonly T[]): T[] {
  return [...players].sort((a, b) => {
    const rank = LANE_ORDER.indexOf(a.role) - LANE_ORDER.indexOf(b.role);
    return rank !== 0 ? rank : a.puuid < b.puuid ? -1 : a.puuid > b.puuid ? 1 : 0;
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
