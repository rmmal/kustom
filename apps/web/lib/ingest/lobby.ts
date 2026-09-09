import {
  type CompanionLobbyPayload,
  type LobbyInsert,
  type LobbyMemberInsert,
  type LobbyStatusValue,
  type LobbyUpdate,
  rosterKey,
} from '@customs/db';
import { supersedeLobbyCommands } from '../commands/queue';
import type { CompanionIdentity } from '../companionAuth';
import {
  assertLegalTransition,
  isRosterStable,
  moveLobby,
  PLAYERS_PER_GAME,
  readLobbyStatus,
  recheckInMs,
} from '../lobbyState';
import { DEFAULT_NIGHT_TIME_ZONE } from '../night';
import type { ServiceClient } from '../supabase';
import { type BalanceOutcome, balanceLobby, hasChosenSplit } from './balance';
import { emitLobbyBalanced } from './hooks';
import { ensurePlayers } from './players';
import { SelectionError } from './selection';

/**
 * Lobby ingest: the companion posts the whole member list every time it changes and this
 * makes the database match it.
 *
 * A lobby row is **one game cycle, not one party** (M2.14). The client keeps the same
 * `partyId` all night, so a post resolves to the party's *live* row — `open`, `balanced` or
 * `in_game` — and starts a new row when the latest one is `dropped`, `finished` or
 * `abandoned`.
 * Migration `0003` is the other half: the partial unique index that allows exactly one live
 * row per party and any number of closed ones.
 *
 * It is also where the lobby state machine turns (M2.5). The whole of "the roster has not
 * changed for ten seconds" is measured on the posts themselves:
 *
 * 1. the roster's **identity** is `rosterKey()` over the puuids of everyone around,
 *    spectators included — sides, the spectator flag, names and the lobby name are not part
 *    of it, so a friend swapping from blue to red does not restart the clock;
 * 2. the **clock** is the lobby row's own `updated_at`, which moves only when we write the
 *    `lobbies` row, and we write it only when that identity changed. `lobby_members` and
 *    `players` are written on every post — sides, the spectator flag and Riot IDs stay
 *    current — and neither touches the clock;
 * 3. the **knock** is `recheckInMs` in the answer: the companion re-posts the identical
 *    payload after that many milliseconds, so the rule lives on the server and the companion
 *    has no rule to get wrong, only a number to obey.
 *
 * Balancing itself is `balance.ts` and the maths is `@customs/core`. Discord is M3.1 and
 * hears about it through `hooks.ts`, never from here.
 */

export interface LobbyIngestResult {
  lobbyId: string;
  status: LobbyStatusValue;
  /** False when the party's live row was already known — the idempotent case. */
  created: boolean;
  memberCount: number;
  /** True when the roster was frozen and this post changed no `lobby_members` row (M2.9). */
  rosterFrozen: boolean;
  /** PUUIDs among the posted members whose rank is missing or over a week old (M2.4). */
  ranksNeeded: string[];
  /** Knock again in this many milliseconds, or `null` for "do nothing" (M2.5). */
  recheckInMs: number | null;
  /** Set only by the post that moved this lobby to `balanced`. What M3.1 will render. */
  balanced: BalanceOutcome | null;
}

/**
 * "Once, then weekly" (M2.4), as a single number on the server. A player is worth asking the
 * client about when we have never had a rank for them or when the one we have is older than
 * this. The companion holds no staleness rule of its own: it asks about exactly the PUUIDs
 * this returns, and a puuid drops off the list the moment its rank POST lands.
 */
export const RANK_STALE_MS = 7 * 24 * 60 * 60 * 1000;

/** Postgres `unique_violation`. Two companions opening the same cycle in the same millisecond. */
const UNIQUE_VIOLATION = '23505';

