/**
 * The three lobby writes (M4.1): create a custom lobby, invite, switch side. This is the only file in the
 * repo that POSTs to the League client, and it can only POST to the paths in `LOBBY_WRITE_PATHS`: every call
 * goes through `post()` below, which throws for any other path. Create a lobby, invite, switch side. Nothing
 * else, ever (`CLAUDE.md` "Never automate gameplay").
 *
 * Every path here is `unverified` in docs/03-lcu-reference.md until a person runs the companion's
 * `--verify-commands` mode against a live client. The response bodies are therefore taken as `unknown` and
 * never depended on: the companion re-reads `GET /lol-lobby/v2/lobby` (verified) after each write and builds
 * its result from that.
 *
 * Where the request shapes come from (2026-09-10, after the first live run on 16.17 refused the community
 * body with `500 INVALID_LOBBY`):
 *  - the client's own lobby UI for 16.17, `rcp-fe-lol-parties` (extracted from the installed plugin bundle):
 *    `_generateCustomGamePayload` posts `{ customGameLobby: { configuration: { gameMode, gameMutator: "",
 *    gameServerRegion, mapId, mutators: { id }, spectatorPolicy, spectatorDelayEnabled, teamSize,
 *    hidePublicly, aramMapMutator }, lobbyName, hidePublicly, lobbyPassword }, queueId }` with
 *    `queueId === mutators.id` (its `getQueueId` is the identity) and `lobbyPassword: null` when empty; there
 *    is no `isCustom`. It invites with `[{ toSummonerId }]` and moves the local player with
 *    `POST /lol-lobby/v2/lobby/team/TEAM1|TEAM2` (no body). The mutator ids it offers come from
 *    `GET /lol-game-queues/v1/custom` (`subcategories[].mutators[]`);
 *  - the client's OpenAPI document for 16.17.812.4632 (`LolLobbyLobbyChangeGameDto` requires `queueId`;
 *    `LolLobbyLobbyCustomGameConfiguration` has both `mutators` and `gameTypeConfig`; no `switch-teams` path);
 *  - this Mac's `LeagueClient.log` for the lobby the user created from the UI on 2026-09-08: the party the
 *    server built was `queueId: 3100, gameTypeConfigId: 19, mapId: 11, allowSpectators: "ALL",
 *    gameCustomization: { aramMapMutator: "NONE", spectatorGridDelayEnabled: "true" }`.
 * None of that is a captured POST, so every body stays a **candidate** until the probe pins one.
 *
 * `LOBBY_WRITE_VERIFICATION` is the per-kind gate the companion reads. It is flipped by hand, in the same
 * edit that turns the reference row green, and `writes.test.ts` refuses a `verified: true` whose row in
 * docs/03 is still `unverified`, so the flag can never run ahead of the doc.
 */

import type { LcuClient, LcuResponse } from './client.js';
import { WRITE_ENDPOINTS } from './endpoints.js';
import {
  type CustomGameMutator,
  type CustomGameQueues,
  type CustomGameSubcategory,
  JsonValueSchema,
  type TeamId,
} from './schemas.js';

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
  switch_side: 'Switch side (POST /lol-lobby/v2/lobby/team/{team})',
};

