/**
 * `packages/lcu` is the only place in the repo that talks to the League client.
 * Lockfile discovery, the basic-auth HTTPS client, the WebSocket subscriber and the endpoint catalogue
 * live here. Nothing else may import `https`/`ws` or reach 127.0.0.1 (CLAUDE.md "Hard rules").
 *
 * Typed per-endpoint schemas arrive in M0.3 once fixtures exist; see `schemas.ts`.
 */

export { basicAuthHeader, buildUrl, httpBaseUrl, LCU_HOST, LCU_USER, wsBaseUrl } from './auth.js';
export {
  type HttpMethod,
  LcuClient,
  type LcuClientOptions,
  type LcuFailure,
  type LcuResponse,
  parseBody,
  type RawBody,
  type RawResponse,
} from './client.js';
export {
  canFill,
  fillPath,
  LIVE_CLIENT_DATA,
  type PathParam,
  READ_ENDPOINTS,
  type ReadEndpoint,
  WRITE_ENDPOINTS,
} from './endpoints.js';
export {
  diffTopLevelKeys,
  FIXTURES_DIR,
  type FixtureEnvelope,
  FixtureEnvelopeSchema,
  fixturePath,
  isShapeDiffEmpty,
  listPatchDirs,
  newestFixture,
  patchFromVersion,
  readFixture,
  type ShapeDiff,
} from './fixtures.js';
export {
  type DiscoverLockfileOptions,
  type DiscoverLockfileResult,
  defaultLockfileCandidates,
  discoverLockfile,
  type LockfileAttempt,
  type LockfileCredentials,
  LockfileCredentialsSchema,
  MACOS_LOCKFILE_PATH,
  type ParseLockfileResult,
  parseLockfile,
  WINDOWS_LOCKFILE_PATH,
} from './lockfile.js';
export { consoleLogger, type LogFields, type Logger, silentLogger, verboseConsoleLogger } from './log.js';
export {
  CurrentSummonerMinimalSchema,
  GameflowPhaseSchema,
  GameVersionSchema,
  JsonArraySchema,
  JsonObjectSchema,
  JsonValueSchema,
  KNOWN_GAMEFLOW_PHASES,
  MatchHistoryMinimalSchema,
  SystemBuildsSchema,
} from './schemas.js';
export {
  ALL_EVENTS_TOPIC,
  type FrameParseResult,
  type LcuEvent,
  LcuEventFrameSchema,
  type LcuEventType,
  LcuEventTypeSchema,
  LcuSocket,
  type LcuSocketCloseInfo,
  type LcuSocketDroppedFrame,
  type LcuSocketEvents,
  type LcuSocketOptions,
  parseFrame,
  subscribeMessage,
  topicForUri,
  unsubscribeMessage,
} from './socket.js';
export {
  DEFAULT_TLS_MODE,
  describeTlsMode,
  isTlsError,
  loadRiotRootCa,
  RIOT_ROOT_CA_PATH,
  type TlsConnectionOptions,
  type TlsMode,
  tlsConnectionOptions,
} from './tls.js';