/**
 * The statuses a lobby row can still be posted to (M2.14). A party has at most one row in
 * one of these — `lobbies_active_party_idx` enforces it — and `dropped`, `finished` and
 * `abandoned` are outside the set, so the next post for that party starts the night's next
 * cycle.
 *
 * `dropped` leaving the set is the point of M5.11: it is how a stuck `in_game` row stops
 * swallowing the rest of the night's posts.
 */
export const ACTIVE_LOBBY_STATUSES: readonly LobbyStatusValue[] = ['open', 'balanced', 'in_game'];

/** Is this row still the party's live lobby, or is its cycle over? */
export function isActiveLobbyStatus(status: LobbyStatusValue): boolean {
  return ACTIVE_LOBBY_STATUSES.includes(status);
}

/**
 * Statuses in which `lobby_members` is history rather than live state (M2.9). From `in_game`
 * on, who was in the lobby is what M2.7 matches tonight's ten against and what M5.5 lists,
 * so a late or partial post must not be able to rewrite it.
 *
 * `dropped` is here (M5.11) and `abandoned` is not, and that is the whole difference between
 * the two: a game that started and lost its result keeps the record of who played it, while a
 * lobby that dissolves without ever starting keeps the normal replace semantics (M2.9 brief,
 * "Edge cases"). Neither is in {@link ACTIVE_LOBBY_STATUSES}, so a post for that party starts
 * the night's next cycle rather than landing here at all.
 */
const ROSTER_FROZEN_STATUSES: readonly LobbyStatusValue[] = ['in_game', 'dropped', 'finished'];

/** True when later posts may no longer add, remove or change a `lobby_members` row. */
export function isRosterFrozen(status: LobbyStatusValue): boolean {
  return ROSTER_FROZEN_STATUSES.includes(status);
}

/**
 * Is this PUUID in the list? Whole-PUUID equality, spectators included: a friend who watches
 * a round is in the lobby and their companion is a legitimate reporter.
 *
 * Takes anything with a `puuid`, so the same predicate serves the posted member list here and
 * the `lobby_members` rows the game route reads (M2.8, `isLobbyMemberOfGame` below).
 */
export function isLobbyMember(members: readonly { puuid: string }[], puuid: string): boolean {
  return members.some((member) => member.puuid === puuid);
}

/**
 * May this companion report this party? (M1.8)
 *
 * The token says who the caller is; the body says who is in the lobby. A companion may only
 * report a lobby it is in, because `replaceMembers` below deletes everyone the post leaves
 * out — without this, one stale companion silently rewrites another lobby's roster.
 *
 * Two ways to pass:
 * - the caller's PUUID is in the posted `members` (any `isSpectator` value);
 * - the caller already owns the lobby row (`reported_by_player_id`). That covers the
 *   "everyone left" report — an empty list cannot contain the caller — and a client that
 *   stops listing the caller once they are only spectating (M0.3).
 *
 * An outsider posting an empty or foreign list matches neither and gets a 403.
 */
export async function mayReportLobby(
  client: ServiceClient,
  payload: CompanionLobbyPayload,
  identity: CompanionIdentity,
): Promise<boolean> {
  if (isLobbyMember(payload.members, identity.puuid)) return true;

  // The *live* row only (M2.14): owning a party's finished lobby does not entitle anyone to
  // open the next cycle with a roster they are not in.
  const existing = await selectActiveLobby(client, payload.partyId);
  return existing !== null && existing.reportedByPlayerId === identity.playerId;
}

/**
 * Was this player in the lobby the posted game was played from (M2.8)?
 *
 * The spectator's path into the game route: a friend who sits out a round and runs the
 * companion while watching is not on the scoreboard, but they are a `lobby_members` row of
 * that lobby, `is_spectator` and all. On 16.17 a spectator stays in the client's `members[]`
 * with `isSpectator: true` (M2.13), so this check has something to match.
 *
 * A token whose player is in neither list still gets a 403.
 */
