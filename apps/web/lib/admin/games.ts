import type { LobbyStatus } from '@customs/core';
import { DISPLAY_LOCALE, nightStart } from '../night';
import type { ServiceClient } from '../supabase';
import { type NameableRow, playerLabel } from './playerName';

/**
 * The two lists behind `/admin/games` — the missed-game report (M5.5).
 *
 * "The games we did capture" and "the lobbies we did not" are the same query over the same two
 * tables, which is why one page answers both (`04-decisions.md`, 2026-09-09).
 *
 * Everything here **reads**. There is no write in this file and there is no route beside it:
 * the stuck row is the evidence, and a button that clears evidence on the only page that shows
 * it is the wrong shape. The cost of a stuck row was fixed by a server rule instead (M5.11).
 */

/**
 * Product's words for this page (brief, 2026-09-09), verbatim.
 *
 * Kept here rather than inline in the page so a test can pin them byte for byte: this page is
 * the only place an admin ever learns that a night went missing, and the sentence about a
 * result arriving while the lobby stayed open is naming a *different* bug from the one above
 * it. Nothing here is friend-facing; it is still product's to word.
 */
export const GAMES_COPY = {
  heading: 'Games',
  missed: 'Missed',
  missedIntro:
    "These lobbies started a game and no result ever arrived. Somebody's companion was closed at the final whistle. Backfill usually picks the game up the next day and the row disappears on its own.",
  missedEmpty: 'Nothing missing. Every game that started has a result.',
  captured: 'Captured',
  capturedIntro:
    'The last 200 games the server has. Backfilled games are rated by pnpm --filter web rebuild-ratings, not on arrival.',
  capturedEmpty: 'No games yet.',
  lobbyNeverClosed:
    'A result arrived for this game but the lobby never moved to finished. The rating is fine; the lobby row is stuck.',
} as const;

/**
 * A lobby that started a game and never came back.
 *
 * `in_game` is one that may still be being played; `dropped` is one the two-hour sweep gave up
 * on (M5.11). One constant with both values in it, so no query anywhere says `'in_game'` twice
 * and nothing can drift to listing only half of them.
 */
export const MISSED_LOBBY_STATUSES: readonly LobbyStatus[] = ['in_game', 'dropped'];

/** The brief's caps. Past them the news is not the list, it is that the rule is not followed. */
export const MISSED_CAP = 100;
export const CAPTURED_CAP = 200;

/**
 * Which of the two things went wrong.
 *
 * `no game` is the ordinary case and the whole point of the page. `game landed, lobby never
 * closed` is a different bug — the finish transition failed after the insert — and it must not
 * hide inside the same word as the first one.
 */
export type MissedState = 'no game' | 'game landed, lobby never closed';

export interface MissedMember {
  puuid: string;
  name: string;
}

export interface MissedLobbyRow {
  id: string;
  /** `Tue 9 Sep`: the night the lobby's `created_at` belongs to, in `CUSTOMS_NIGHT_TZ`. */
  night: string;
  /** When it went in-game (`updated_at`), as a clock time in the same zone. */
  wentInGameAt: string;
  status: LobbyStatus;
  /** Who posted it, through M3.10's fallback chain. `unknown` when the row lost its reporter. */
  reportedBy: string;
  /** …and their PUUID, so the name is the same link the roster names are. Null with no reporter. */
  reportedByPuuid: string | null;
  /** The frozen roster (M2.9): however many are really on the row, names and all. */
  members: MissedMember[];
  /** The first eight characters of the party id, to match against a companion log. */
  partyId: string;
  state: MissedState;
}

export interface MissedReport {
  rows: MissedLobbyRow[];
  /** Every missed lobby there is, not just the hundred shown. */
  total: number;
  cap: number;
}

export interface CapturedGameRow {
  id: string;
  lcuGameId: string;
  night: string;
  startedAt: string;
  /** `34:12`. */
  duration: string;
  source: 'eog' | 'backfill';
  participants: number;
  /** True only when every `game_players` row carries a `mu_after`: the fold really ran. */
  rated: boolean;
  seasonName: string;
  /** The lobby's short party id, or `null` for a backfilled game that has no lobby. */
  partyId: string | null;
}

export interface GamesReportOptions {
  /** `CUSTOMS_NIGHT_TZ`, resolved by the caller. Every date on this page is in it. */
  timeZone: string;
  /**
   * How many rows to read. The page never passes it — the caps are the brief's — and the
   * integration test does, so "stops at the cap and still prints the real total" is proved
   * against three rows on a shared stack instead of by seeding a hundred stuck lobbies into a
   * database other suites are reading.
   */
  cap?: number;
}

/**
 * `Tue 9 Sep`: the night a timestamp belongs to.
 *
 * The night, not the calendar day — a lobby that went in-game at 01:20 belongs to the night
 * that started at 06:00 the morning before, which is the night the group remembers playing.
 * Same locale as every other date in the app (`night.ts`), so an admin page and a friend-facing
 * page never disagree about what a date looks like.
 */
