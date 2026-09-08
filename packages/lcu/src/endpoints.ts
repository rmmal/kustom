/**
 * The endpoint catalogue: every client path this project touches, in one place.
 *
 * Mirrors the "Endpoints we use" table in docs/03-lcu-reference.md. The smoke script walks
 * `READ_ENDPOINTS`; the write paths are listed so nothing else in the repo spells a client path.
 *
 * Path templates use `{puuid}`, `{gameName}`, `{tagLine}` and `{gameId}`; `fillPath` substitutes them
 * with URL-encoded values.
 */

export type PathParam = 'puuid' | 'gameName' | 'tagLine' | 'gameId';

export interface ReadEndpoint {
  /** Fixture file name (`fixtures/<patch>/<id>.json`) and table label. */
  readonly id: string;
  readonly purpose: string;
  /** Template path. Always GET. */
  readonly path: string;
  /** Template parameters that must be known before this endpoint can be hit. */
  readonly params: readonly PathParam[];
  /** Statuses that are normal when the client is idle (no lobby, not in a game). */
  readonly idleStatuses: readonly number[];
  /** True for the client's own OpenAPI documents, which may not be served at all. */
  readonly optional?: boolean;
}

export const READ_ENDPOINTS: readonly ReadEndpoint[] = [
  {
    id: 'game-version',
    purpose: 'Client patch version (fixture directory name)',
    path: '/lol-patch/v1/game-version',
    params: [],
    idleStatuses: [200],
  },
  {
    id: 'system-builds',
    purpose: 'Build info; fallback source for the version',
    path: '/system/v1/builds',
    params: [],
    idleStatuses: [200],
  },
  {
    id: 'current-summoner',
    purpose: 'Local player: puuid, summonerId, gameName, tagLine',
    path: '/lol-summoner/v1/current-summoner',
    params: [],
    idleStatuses: [200],
  },
  {
    id: 'alias-lookup',
    purpose: 'Riot ID -> puuid (probed with the local player)',
    path: '/lol-summoner/v1/alias/lookup?gameName={gameName}&tagLine={tagLine}',
    params: ['gameName', 'tagLine'],
    idleStatuses: [200],
  },
  {
    id: 'summoner-by-puuid',
    purpose: 'puuid -> summonerId (invites need it)',
    path: '/lol-summoner/v2/summoners/puuid/{puuid}',
    params: ['puuid'],
    idleStatuses: [200],
  },
  {
    id: 'current-ranked-stats',
    purpose: 'Own rank',
    path: '/lol-ranked/v1/current-ranked-stats',
    params: [],
    idleStatuses: [200],
  },
  {
    id: 'ranked-stats-by-puuid',
    purpose: 'Rank of a player by puuid',
    path: '/lol-ranked/v1/ranked-stats/{puuid}',
    params: ['puuid'],
    idleStatuses: [200],
  },
  {
    id: 'gameflow-phase',
    purpose: 'Gameflow phase',
    path: '/lol-gameflow/v1/gameflow-phase',
    params: [],
    idleStatuses: [200],
  },
  {
    id: 'gameflow-session',
    purpose: 'Gameflow session (gameId before end of game)',
    path: '/lol-gameflow/v1/session',
    params: [],
    idleStatuses: [200, 404],
  },
  {
    id: 'lobby',
    purpose: 'Current lobby (404 when not in one)',
    path: '/lol-lobby/v2/lobby',
    params: [],
    idleStatuses: [404],
  },
  {
    id: 'eog-stats-block',
    purpose: 'End of game stats (only during EndOfGame)',
    path: '/lol-end-of-game/v1/eog-stats-block',
    params: [],
    idleStatuses: [404],
  },
  {
    id: 'match-history',
    purpose: 'Match history list for a puuid',
    path: '/lol-match-history/v1/products/lol/{puuid}/matches?begIndex=0&endIndex=20',
    params: ['puuid'],
    idleStatuses: [200],
  },
  {
    id: 'match-detail',
    purpose: 'Match detail by gameId (first game from the history list)',
    path: '/lol-match-history/v1/games/{gameId}',
    params: ['gameId'],
    idleStatuses: [200],
  },
  {
    id: 'swagger-v2',
    purpose: "The client's own OpenAPI v2 document, when enabled",
    path: '/swagger/v2/swagger.json',
    params: [],
    idleStatuses: [200, 404],
    optional: true,
  },
  {
    id: 'openapi-v3',
    purpose: "The client's own OpenAPI v3 document, when enabled",
    path: '/swagger/v3/openapi.json',
    params: [],
    idleStatuses: [200, 404],
    optional: true,
  },
];

/**
 * The in-game live data server. A different process on a fixed port, no auth, only while a game runs.
 * Not needed unless end-of-game capture proves unreliable (docs/03-lcu-reference.md).
 */
export const LIVE_CLIENT_DATA = {
  id: 'live-client-data',
  port: 2999,
  path: '/liveclientdata/allgamedata',
} as const;

/**
 * Lobby automation paths (M4). Listed, not called, in M0.1. Every one is `unverified`; the switch-side path in
 * particular has two candidates in the wild.
 */
export const WRITE_ENDPOINTS = {
  createLobby: { method: 'POST', path: '/lol-lobby/v2/lobby' },
  invite: { method: 'POST', path: '/lol-lobby/v2/lobby/invitations' },
  switchSideCandidates: [
    { method: 'POST', path: '/lol-lobby/v1/lobby/custom/switch-teams' },
    { method: 'POST', path: '/lol-lobby/v2/lobby/custom/switch-teams' },
  ],
} as const;

/** Substitutes `{param}` placeholders. Values are URL-encoded. Missing values are left as-is. */
export function fillPath(template: string, values: Partial<Record<PathParam, string>>): string {
  return template.replace(/\{(puuid|gameName|tagLine|gameId)\}/g, (match, name: PathParam) => {
    const value = values[name];
    return value === undefined ? match : encodeURIComponent(value);
  });
}

/** True when every template parameter has a value. */
export function canFill(endpoint: ReadEndpoint, values: Partial<Record<PathParam, string>>): boolean {
  return endpoint.params.every((param) => values[param] !== undefined);
}