export async function isLobbyMemberOfGame(
  client: ServiceClient,
  partyId: string | null,
  playerId: string,
  startedAt?: string | null,
): Promise<boolean> {
  if (partyId === null) return false;

  const lobby = await selectLatestLobby(client, partyId, startedAt);
  if (lobby === null) return false;

  const { count, error } = await client
    .from('lobby_members')
    .select('player_id', { count: 'exact', head: true })
    .eq('lobby_id', lobby.id)
    .eq('player_id', playerId);
  if (error) throw new Error(`ingestGame: lobby membership check failed: ${error.message}`);
  return (count ?? 0) > 0;
}

export interface LobbyIngestOptions {
  /** Injected in tests so the ten-second window does not have to be waited out. */
  now?: Date;
  /** IANA name for "tonight" (M2.5). `CUSTOMS_NIGHT_TZ` in the route. */
  timeZone?: string;
  /**
   * The posting request's origin, carried to the `balanced` hook for the Discord embed's
   * `url` (M3.1). Ingest neither reads it nor writes it anywhere; it is passed through.
   */
  requestOrigin?: string | null;
}

export async function ingestLobby(
  client: ServiceClient,
  payload: CompanionLobbyPayload,
  reportedByPlayerId: string,
  options: LobbyIngestOptions = {},
): Promise<LobbyIngestResult> {
  const now = options.now ?? new Date();
  const timeZone = options.timeZone ?? DEFAULT_NIGHT_TIME_ZONE;
  const { lobby, created } = await upsertLobby(client, payload, reportedByPlayerId);

  // Frozen (M2.9): the lobby is in a game or done, so the roster is a record of what
  // happened. Report what is stored and write nothing to `lobby_members`.
  if (isRosterFrozen(lobby.status)) {
    return {
      lobbyId: lobby.id,
      status: lobby.status,
      created,
      memberCount: await countMembers(client, lobby.id),
      rosterFrozen: true,
      // Still answered while frozen: whoever is on the posted list and has no fresh rank is
      // worth asking about, and the game that froze the roster does not change that.
      ranksNeeded: await selectRanksNeeded(client, payload, now),
      recheckInMs: null,
      balanced: null,
    };
  }

  const posted = rosterIdentity(payload.members.map((member) => member.puuid));
  const stored = created ? null : rosterIdentity(await selectMemberPuuids(client, lobby.id));
  const rosterChanged = posted !== stored;

  // The members are always written, whether or not the identity moved: a friend swapping side
  // or stepping into the spectator slot has to land in `lobby_members` (the seat plan reads
  // it) and a Riot ID that changed has to land in `players` (M1.7). Neither touches
  // `lobbies`, so neither restarts the clock — only the write below does that.
  const memberCount = await replaceMembers(client, lobby.id, payload);

  let row = lobby;
  if (rosterChanged && !created) {
    // Writing the lobby row is what restarts the ten seconds: `lobbies_set_updated_at` does
    // the rest. A freshly inserted row already has `updated_at = now`, so it is left alone.
    row = await restartClock(client, lobby);
  }

  const elapsedMs = now.getTime() - Date.parse(row.updatedAt);
  const attempt = await maybeBalance(client, {
    lobby: row,
    around: memberCount,
    rosterChanged,
    elapsedMs,
    now,
    timeZone,
    requestOrigin: options.requestOrigin ?? null,
  });
  const balanced = attempt.kind === 'balanced' ? attempt.outcome : null;
  // A request that lost the race writes nothing and answers with the status the winner left
  // behind, because a companion that is told `open` would knock again for no reason.
  const status =
    attempt.kind === 'balanced'
      ? 'balanced'
      : attempt.kind === 'lost'
        ? ((await readLobbyStatus(client, lobby.id)) ?? row.status)
        : row.status;

  return {
    lobbyId: lobby.id,
    status,
    created,
    memberCount,
    rosterFrozen: false,
    ranksNeeded: await selectRanksNeeded(client, payload, now),
    recheckInMs: recheckInMs({ status, around: memberCount, elapsedMs, rosterChanged }),
    balanced,
  };
}

