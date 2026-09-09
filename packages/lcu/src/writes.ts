/**
 * The three lobby writes (M4.1): create a custom lobby, invite, switch side. This is the only file in the
 * repo that POSTs to the League client, and it can only POST to the paths in `LOBBY_WRITE_PATHS`: every call
 * goes through `post()` below, which throws for any other path. Create a lobby, invite, switch side. Nothing
 * else, ever (`CLAUDE.md` "Never automate gameplay").
 *
 * Every path here is `unverified` in docs/03-lcu-reference.md until a person runs the companion's
 * `--verify-commands` mode against a live client (the bodies are community knowledge, not captures). The
 * response bodies are therefore taken as `unknown` and never depended on: the companion re-reads
 * `GET /lol-lobby/v2/lobby` (verified) after each write and builds its result from that.
 *
 * `LOBBY_WRITE_VERIFICATION` is the per-kind gate the companion reads. It is flipped by hand, in the same
 * edit that turns the reference row green, and `writes.test.ts` refuses a `verified: true` whose row in
 * docs/03 is still `unverified`, so the flag can never run ahead of the doc.
 */

import type { LcuClient, LcuResponse } from './client.js';
import { WRITE_ENDPOINTS } from './endpoints.js';
import { JsonValueSchema } from './schemas.js';

export type LobbyWriteKind = 'create_lobby' | 'invite' | 'switch_side';

export type WriteVerification =
  | { readonly verified: false }
  | { readonly verified: true; readonly patch: string; readonly date: string };

/**
 * The gate. `verified: true` only after the companion's `--verify-commands` report has been pasted back and
 * the row in docs/03-lcu-reference.md ("Endpoints we use") reads `verified (<patch>, <date>)` for that kind.
 * While false, the companion answers `endpoint_unverified` for that kind and makes no client call.
 */
export const LOBBY_WRITE_VERIFICATION: Readonly<Record<LobbyWriteKind, WriteVerification>> = {
  create_lobby: { verified: false },
  invite: { verified: false },
  switch_side: { verified: false },
};

export function isLobbyWriteVerified(kind: LobbyWriteKind): boolean {
  return LOBBY_WRITE_VERIFICATION[kind].verified;
}

/** The reference row each kind depends on, for the log line that says what to verify. */
export const LOBBY_WRITE_REFERENCE_ROW: Readonly<Record<LobbyWriteKind, string>> = {
  create_lobby: 'Create custom lobby (POST /lol-lobby/v2/lobby)',
  invite: 'Invite (POST /lol-lobby/v2/lobby/invitations)',
  switch_side: 'Switch side (POST /lol-lobby/v1/lobby/custom/switch-teams)',
};

/** The whole allow-list. A POST to anything else throws. */
export const LOBBY_WRITE_PATHS: readonly string[] = [
  WRITE_ENDPOINTS.createLobby.path,
  WRITE_ENDPOINTS.invite.path,
  ...WRITE_ENDPOINTS.switchSideCandidates.map((candidate) => candidate.path),
];

export function isLobbyWritePath(path: string): boolean {
  return LOBBY_WRITE_PATHS.includes(path);
}

/** Throws for a path outside the allow-list. The only way out of this file to the client is through it. */
export function assertLobbyWritePath(path: string): void {
  if (!isLobbyWritePath(path)) {
    throw new Error(`refusing to POST outside the lobby allow-list: ${path}`);
  }
}

/** `customGameLobby.configuration.mutators.id` values as documented by the community. Unverified. */
export const CUSTOM_LOBBY_MUTATOR_ID = {
  blind: 1,
  draft: 2,
  allRandom: 4,
  tournamentDraft: 6,
} as const;

/** The lobby the group actually opens (16.17 capture: queue 3100, map 11, five a side, spectators allowed). */
export const CUSTOM_LOBBY_DEFAULTS = {
  gameMode: 'CLASSIC',
  mapId: 11,
  teamSize: 5,
  spectatorPolicy: 'AllAllowed',
  gameServerRegion: '',
} as const;

export interface CreateLobbyOptions {
  readonly lobbyName: string;
  readonly lobbyPassword: string;
  /** Default blind (`1`). */
  readonly mutatorId?: number;
}

/** The body of `POST /lol-lobby/v2/lobby`, exactly as docs/03-lcu-reference.md lists it. */
export function createLobbyBody(options: CreateLobbyOptions): Record<string, unknown> {
  return {
    customGameLobby: {
      configuration: {
        gameMode: CUSTOM_LOBBY_DEFAULTS.gameMode,
        mapId: CUSTOM_LOBBY_DEFAULTS.mapId,
        mutators: { id: options.mutatorId ?? CUSTOM_LOBBY_MUTATOR_ID.blind },
        spectatorPolicy: CUSTOM_LOBBY_DEFAULTS.spectatorPolicy,
        teamSize: CUSTOM_LOBBY_DEFAULTS.teamSize,
        gameServerRegion: CUSTOM_LOBBY_DEFAULTS.gameServerRegion,
      },
      lobbyName: options.lobbyName,
      lobbyPassword: options.lobbyPassword,
    },
    isCustom: true,
  };
}