export function formatNightOf(instant: Date, timeZone: string): string {
  const start = nightStart(instant, timeZone);
  const parts = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).formatToParts(start);
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  // `Sept` on current ICU for en-GB, three letters everywhere else: cut, as `formatDayMonth` does.
  return `${read('weekday')} ${read('day')} ${read('month').slice(0, 3)}`;
}

/** `23:14` in the night's own zone: the column that tells an admin at midnight how old this is. */
export function formatClock(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).format(instant);
}

/** `34:12` from seconds. A game shorter than a minute still reads `0:42`, not `42`. */
export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.trunc(seconds));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`;
}

/** The first eight characters of a party id: enough to grep a companion log with. */
export function shortPartyId(partyId: string): string {
  return partyId.length <= 8 ? partyId : partyId.slice(0, 8);
}

/**
 * Every lobby that reached `in_game` and never finished, newest first, capped at 100.
 *
 * Not season-scoped and not filtered by age: a lobby stuck since half an hour ago is listed
 * beside one from March, because the page is a list of games without results and an admin
 * reading it at midnight can read a clock. `total` carries the real number so a cap that bites
 * is visible.
 */
export async function listMissedLobbies(
  client: ServiceClient,
  { timeZone, cap = MISSED_CAP }: GamesReportOptions,
): Promise<MissedReport> {
  const { data, error, count } = await client
    .from('lobbies')
    .select(
      'id, lcu_party_id, status, created_at, updated_at, reported_by:players!lobbies_reported_by_player_id_fkey(puuid, display_name, game_name, tag_line), lobby_members(players(puuid, display_name, game_name, tag_line)), games(id)',
      { count: 'exact' },
    )
    .in('status', [...MISSED_LOBBY_STATUSES])
    .order('updated_at', { ascending: false })
    .range(0, Math.max(1, cap) - 1);

  if (error) throw new Error(`listMissedLobbies failed: ${error.message}`);

  const rows = (data ?? []).map((row): MissedLobbyRow => {
    const members = row.lobby_members
      .map((member) => member.players)
      .filter((player): player is NonNullable<typeof player> => player !== null)
      .map((player) => ({ puuid: player.puuid, name: playerLabel(nameable(player)) }))
      .sort((left, right) => left.name.localeCompare(right.name, DISPLAY_LOCALE));

    return {
      id: row.id,
      night: formatNightOf(new Date(row.created_at), timeZone),
      wentInGameAt: formatClock(new Date(row.updated_at), timeZone),
      status: row.status,
      // `on delete set null`, so a deleted player leaves a lobby with no reporter. It is still
      // a missed game and it is still listed.
      reportedBy: row.reported_by === null ? 'unknown' : playerLabel(nameable(row.reported_by)),
      reportedByPuuid: row.reported_by?.puuid ?? null,
      members,
      partyId: shortPartyId(row.lcu_party_id),
      state: row.games.length > 0 ? 'game landed, lobby never closed' : 'no game',
    };
  });

  return { rows, total: count ?? rows.length, cap };
}

/**
 * The last 200 games the server has, any season, newest `started_at` first.
 *
 * `rated` is read off `game_players.mu_after` rather than off any flag: a game the fold refused
 * (`gateGame` — nine on the scoreboard, or under the duration floor) and a backfilled game that
 * no `rebuild-ratings` has folded yet both come back with null columns, and this page is where
 * that becomes visible for the first time.
 */
export async function listCapturedGames(
  client: ServiceClient,
  { timeZone, cap = CAPTURED_CAP }: GamesReportOptions,
): Promise<CapturedGameRow[]> {
  const { data, error } = await client
    .from('games')
    .select(
      'id, lcu_game_id, started_at, duration_s, source, seasons(name), lobbies(lcu_party_id), game_players(mu_after)',
    )
    .order('started_at', { ascending: false })
    .range(0, Math.max(1, cap) - 1);

  if (error) throw new Error(`listCapturedGames failed: ${error.message}`);

  return (data ?? []).map((row): CapturedGameRow => {
    const startedAt = new Date(row.started_at);
    return {
      id: row.id,
      // `lcu_game_id` is a bigint and PostgREST hands it over as a number; it is an identifier
      // here, never arithmetic, so it is printed as a string.
      lcuGameId: String(row.lcu_game_id),
      night: formatNightOf(startedAt, timeZone),
      startedAt: formatClock(startedAt, timeZone),
      duration: formatDuration(row.duration_s),
      source: row.source,
      participants: row.game_players.length,
      rated: row.game_players.length > 0 && row.game_players.every((player) => player.mu_after !== null),
      seasonName: row.seasons?.name ?? '—',
      partyId: row.lobbies === null ? null : shortPartyId(row.lobbies.lcu_party_id),
    };
  });
}

/** The `players` columns these queries select, in the shape `playerLabel` reads. */
function nameable(player: {
  puuid: string;
  display_name: string | null;
  game_name: string | null;
  tag_line: string | null;
}): NameableRow {
  return {
    puuid: player.puuid,
    displayName: player.display_name,
    gameName: player.game_name,
    tagLine: player.tag_line,
  };
}