/**
 * The roster's identity: `rosterKey()` over everyone around, sorted, so member order is never
 * mistaken for a change. Sides, the `isSpectator` flag, names, `role_override`, the lobby
 * name and the password are deliberately not in it — the balancer assigns sides itself and
 * the rotation treats a spectator as one of the people who are here.
 */
function rosterIdentity(puuids: readonly string[]): string {
  const unique = [...new Set(puuids)];
  return unique.length === 0 ? '' : rosterKey(unique);
}

/** The puuids currently stored for this lobby, in no particular order. */
async function selectMemberPuuids(client: ServiceClient, lobbyId: string): Promise<string[]> {
  const { data, error } = await client
    .from('lobby_members')
    .select('players!inner(puuid)')
    .eq('lobby_id', lobbyId);
  if (error) throw new Error(`ingestLobby: stored roster select failed: ${error.message}`);
  return (data ?? []).map((row) => row.players.puuid);
}

/**
 * The roster changed, so the ten seconds start again and the lobby is `open` — from
 * `balanced` that is the "someone left" transition, and the earlier splits stay where they
 * are as history.
 */
async function restartClock(client: ServiceClient, lobby: ExistingLobby): Promise<ExistingLobby> {
  // Through the table like every other move, even though this one writes the row back.
  assertLegalTransition(lobby.status, 'open');

  const { data, error } = await client
    .from('lobbies')
    .update({ status: 'open' })
    .eq('id', lobby.id)
    .in('status', ['open', 'balanced'])
    .select(LOBBY_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`ingestLobby: clock restart failed: ${error.message}`);

  // Leaving `balanced` takes the split's pending `switch_side` commands with it (M4.1). This is
  // the one exit from `balanced` that does not go through `moveLobby`, so it says so itself.
  if (data !== null && lobby.status === 'balanced') {
    try {
      await supersedeLobbyCommands(client, lobby.id, 'the roster changed');
    } catch (commandError) {
      console.error(`ingestLobby: superseding commands for lobby ${lobby.id} failed`, commandError);
    }
  }

  // No row back means another request moved the lobby out from under us (to `in_game`, say).
  // Its status wins; this post has already replaced the members and there is nothing to undo.
  return data ? toExistingLobby(data) : lobby;
}

interface MaybeBalanceInput {
  lobby: ExistingLobby;
  around: number;
  rosterChanged: boolean;
  elapsedMs: number;
  now: Date;
  timeZone: string;
  /** Passed straight to the `balanced` hook for the embed's `url` (M3.1). */
  requestOrigin: string | null;
}

/**
 * Balance, if this post is the one that should.
 *
 * The transition is claimed with a compare-and-set (`moveLobby`), so two companions posting
 * the same lobby at the ten-second mark produce one balance and three splits: the loser's
 * update returns no row, it writes nothing and it answers 200.
 *
 * The second branch is the self-healing path, not a bug: if the split insert failed after the
 * status moved, the lobby sits at `balanced` with no chosen split, and the next post (or the
 * next recheck) balances again.
 */
type BalanceAttempt =
  /** Not this post's business: too few around, the clock is still running, or already done. */
  | { kind: 'none' }
  | { kind: 'balanced'; outcome: BalanceOutcome }
  /** Another request claimed the transition first. This one writes nothing. */
  | { kind: 'lost' }
  /** The ten could not be made or could not be split. The lobby is back at `open`. */
  | { kind: 'failed' };

