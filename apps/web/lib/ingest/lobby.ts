import type {
  CompanionLobbyPayload,
  LobbyInsert,
  LobbyMemberInsert,
  LobbyStatusValue,
  LobbyUpdate,
} from '@customs/db';
import type { CompanionIdentity } from '../companionAuth';
import type { ServiceClient } from '../supabase';
import { ensurePlayers } from './players';

/**
 * Lobby ingest: the companion posts the whole member list every time it changes and this
 * makes the database match it.
 *
 * Deliberately not here (M2.5): the 10-second stability rule, balancing, and every status
 * transition. A new lobby is `open`; an existing lobby keeps whatever status it has. The
 * status column is written in exactly one place and this is not it.
 */

export interface LobbyIngestResult {
  lobbyId: string;
  status: LobbyStatusValue;
  /** False when the party id was already known — the idempotent case. */
  created: boolean;
  memberCount: number;
  /** True when the roster was frozen and this post changed no `lobby_members` row (M2.9). */
  rosterFrozen: boolean;
}

/**
 * Statuses in which `lobby_members` is history rather than live state (M2.9). From `in_game`
 * on, who was in the lobby is what M2.7 matches tonight's ten against and what M5.5 lists,
 * so a late or partial post must not be able to rewrite it.
 *
 * `abandoned` is deliberately not here: a lobby that dissolves without ever starting keeps
 * the normal replace semantics (M2.9 brief, "Edge cases").
 */
const ROSTER_FROZEN_STATUSES: readonly LobbyStatusValue[] = ['in_game', 'finished'];

/** True when later posts may no longer add, remove or change a `lobby_members` row. */
export function isRosterFrozen(status: LobbyStatusValue): boolean {
  return ROSTER_FROZEN_STATUSES.includes(status);
}

/**
 * Is this PUUID in the list? Whole-PUUID equality, spectators included: a friend who watches
 * a round is in the lobby and their companion is a legitimate reporter.
 *
 * Takes anything with a `puuid`, so the same predicate serves the posted member list here
 * and, when M2.8 widens the game check to "a member of the lobby with the same party id",
 * the `lobby_members` rows read out of the database.
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

  const existing = await selectLobby(client, payload.partyId);
  return existing !== null && existing.reportedByPlayerId === identity.playerId;
}

export async function ingestLobby(
  client: ServiceClient,
  payload: CompanionLobbyPayload,
  reportedByPlayerId: string,
): Promise<LobbyIngestResult> {
  const lobby = await upsertLobby(client, payload, reportedByPlayerId);

  // Frozen (M2.9): the lobby is in a game or done, so the roster is a record of what
  // happened. Report what is stored and write nothing to `lobby_members`.
  if (isRosterFrozen(lobby.status)) {
    return {
      lobbyId: lobby.id,
      status: lobby.status,
      created: lobby.created,
      memberCount: await countMembers(client, lobby.id),
      rosterFrozen: true,
    };
  }

  const memberCount = await replaceMembers(client, lobby.id, payload);

  return {
    lobbyId: lobby.id,
    status: lobby.status,
    created: lobby.created,
    memberCount,
    rosterFrozen: false,
  };
}

interface LobbyRowResult {
  id: string;
  status: LobbyStatusValue;
  created: boolean;
}

/**
 * Insert on `lcu_party_id`, or refresh the fields the client can tell us about. Reposting an
 * unchanged lobby writes nothing, so `updated_at` still means "something changed".
 */
async function upsertLobby(
  client: ServiceClient,
  payload: CompanionLobbyPayload,
  reportedByPlayerId: string,
): Promise<LobbyRowResult> {
  const existing = await selectLobby(client, payload.partyId);

  if (existing === null) {
    const insert: LobbyInsert = {
      lcu_party_id: payload.partyId,
      reported_by_player_id: reportedByPlayerId,
      lobby_name: payload.lobbyName,
      lobby_password: payload.lobbyPassword,
    };
    const { data, error } = await client
      .from('lobbies')
      .upsert(insert, { onConflict: 'lcu_party_id', ignoreDuplicates: true })
      .select('id, status')
      .maybeSingle();
    if (error) throw new Error(`ingestLobby: insert failed: ${error.message}`);
    if (data) return { id: data.id, status: data.status, created: true };

    // Another companion inserted the same party between our select and our insert.
    const raced = await selectLobby(client, payload.partyId);
    if (raced === null) throw new Error('ingestLobby: lobby vanished after a conflicting insert');
    return { ...raced, created: false };
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
    const { error } = await client.from('lobbies').update(patch).eq('id', existing.id);
    if (error) throw new Error(`ingestLobby: update failed: ${error.message}`);
  }

  return { id: existing.id, status: existing.status, created: false };
}

interface ExistingLobby {
  id: string;
  status: LobbyStatusValue;
  reportedByPlayerId: string | null;
  lobbyName: string | null;
  lobbyPassword: string | null;
}

async function selectLobby(client: ServiceClient, partyId: string): Promise<ExistingLobby | null> {
  const { data, error } = await client
    .from('lobbies')
    .select('id, status, reported_by_player_id, lobby_name, lobby_password')
    .eq('lcu_party_id', partyId)
    .maybeSingle();
  if (error) throw new Error(`ingestLobby: select failed: ${error.message}`);
  if (!data) return null;

  return {
    id: data.id,
    status: data.status,
    reportedByPlayerId: data.reported_by_player_id,
    lobbyName: data.lobby_name,
    lobbyPassword: data.lobby_password,
  };
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