/** The whole allow-list. A POST to anything else throws. */
export const LOBBY_WRITE_PATHS: readonly string[] = [
  WRITE_ENDPOINTS.createLobby.path,
  WRITE_ENDPOINTS.invite.path,
  WRITE_ENDPOINTS.switchSide.paths[100],
  WRITE_ENDPOINTS.switchSide.paths[200],
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

// --- create ------------------------------------------------------------------------------------------------

export type CustomLobbyMode = 'blind' | 'draft' | 'tournamentDraft' | 'allRandom';

/**
 * What a create body carries for the pick mode: the top-level `queueId` and `configuration.mutators.id`.
 * The client's dialog sends the same number for both (`getQueueId` is the identity), read from
 * `/lol-game-queues/v1/custom`; they are kept separate here because the candidates below also try the pair
 * the server reported for the user's own lobby (queue 3100, game-type config 19).
 */
export interface CustomLobbyIds {
  readonly queueId: number;
  readonly mutatorId: number;
}

/**
 * The ids with evidence behind them on 16.17, none of it a captured POST: the user's UI-created blind lobby
 * was queue `3100` ("SR Blind Pick Custom", `GET /lol-lobby/v2/lobby` fixture) with `gameTypeConfigId: 19`
 * (client log). Whether the dialog's mutator id for that lobby was 19 or 3100 is what the probe's first two
 * candidates tell apart. Draft has no evidence yet.
 */
export const KNOWN_CUSTOM_LOBBY_IDS = {
  blindQueueId: 3100,
  blindGameTypeConfigId: 19,
} as const;

/**
 * The `mutators.id` values the community docs list (blind 1, draft 2, all random 4, tournament draft 6).
 * **Refused on 16.17**: `500 INVALID_LOBBY` for 1 and 2 on 2026-09-09 (`create-lobby--legacy-blind.json`,
 * `create-lobby--legacy-draft.json`). Kept only for the last-resort candidate and for the record.
 */
export const LEGACY_CUSTOM_LOBBY_MUTATOR_ID = {
  blind: 1,
  draft: 2,
  allRandom: 4,
  tournamentDraft: 6,
} as const;

/** The lobby the group actually opens: Summoner's Rift, five a side, spectators allowed, no region pin. */
export const CUSTOM_LOBBY_DEFAULTS = {
  gameMode: 'CLASSIC',
  mapId: 11,
  teamSize: 5,
  spectatorPolicy: 'AllAllowed',
  gameServerRegion: '',
  /** The dialog's default is "AddDelay"; the user's own lobby had `spectatorGridDelayEnabled: "true"`. */
  spectatorDelayEnabled: true,
  hidePublicly: false,
  aramMapMutator: 'NONE',
} as const;

export interface CreateLobbyOptions {
  readonly lobbyName: string;
  /** Sent as `null` when empty, which is what the client's dialog does. */
  readonly lobbyPassword: string;
  readonly ids: CustomLobbyIds;
  readonly gameMode?: string;
  readonly mapId?: number;
  readonly teamSize?: number;
}

/**
 * Which shape a create body takes. `ui` is the client's own dialog on 16.17; the other two are fallbacks
 * the probe tries only after every `ui` candidate was refused.
 */
export type CreateLobbyVariant = 'ui' | 'dto-full' | 'legacy-queue';

/** The body of `POST /lol-lobby/v2/lobby` exactly as the 16.17 client's Create Custom dialog sends it. */
export function createLobbyBody(options: CreateLobbyOptions): Record<string, unknown> {
  return createLobbyBodyVariant('ui', options);
}

function passwordField(password: string): string | null {
  return password === '' ? null : password;
}

/** One of the three body shapes for the same lobby. Key order follows the source each shape was read from. */
export function createLobbyBodyVariant(
  variant: CreateLobbyVariant,
  options: CreateLobbyOptions,
): Record<string, unknown> {
  const gameMode = options.gameMode ?? CUSTOM_LOBBY_DEFAULTS.gameMode;
  const mapId = options.mapId ?? CUSTOM_LOBBY_DEFAULTS.mapId;
  const teamSize = options.teamSize ?? CUSTOM_LOBBY_DEFAULTS.teamSize;
  switch (variant) {
    case 'ui':
      return {
        customGameLobby: {
          configuration: {
            gameMode,
            gameMutator: '',
            gameServerRegion: CUSTOM_LOBBY_DEFAULTS.gameServerRegion,
            mapId,
            mutators: { id: options.ids.mutatorId },
            spectatorPolicy: CUSTOM_LOBBY_DEFAULTS.spectatorPolicy,
            spectatorDelayEnabled: CUSTOM_LOBBY_DEFAULTS.spectatorDelayEnabled,
            teamSize,
            hidePublicly: CUSTOM_LOBBY_DEFAULTS.hidePublicly,
            aramMapMutator: CUSTOM_LOBBY_DEFAULTS.aramMapMutator,
          },
          lobbyName: options.lobbyName,
          hidePublicly: CUSTOM_LOBBY_DEFAULTS.hidePublicly,
          lobbyPassword: passwordField(options.lobbyPassword),
        },
        queueId: options.ids.queueId,
      };
    case 'dto-full':
      // Every field of LolLobbyLobbyCustomGameConfiguration (16.17 schema), both game-type keys set.
      return {
        queueId: options.ids.queueId,
        customGameLobby: {
          lobbyName: options.lobbyName,
          lobbyPassword: options.lobbyPassword,
          configuration: {
            mapId,
            gameMode,
            mutators: { id: options.ids.mutatorId },
            gameTypeConfig: { id: options.ids.mutatorId },
            spectatorPolicy: CUSTOM_LOBBY_DEFAULTS.spectatorPolicy,
            teamSize,
            maxPlayerCount: teamSize * 2,
            tournamentGameMode: '',
            tournamentPassbackUrl: '',
            tournamentPassbackDataPacket: '',
            gameServerRegion: CUSTOM_LOBBY_DEFAULTS.gameServerRegion,
            spectatorDelayEnabled: CUSTOM_LOBBY_DEFAULTS.spectatorDelayEnabled,
            hidePublicly: CUSTOM_LOBBY_DEFAULTS.hidePublicly,
            aramMapMutator: CUSTOM_LOBBY_DEFAULTS.aramMapMutator,
          },
        },
        gameCustomization: {},
      };
    case 'legacy-queue':
      // The community body that was refused on 2026-09-09, plus the DTO's required queueId.
      return {
        customGameLobby: {
          configuration: {
            gameMode,
            mapId,
            mutators: { id: options.ids.mutatorId },
            spectatorPolicy: CUSTOM_LOBBY_DEFAULTS.spectatorPolicy,
            teamSize,
            gameServerRegion: CUSTOM_LOBBY_DEFAULTS.gameServerRegion,
          },
          lobbyName: options.lobbyName,
          lobbyPassword: options.lobbyPassword,
        },
        isCustom: true,
        queueId: options.ids.queueId,
      };
  }
}

/** One create body the probe will try, with the evidence that ranks it. */
export interface CreateLobbyCandidate {
  /** Fixture suffix: `create-lobby--<id>.json`. */
  readonly id: string;
  readonly variant: CreateLobbyVariant;
  readonly ids: CustomLobbyIds;
  readonly evidence: string;
  readonly body: Record<string, unknown>;
}

export interface CreateLobbyCandidateOptions {
  readonly lobbyName: string;
  readonly lobbyPassword: string;
  /** The ids read from `/lol-game-queues/v1/custom` for the mode wanted, when that read worked. */
  readonly live: CustomLobbyIds | null;
}

/**
 * The bodies `verify-commands` tries for the create, best evidence first, stopping at the first 2xx.
 * Identical bodies (a live read that lands on the known pair) are listed once.
 */
export function createLobbyCandidates(options: CreateLobbyCandidateOptions): readonly CreateLobbyCandidate[] {
  const { blindQueueId, blindGameTypeConfigId } = KNOWN_CUSTOM_LOBBY_IDS;
  const build = (
    id: string,
    variant: CreateLobbyVariant,
    ids: CustomLobbyIds,
    evidence: string,
  ): CreateLobbyCandidate => ({
    id,
    variant,
    ids,
    evidence,
    body: createLobbyBodyVariant(variant, {
      lobbyName: options.lobbyName,
      lobbyPassword: options.lobbyPassword,
      ids,
    }),
  });
  const list: CreateLobbyCandidate[] = [];
  if (options.live !== null) {
    list.push(
      build(
        `ui-live-${options.live.mutatorId}`,
        'ui',
        options.live,
        "the 16.17 client's own dialog body with the mutator id it lists in /lol-game-queues/v1/custom (queueId = mutators.id, as the UI does)",
      ),
    );
  }
  list.push(
    build(
      `ui-${blindQueueId}-${blindGameTypeConfigId}`,
      'ui',
      { queueId: blindQueueId, mutatorId: blindGameTypeConfigId },
      "the client's dialog body with the pair the server reported for the user's own 2026-09-08 lobby: queueId 3100, gameTypeConfigId 19",
    ),
    build(
      `ui-${blindQueueId}-${blindQueueId}`,
      'ui',
      { queueId: blindQueueId, mutatorId: blindQueueId },
      "the client's dialog body with queueId = mutators.id = 3100 (the dialog sends one number for both; 3100 is the queue the verified lobby fixture carries)",
    ),
    build(
      `dto-full-${blindQueueId}-${blindGameTypeConfigId}`,
      'dto-full',
      { queueId: blindQueueId, mutatorId: blindGameTypeConfigId },
      'every field of LolLobbyLobbyCustomGameConfiguration from the 16.17 schema, mutators and gameTypeConfig both 19, queueId 3100 (the shape a 2026-03 community tool moved to)',
    ),
    build(
      `legacy-queue-${blindQueueId}`,
      'legacy-queue',
      { queueId: blindQueueId, mutatorId: LEGACY_CUSTOM_LOBBY_MUTATOR_ID.blind },
      'the community body refused on 2026-09-09 (mutators.id 1, isCustom) plus the queueId the DTO requires; last resort',
    ),
  );
  const seen = new Set<string>();
  return list.filter((candidate) => {
    const key = JSON.stringify(candidate.body);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/** Summoner's Rift, classic: the subcategory the group's lobby is created in. Null when the dialog has none. */
export function summonersRiftSubcategory(config: CustomGameQueues): CustomGameSubcategory | null {
  return (
    config.subcategories.find(
      (entry) =>
        entry.mapId === CUSTOM_LOBBY_DEFAULTS.mapId && entry.gameMode === CUSTOM_LOBBY_DEFAULTS.gameMode,
    ) ?? null
  );
}

const MODE_WORDS: Readonly<Record<CustomLobbyMode, (text: string) => boolean>> = {
  blind: (text) => text.includes('BLIND') || text.includes('SIMUL'),
  draft: (text) => text.includes('DRAFT') && !text.includes('TOURNAMENT'),
  tournamentDraft: (text) => text.includes('TOURNAMENT'),
  allRandom: (text) => text.includes('RANDOM'),
};

function mutatorText(mutator: CustomGameMutator): string {
  return `${mutator.name ?? ''} ${mutator.pickMode ?? ''} ${mutator.banMode ?? ''}`.toUpperCase();
}

/**
 * The dialog entry for a pick mode, by its name/pickMode words (`GAME_CFG_..._DRAFT`, `SimulPickStrategy`,
 * `AllRandomPickStrategy`, ...). When the words are empty, as they were for the client's own blind config
 * (id 19, queue 3100), blind falls back to that known id; every other mode is null: nothing here guesses.
 */
export function chooseCustomLobbyMutator(
  subcategory: CustomGameSubcategory,
  mode: CustomLobbyMode,
): CustomGameMutator | null {
  const byWords = subcategory.mutators.find((mutator) => MODE_WORDS[mode](mutatorText(mutator)));
  if (byWords !== undefined) {
    return byWords;
  }
  if (mode === 'blind') {
    const known = subcategory.mutators.find(
      (mutator) =>
        mutator.id === KNOWN_CUSTOM_LOBBY_IDS.blindGameTypeConfigId ||
        mutator.id === KNOWN_CUSTOM_LOBBY_IDS.blindQueueId,
    );
    if (known !== undefined) {
      return known;
    }
  }
  return null;
}

/** The ids the dialog would send for a mode: its mutator id for both fields. Null when it cannot be told. */
export function customLobbyIdsFor(config: CustomGameQueues, mode: CustomLobbyMode): CustomLobbyIds | null {
  const subcategory = summonersRiftSubcategory(config);
  if (subcategory === null) {
    return null;
  }
  const mutator = chooseCustomLobbyMutator(subcategory, mode);
  return mutator === null ? null : { queueId: mutator.id, mutatorId: mutator.id };
}

/** One line per dialog entry, for the verify report and a log: `id name/pickMode/banMode`. Never a secret. */
export function describeMutators(subcategory: CustomGameSubcategory): string {
  return subcategory.mutators
    .map(
      (mutator) =>
        `${mutator.id}${mutator.name ? ` ${mutator.name}` : ''}${mutator.pickMode ? ` pick=${mutator.pickMode}` : ''}${mutator.banMode ? ` ban=${mutator.banMode}` : ''}`,
    )
    .join(', ');
}

// --- invite ------------------------------------------------------------------------------------------------

export type InviteTarget =
  | { readonly method: 'summonerId'; readonly summonerId: number }
  | { readonly method: 'puuid'; readonly puuid: string };

/**
 * The body of `POST /lol-lobby/v2/lobby/invitations`: a one-element array. `[{ toSummonerId }]` is what the
 * 16.17 client's own UI sends (`invitePlayer`); `[{ toPuuid }]` is the fallback (both keys exist on
 * `LolLobbyLobbyInvitationDto`).
 */
export function inviteBody(target: InviteTarget): readonly Record<string, unknown>[] {
  return target.method === 'summonerId' ? [{ toSummonerId: target.summonerId }] : [{ toPuuid: target.puuid }];
}

// --- the wire ----------------------------------------------------------------------------------------------

/** One write as it went over the wire, for the verify report and the fixture. */
export interface LobbyWrite {
  readonly method: 'POST';
  readonly path: string;
  /** Undefined when the request had no body (the side switch). */
  readonly body: unknown;
  readonly response: LcuResponse<unknown>;
}

function post(client: LcuClient, path: string, body: unknown): Promise<LcuResponse<unknown>> {
  assertLobbyWritePath(path);
  return client.post(path, body, JsonValueSchema);
}

/** `POST /lol-lobby/v2/lobby` with the dialog's body. The client replaces the current lobby, so callers check `GET lobby` first. */
export async function postCreateLobby(client: LcuClient, options: CreateLobbyOptions): Promise<LobbyWrite> {
  const path = WRITE_ENDPOINTS.createLobby.path;
  const body = createLobbyBody(options);
  return { method: 'POST', path, body, response: await post(client, path, body) };
}

export interface CreateLobbyAttempt {
  readonly candidate: CreateLobbyCandidate;
  readonly write: LobbyWrite;
}

/**
 * The probe's create: every candidate in order until one answers 2xx. A dead client (no HTTP answer) stops
 * the loop too: that is not "wrong body". `accepted` is the attempt that answered 2xx, if any.
 */
export async function postCreateLobbyCandidates(
  client: LcuClient,
  candidates: readonly CreateLobbyCandidate[],
  onAttempt?: (attempt: CreateLobbyAttempt) => void | Promise<void>,
): Promise<{
  readonly accepted: CreateLobbyAttempt | null;
  readonly attempts: readonly CreateLobbyAttempt[];
}> {
  const path = WRITE_ENDPOINTS.createLobby.path;
  const attempts: CreateLobbyAttempt[] = [];
  for (const candidate of candidates) {
    const write: LobbyWrite = {
      method: 'POST',
      path,
      body: candidate.body,
      response: await post(client, path, candidate.body),
    };
    const attempt: CreateLobbyAttempt = { candidate, write };
    attempts.push(attempt);
    await onAttempt?.(attempt);
    if (write.response.ok) {
      return { accepted: attempt, attempts };
    }
    if (write.response.reason === 'network') {
      return { accepted: null, attempts };
    }
  }
  return { accepted: null, attempts };
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

/** `/lol-lobby/v2/lobby/team/TEAM1` for 100, `/TEAM2` for 200: the side the local player moves to. */
export function switchSidePath(side: TeamId): string {
  return WRITE_ENDPOINTS.switchSide.paths[side];
}

/**
 * `POST /lol-lobby/v2/lobby/team/TEAM1|TEAM2` with no body: not a toggle, the target side is in the path.
 * Callers read the lobby first and refuse when the local player is already there, when that side holds
 * five, or when the local player is a spectator; and read it again after, because the answer body is unknown.
 */
export async function postSwitchSide(client: LcuClient, side: TeamId): Promise<LobbyWrite> {
  const path = switchSidePath(side);
  return { method: 'POST', path, body: undefined, response: await post(client, path, undefined) };
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