async function maybeBalance(client: ServiceClient, input: MaybeBalanceInput): Promise<BalanceAttempt> {
  const { lobby, around, rosterChanged, elapsedMs } = input;
  if (around < PLAYERS_PER_GAME) return { kind: 'none' };

  if (lobby.status === 'open') {
    if (rosterChanged || !isRosterStable(elapsedMs)) return { kind: 'none' };
    if (!(await moveLobby(client, { lobbyId: lobby.id, from: ['open'], to: 'balanced' }))) {
      return { kind: 'lost' };
    }
  } else if (lobby.status === 'balanced') {
    if (rosterChanged || (await hasChosenSplit(client, lobby.id))) return { kind: 'none' };
    console.warn(`lobby ${lobby.id}: balanced with no chosen split; balancing again`);
  } else {
    return { kind: 'none' };
  }

  try {
    const outcome = await balanceLobby(client, lobby, input.now, input.timeZone);
    // Discord is M3.1 and hears about it here. Every acceptance check passes with no listener
    // registered at all, which is the point of the seam.
    await emitLobbyBalanced({ ...outcome, requestOrigin: input.requestOrigin });
    return { kind: 'balanced', outcome };
  } catch (error) {
    // A balance that cannot happen must never reach the companion: one line, the lobby back
    // where it was, and the next post tries again. A wrong ten is worse than no teams.
    // `SelectionError` (a pool that cannot make ten) and core's `BalanceError` (ten that
    // cannot be split) both land here, and both mean nothing was written.
    console.error(
      `lobby ${lobby.id}: balancing failed`,
      error instanceof SelectionError ? error.message : error,
    );
    await moveLobby(client, { lobbyId: lobby.id, from: ['balanced'], to: 'open' });
    return { kind: 'failed' };
  }
}

/**
 * The puuids among the members just posted whose `players` row has no `rank_updated_at`, one
 * older than `RANK_STALE_MS`, or no row at all (M2.4). One select over at most twenty rows.
 *
 * Spectators are included: they play the next round, and the same POST is how a name arrives
 * for someone the lobby response could not name (M2.10, point 2).
 *
 * The order is the posted member order, so two companions in the same lobby get the same
 * list in the same order and the companion's own de-duplicator sees a stable sequence.
 */
async function selectRanksNeeded(
  client: ServiceClient,
  payload: CompanionLobbyPayload,
  now: Date,
): Promise<string[]> {
  const puuids = [...new Set(payload.members.map((member) => member.puuid))];
  if (puuids.length === 0) return [];

  const { data, error } = await client.from('players').select('puuid, rank_updated_at').in('puuid', puuids);
  if (error) throw new Error(`ingestLobby: rank staleness select failed: ${error.message}`);

  const freshAfter = now.getTime() - RANK_STALE_MS;
  const fresh = new Set<string>();
  for (const row of data ?? []) {
    const updatedAt = row.rank_updated_at === null ? null : Date.parse(row.rank_updated_at);
    // An unparseable timestamp is treated as stale rather than throwing: asking once more is
    // cheap, and a rank we cannot date is a rank we cannot trust to be recent.
    if (updatedAt !== null && !Number.isNaN(updatedAt) && updatedAt >= freshAfter) fresh.add(row.puuid);
  }

  // A puuid with no row at all is not in `fresh`, so it is asked about — that is the
  // first-night case, and the rank POST creates the row.
  return puuids.filter((puuid) => !fresh.has(puuid));
}

interface LobbyRowResult {
  lobby: ExistingLobby;
  /** True when this post started a cycle: an unseen party, or the night's next game (M2.14). */
  created: boolean;
}

/**
 * Find the party's live row, or start a new cycle, then refresh the fields the client can
 * tell us about. Reposting an unchanged lobby writes nothing, so `updated_at` still means
 * "something changed" — which is the whole of M2.5's stability clock.
 */