export type InviteTarget =
  | { readonly method: 'summonerId'; readonly summonerId: number }
  | { readonly method: 'puuid'; readonly puuid: string };

/** The body of `POST /lol-lobby/v2/lobby/invitations`: a one-element array (reference, question 6). */
export function inviteBody(target: InviteTarget): readonly Record<string, unknown>[] {
  return target.method === 'summonerId' ? [{ toSummonerId: target.summonerId }] : [{ toPuuid: target.puuid }];
}

/** One write as it went over the wire, for the verify report and the fixture. */
export interface LobbyWrite {
  readonly method: 'POST';
  readonly path: string;
  /** Undefined when the request had no body (switch-teams). */
  readonly body: unknown;
  readonly response: LcuResponse<unknown>;
}

function post(client: LcuClient, path: string, body: unknown): Promise<LcuResponse<unknown>> {
  assertLobbyWritePath(path);
  return client.post(path, body, JsonValueSchema);
}

/** `POST /lol-lobby/v2/lobby`. The client replaces the current lobby, so callers check `GET lobby` first. */
export async function postCreateLobby(client: LcuClient, options: CreateLobbyOptions): Promise<LobbyWrite> {
  const path = WRITE_ENDPOINTS.createLobby.path;
  const body = createLobbyBody(options);
  return { method: 'POST', path, body, response: await post(client, path, body) };
}

/** `POST /lol-lobby/v2/lobby/invitations` for one target. Callers decide the summonerId-then-puuid order. */
export async function postInvite(client: LcuClient, target: InviteTarget): Promise<LobbyWrite> {
  const path = WRITE_ENDPOINTS.invite.path;
  const body = inviteBody(target);
  return { method: 'POST', path, body, response: await post(client, path, body) };
}

/**
 * Invites by `summonerId` when one is known, falling back to `puuid` on any 4xx (reference, question 6). Both
 * attempts are returned so the verify report can print them; `used` is the one whose answer counts.
 */
export async function inviteWithFallback(
  client: LcuClient,
  target: { readonly puuid: string; readonly summonerId: number | null },
): Promise<{ readonly used: InviteTarget; readonly attempts: readonly LobbyWrite[] }> {
  const attempts: LobbyWrite[] = [];
  if (target.summonerId !== null) {
    const bySummonerId: InviteTarget = { method: 'summonerId', summonerId: target.summonerId };
    const first = await postInvite(client, bySummonerId);
    attempts.push(first);
    const rejected = !first.response.ok && first.response.reason === 'http' && first.response.status < 500;
    if (!rejected) {
      return { used: bySummonerId, attempts };
    }
  }
  const byPuuid: InviteTarget = { method: 'puuid', puuid: target.puuid };
  attempts.push(await postInvite(client, byPuuid));
  return { used: byPuuid, attempts };
}

/**
 * `POST /lol-lobby/v1/lobby/custom/switch-teams` with no body; the v2 candidate when v1 answers 404. The
 * endpoint is a toggle (reference, question 5): callers read the lobby first and refuse when the local player
 * is already on the target side or that side is full.
 */
export async function postSwitchTeams(
  client: LcuClient,
): Promise<{ readonly used: LobbyWrite; readonly attempts: readonly LobbyWrite[] }> {
  const attempts: LobbyWrite[] = [];
  for (const candidate of WRITE_ENDPOINTS.switchSideCandidates) {
    const write: LobbyWrite = {
      method: 'POST',
      path: candidate.path,
      body: undefined,
      response: await post(client, candidate.path, undefined),
    };
    attempts.push(write);
    const missing = !write.response.ok && write.response.reason === 'http' && write.response.status === 404;
    if (!missing) {
      return { used: write, attempts };
    }
  }
  return { used: attempts[attempts.length - 1] as LobbyWrite, attempts };
}

/** `status` and, for an HTTP answer, the client's `message`, for a log line or a nack. Never a body. */
export function describeWriteResponse(response: LcuResponse<unknown>): string {
  if (response.ok) {
    return `${response.status}`;
  }
  switch (response.reason) {
    case 'http': {
      const json = response.json;
      const message =
        json && typeof json === 'object' && 'message' in json && typeof json.message === 'string'
          ? json.message
          : json && typeof json === 'object' && 'errorCode' in json && typeof json.errorCode === 'string'
            ? json.errorCode
            : '';
      return message.length > 0 ? `${response.status} ${message}` : `${response.status}`;
    }
    case 'network':
      return `no answer (${response.code ?? response.message})`;
    case 'malformed':
      return `${response.status} (body is not JSON)`;
    case 'schema':
      return `${response.status} (unexpected shape)`;
  }
}