async function upsertLobby(
  client: ServiceClient,
  payload: CompanionLobbyPayload,
  reportedByPlayerId: string,
): Promise<LobbyRowResult> {
  const existing = await selectActiveLobby(client, payload.partyId);

  if (existing === null) {
    const insert: LobbyInsert = {
      lcu_party_id: payload.partyId,
      reported_by_player_id: reportedByPlayerId,
      lobby_name: payload.lobbyName,
      lobby_password: payload.lobbyPassword,
    };
    // A plain insert, not an upsert: `lcu_party_id` is no longer unique by itself (M2.14) and
    // `lobbies_active_party_idx` is partial, so there is no constraint for `on conflict` to
    // infer. The unique violation below is the race, and it is handled by re-reading.
    const { data, error } = await client.from('lobbies').insert(insert).select(LOBBY_COLUMNS).single();
    if (!error && data) return { lobby: toExistingLobby(data), created: true };
    if (error && error.code !== UNIQUE_VIOLATION) {
      throw new Error(`ingestLobby: insert failed: ${error.message}`);
    }

    // Another companion opened the same cycle between our select and our insert.
    const raced = await selectActiveLobby(client, payload.partyId);
    if (raced === null) throw new Error('ingestLobby: lobby vanished after a conflicting insert');
    return { lobby: raced, created: false };
  }

  const patch: LobbyUpdate = {};
  // The first companion to report a party owns it; a second companion in the same lobby is a
  // no-op rather than a tug of war over `reported_by_player_id`.
  if (existing.reportedByPlayerId === null) patch.reported_by_player_id = reportedByPlayerId;
  if (payload.lobbyName !== null && payload.lobbyName !== existing.lobbyName) {
    patch.lobby_name = payload.lobbyName;
  }
  if (payload.lobbyPassword !== null && payload.lobbyPassword !== existing.lobbyPassword) {
    patch.lobby_password = payload.lobbyPassword;
  }

  if (Object.keys(patch).length > 0) {
    // This fires `lobbies_set_updated_at`, so a renamed lobby costs one more recheck before
    // it balances (M2.5, "How unchanged for 10 seconds is measured"). Read the row back so
    // the clock the caller measures against is the one the database just wrote.
    const { data, error } = await client
      .from('lobbies')
      .update(patch)
      .eq('id', existing.id)
      .select(LOBBY_COLUMNS)
      .single();
    if (error) throw new Error(`ingestLobby: update failed: ${error.message}`);
    return { lobby: toExistingLobby(data), created: false };
  }

  return { lobby: existing, created: false };
}

/** A `lobbies` row, as everything downstream of the party-id lookup wants to read it. */
export interface ExistingLobby {
  id: string;
  status: LobbyStatusValue;
  reportedByPlayerId: string | null;
  lobbyName: string | null;
  lobbyPassword: string | null;
  /** The stability clock (M2.5): moved by every write to the row, by the `updated_at` trigger. */
  updatedAt: string;
  createdAt: string;
}

const LOBBY_COLUMNS = 'id, status, reported_by_player_id, lobby_name, lobby_password, updated_at, created_at';

function toExistingLobby(row: {
  id: string;
  status: LobbyStatusValue;
  reported_by_player_id: string | null;
  lobby_name: string | null;
  lobby_password: string | null;
  updated_at: string;
  created_at: string;
}): ExistingLobby {
  return {
    id: row.id,
    status: row.status,
    reportedByPlayerId: row.reported_by_player_id,
    lobbyName: row.lobby_name,
    lobbyPassword: row.lobby_password,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

/**
 * The party's **live** row: `open`, `balanced` or `in_game`, newest first (M2.14). `null`
 * means this party has no open cycle — either it has never been seen, or its last cycle is
 * `dropped`/`finished`/`abandoned` and the next post starts a new row.
 *
 * The `dropped` case is M5.11's whole fix: the two-hour sweep takes a lobby whose game never
 * landed out of the live set, and this lookup then answers `null` for the party the way it
 * would after a finished game.
 *
 * There can be at most one such row (`lobbies_active_party_idx`); the ordering is belt and
 * braces for a database that somehow holds two.
 */
export async function selectActiveLobby(
  client: ServiceClient,
  partyId: string,
): Promise<ExistingLobby | null> {
  const { data, error } = await client
    .from('lobbies')
    .select(LOBBY_COLUMNS)
    .eq('lcu_party_id', partyId)
    .in('status', ACTIVE_LOBBY_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`ingestLobby: select failed: ${error.message}`);
  return data ? toExistingLobby(data) : null;
}

/**
 * The party's live row, or — when its cycle has closed — the newest row it has (M2.14).
 *
 * This is what a **game** post resolves through: an end-of-game block that arrives after the
 * lobby was already marked `finished`, or after the group opened the night's next cycle,
 * still belongs to the row it was played from. A lobby post must never use this: it would
 * write into a frozen row instead of starting the next cycle.
 */
export async function selectLatestLobby(
  client: ServiceClient,
  partyId: string,
  /**
   * When the game started, for an end-of-game block. The cycle a game belongs to is the
   * newest row that already existed when it kicked off, which is what keeps a late eog on
   * the lobby it was played from even after the group has opened the night's next one.
   * Omitted (the `in_progress` ping) means "the live row".
   */
  startedAt?: string | null,
): Promise<ExistingLobby | null> {
  const { data, error } = await client
    .from('lobbies')
    .select(LOBBY_COLUMNS)
    .eq('lcu_party_id', partyId)
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) throw new Error(`ingestGame: lobby lookup failed: ${error.message}`);

  const rows = (data ?? []).map(toExistingLobby);
  const started = startedAt == null ? Number.NaN : Date.parse(startedAt);
  const byStart = Number.isNaN(started)
    ? undefined
    : rows.find((row) => Date.parse(row.createdAt) <= started);

  // Ordered newest first, so the first match is the newest row that predates the game. The
  // fallbacks cover a companion whose clock is off and a game whose lobby was only reported
  // after it had started: the live row, and then whatever the party's newest row is.
  return byStart ?? rows.find((row) => isActiveLobbyStatus(row.status)) ?? rows[0] ?? null;
}

/**
 * The reported list replaces whatever we had: members who left are deleted, members who
 * stayed keep their `role` and `role_override` (M3.6 owns those columns).
 */
async function replaceMembers(
  client: ServiceClient,
  lobbyId: string,
  payload: CompanionLobbyPayload,
): Promise<number> {
  const playerIds = await ensurePlayers(
    client,
    payload.members.map((member) => ({
      puuid: member.puuid,
      summonerId: member.summonerId,
      gameName: member.gameName,
      tagLine: member.tagLine,
    })),
  );

  const rows = new Map<string, LobbyMemberInsert>();
  for (const member of payload.members) {
    const playerId = playerIds.get(member.puuid);
    if (playerId === undefined) continue;
    rows.set(playerId, {
      lobby_id: lobbyId,
      player_id: playerId,
      side: member.side,
      is_spectator: member.isSpectator,
    });
  }

  const keep = [...rows.keys()];
  const remove = client.from('lobby_members').delete().eq('lobby_id', lobbyId);
  const { error: deleteError } = await (keep.length === 0
    ? remove
    : remove.not('player_id', 'in', `(${keep.map((id) => `"${id}"`).join(',')})`));
  if (deleteError) throw new Error(`ingestLobby: member delete failed: ${deleteError.message}`);

  if (keep.length > 0) {
    const { error } = await client
      .from('lobby_members')
      .upsert([...rows.values()], { onConflict: 'lobby_id,player_id' });
    if (error) throw new Error(`ingestLobby: member upsert failed: ${error.message}`);
  }

  return keep.length;
}

async function countMembers(client: ServiceClient, lobbyId: string): Promise<number> {
  const { count, error } = await client
    .from('lobby_members')
    .select('player_id', { count: 'exact', head: true })
    .eq('lobby_id', lobbyId);
  if (error) throw new Error(`ingestLobby: member count failed: ${error.message}`);
  return count ?? 0;
}
