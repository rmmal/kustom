/**
 * `--verify-commands` (M4.1): the human-run, live verification of the three lobby writes, and the **only**
 * code allowed to POST to the League client while their rows in docs/03-lcu-reference.md are `unverified`.
 *
 * Run with the client up, in no lobby (or a lobby you are happy to replace), and one friend online:
 *  1. create — `POST /lol-lobby/v2/lobby` with the reference body (blind, `customs-verify`, `1234`);
 *     optionally again with `mutators.id: 2` to learn which number is draft;
 *  2. invite — the friend's Riot ID -> puuid -> summonerId (verified GETs), then
 *     `POST /lol-lobby/v2/lobby/invitations` with `[{ toSummonerId }]`, and `[{ toPuuid }]` on any 4xx;
 *  3. switch — `POST /lol-lobby/v1/lobby/custom/switch-teams` with no body, the v2 path on a 404; then,
 *     optionally, the same POST against a full target side.
 *
 * It prompts before every probe, prints each request, status and body shape, saves each answer as a fixture
 * (`packages/lcu/fixtures/<patch>/` when run from the repo, else `<configDir>/fixtures/<patch>/`) scrubbed
 * like every other fixture, and writes `<configDir>/verify-commands-<patch>-<date>.txt` for the person to paste
 * back. It makes no API call, needs no token, and every POST goes through `@customs/lcu`'s allow-list.
 * The engineer then writes the rows and flips `LOBBY_WRITE_VERIFICATION`; nothing here flips anything.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AliasLookupSchema,
  CUSTOM_LOBBY_MUTATOR_ID,
  describeWriteResponse,
  discoverLockfile,
  FIXTURES_DIR,
  type FixtureEnvelope,
  fillPath,
  GameflowPhaseSchema,
  GameVersionSchema,
  LcuClient,
  type Lobby,
  LobbySchema,
  type LobbyWrite,
  type LockfileDiscoveryOptions,
  patchFromVersion,
  postCreateLobby,
  postInvite,
  postSwitchTeams,
  readEndpoint,
  SummonerSchema,
  scrubValue,
  type TlsMode,
  writeFixture,
} from '@customs/lcu';
import { ACTIONABLE_PHASES, sideOf } from './commandRunner.js';
import type { PromptIo } from './config.js';

export const VERIFY_LOBBY_NAME = 'customs-verify';
export const VERIFY_LOBBY_PASSWORD = '1234';
export const VERIFY_REPORT_PREFIX = 'verify-commands-';

const VERSION_PATH = readEndpoint('game-version').path;
const CURRENT_SUMMONER_PATH = readEndpoint('current-summoner').path;
const GAMEFLOW_PHASE_PATH = readEndpoint('gameflow-phase').path;
const LOBBY_PATH = readEndpoint('lobby').path;
const ALIAS_LOOKUP_PATH = readEndpoint('alias-lookup').path;
const SUMMONER_BY_PUUID_PATH = readEndpoint('summoner-by-puuid').path;

export interface VerifyCommandsOptions {
  readonly configDir: string;
  readonly io: PromptIo;
  /** A non-default League install (config.json `lockfilePath`). */
  readonly lockfilePath?: string;
  /** Tests: discovery candidates. */
  readonly lockfile?: LockfileDiscoveryOptions;
  /** Tests: pin to the fake client. Default: Riot's root. */
  readonly tls?: TlsMode;
  /** Where fixtures go. Default: the repo's `packages/lcu/fixtures` when present, else `<configDir>/fixtures`. */
  readonly fixturesDir?: string;
  readonly now?: () => Date;
}

/** `{ a, b, c }` for an object, `[n × { ... }]` for an array, else the JSON type. Never a value. */
export function shapeOf(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? '[]' : `[${value.length} × ${shapeOf(value[0])}]`;
  }
  if (typeof value === 'object') {
    return `{ ${Object.keys(value as object).join(', ')} }`;
  }
  return typeof value;
}

/** Where the fixtures go: the repo when this runs from it, the config directory when packaged. */
export function resolveFixturesDir(configDir: string, override?: string): string {
  if (override) {
    return override;
  }
  return existsSync(FIXTURES_DIR) ? FIXTURES_DIR : join(configDir, 'fixtures');
}

export function reportPath(configDir: string, patch: string, date: string): string {
  return join(configDir, `${VERIFY_REPORT_PREFIX}${patch}-${date}.txt`);
}

class Report {
  readonly lines: string[] = [];
  constructor(private readonly io: PromptIo) {}

  say(line = ''): void {
    this.lines.push(line);
    this.io.say(line);
  }
}

function summariseLobby(lobby: Lobby, localPuuid: string): string {
  const names = (members: readonly { puuid: string; isBot: boolean }[]): string =>
    members
      .map((member) => (member.isBot ? 'bot' : member.puuid === localPuuid ? 'me' : member.puuid.slice(0, 8)))
      .join(', ');
  return [
    `partyId=${lobby.partyId}`,
    `queueId=${lobby.gameConfig.queueId}`,
    `isCustom=${lobby.gameConfig.isCustom}`,
    `customMutatorName=${lobby.gameConfig.customMutatorName ?? '(absent)'}`,
    `customLobbyName=${lobby.gameConfig.customLobbyName ?? '(absent)'}`,
    `team100=[${names(lobby.gameConfig.customTeam100)}]`,
    `team200=[${names(lobby.gameConfig.customTeam200)}]`,
    `spectators=[${names(lobby.gameConfig.customSpectators ?? [])}]`,
    `localSide=${sideOf(lobby, localPuuid) ?? 'none'}`,
  ].join(' ');
}

export async function runVerifyCommands(options: VerifyCommandsOptions): Promise<number> {
  const { io } = options;
  const now = options.now ?? (() => new Date());
  const report = new Report(io);
  const date = now().toISOString().slice(0, 10);
  const fixturesDir = resolveFixturesDir(options.configDir, options.fixturesDir);
  const written: string[] = [];

  report.say(`verify-commands ${date}: the M4.1 live verification of the three lobby writes.`);
  report.say(
    'It POSTs only to /lol-lobby/v2/lobby, /lol-lobby/v2/lobby/invitations and the two switch-teams paths,',
  );
  report.say('prompts before each one, and never touches champion select, matchmaking or a game.');
  report.say('Answer Enter to run a probe, s to skip it. Nothing here talks to the Kustom API.');
  report.say();

  const discovered = await discoverLockfile({
    ...(options.lockfilePath ? { overridePath: options.lockfilePath } : {}),
    ...options.lockfile,
  });
  if (discovered.status !== 'found') {
    report.say('League client not running: no lockfile at');
    for (const attempt of discovered.tried) {
      report.say(`  ${attempt.path} (${attempt.reason})`);
    }
    return 2;
  }
  const client = LcuClient.fromCredentials(discovered.credentials, {
    timeoutMs: 10_000,
    ...(options.tls ? { tls: options.tls } : {}),
  });
  try {
    const version = await client.get(VERSION_PATH, GameVersionSchema);
    if (!version.ok) {
      report.say(
        `lockfile found but the client did not answer ${VERSION_PATH}: ${describeWriteResponse(version)}`,
      );
      return 3;
    }
    const patch = patchFromVersion(version.json) ?? `unknown-${date}`;
    report.say(
      `client version ${version.json} -> patch ${patch}; fixtures go to ${join(fixturesDir, patch)}`,
    );

    const me = await client.get(CURRENT_SUMMONER_PATH, SummonerSchema);
    if (!me.ok) {
      report.say(`current-summoner did not answer (${describeWriteResponse(me)}); cannot tell who is local.`);
      return 3;
    }
    const localPuuid = me.json.puuid;
    report.say(`local player ${me.json.gameName}#${me.json.tagLine} (summonerId ${me.json.summonerId})`);

    const phase = await client.get(GAMEFLOW_PHASE_PATH, GameflowPhaseSchema);
    if (!phase.ok || !ACTIONABLE_PHASES.includes(phase.json)) {
      report.say(
        `gameflow phase is ${phase.ok ? phase.json : describeWriteResponse(phase)}; leave champion select or the game first (None or Lobby needed).`,
      );
      return 4;
    }
    report.say(`gameflow phase ${phase.json}`);
    report.say();

    const save = (id: string, write: LobbyWrite, note?: string): void => {
      const { response } = write;
      if (!response.ok && response.reason === 'network') {
        report.say(`  (no fixture for ${id}: the client gave no HTTP answer)`);
        return;
      }
      const base = {
        id,
        method: write.method,
        path: write.path,
        status: response.status,
        capturedAt: now().toISOString(),
        patch,
        clientVersion: version.json,
        contentType: null,
        ...(write.body === undefined ? {} : { request: scrubValue(write.body) }),
        ...(note ? { note } : {}),
      };
      const envelope: FixtureEnvelope =
        !response.ok && response.reason === 'malformed'
          ? { ...base, bodyText: response.text.slice(0, 4000) }
          : { ...base, body: scrubValue(response.json) };
      const path = writeFixture(envelope, fixturesDir);
      written.push(path);
      report.say(`  fixture: ${path}`);
    };

    const describe = (label: string, write: LobbyWrite): void => {
      report.say(`  ${label}: ${write.method} ${write.path}`);
      if (write.body !== undefined) {
        report.say(`  request: ${JSON.stringify(write.body)}`);
      }
      const { response } = write;
      report.say(`  answer: ${describeWriteResponse(response)}`);
      if (response.ok) {
        report.say(`  body shape: ${shapeOf(response.json)}`);
      } else if (response.reason === 'http') {
        report.say(`  body shape: ${shapeOf(response.json)}`);
      }
    };

    const readLobby = async (): Promise<Lobby | null> => {
      const result = await client.get(LOBBY_PATH, LobbySchema);
      if (result.ok) {
        report.say(`  GET ${LOBBY_PATH} -> 200 ${summariseLobby(result.json, localPuuid)}`);
        return result.json;
      }
      report.say(`  GET ${LOBBY_PATH} -> ${describeWriteResponse(result)}`);
      return null;
    };

    const wants = async (question: string): Promise<boolean> => {
      const answer = (await io.ask(`${question} [Enter = yes, s = skip] `)).trim().toLowerCase();
      return answer !== 's' && answer !== 'n' && answer !== 'no' && answer !== 'skip';
    };
    const optIn = async (question: string): Promise<boolean> => {
      const answer = (await io.ask(`${question} [y/N] `)).trim().toLowerCase();
      return answer === 'y' || answer === 'yes';
    };

    // --- 1. create ---------------------------------------------------------------------------------------
    report.say('1. Create custom lobby');
    const existing = await readLobby();
    let runCreate = true;
    if (existing !== null) {
      runCreate = await optIn(
        `  You are already in a lobby (${existing.partyId}). Creating one REPLACES it. Create anyway?`,
      );
    } else {
      runCreate = await wants(
        `  POST ${'/lol-lobby/v2/lobby'} (blind, mutators.id ${CUSTOM_LOBBY_MUTATOR_ID.blind}, name ${VERIFY_LOBBY_NAME}, password ${VERIFY_LOBBY_PASSWORD})?`,
      );
    }
    if (runCreate) {
      const write = await postCreateLobby(client, {
        lobbyName: VERIFY_LOBBY_NAME,
        lobbyPassword: VERIFY_LOBBY_PASSWORD,
        mutatorId: CUSTOM_LOBBY_MUTATOR_ID.blind,
      });
      describe('create (blind)', write);
      save('create-lobby', write, 'mutators.id 1; --verify-commands');
      const after = await readLobby();
      if (after !== null) {
        const shown = (
          await io.ask('  Does the client lobby screen show the password 1234? [y/n/?] ')
        ).trim();
        report.say(`  password visible in the client: ${shown || '?'}`);
      }
      if (await optIn('  Also probe draft (mutators.id 2)? This replaces the lobby again.')) {
        const draft = await postCreateLobby(client, {
          lobbyName: VERIFY_LOBBY_NAME,
          lobbyPassword: VERIFY_LOBBY_PASSWORD,
          mutatorId: CUSTOM_LOBBY_MUTATOR_ID.draft,
        });
        describe('create (draft)', draft);
        save('create-lobby--draft', draft, 'mutators.id 2; --verify-commands');
        await readLobby();
      }
    } else {
      report.say('  skipped');
    }
    report.say();

    // --- 2. invite ---------------------------------------------------------------------------------------
    report.say('2. Invite');
    const riotId = (await io.ask("  Friend's Riot ID (Name#TAG), or Enter to skip: ")).trim();
    const [gameName, tagLine] = riotId.split('#');
    if (gameName && tagLine) {
      const alias = await client.get(fillPath(ALIAS_LOOKUP_PATH, { gameName, tagLine }), AliasLookupSchema);
      if (!alias.ok) {
        report.say(`  alias lookup failed (${describeWriteResponse(alias)}); invite skipped`);
      } else {
        const friendPuuid = alias.json.puuid;
        const friend = await client.get(
          fillPath(SUMMONER_BY_PUUID_PATH, { puuid: friendPuuid }),
          SummonerSchema,
        );
        const summonerId = friend.ok ? friend.json.summonerId : null;
        report.say(`  friend puuid ${friendPuuid}, summonerId ${summonerId ?? '(lookup failed)'}`);
        if (
          summonerId !== null &&
          (await wants(`  POST /lol-lobby/v2/lobby/invitations with [{ toSummonerId: ${summonerId} }]?`))
        ) {
          const first = await postInvite(client, { method: 'summonerId', summonerId });
          describe('invite (toSummonerId)', first);
          save('lobby-invitations', first, '[{ toSummonerId }]; --verify-commands');
          const rejected =
            !first.response.ok && first.response.reason === 'http' && first.response.status < 500;
          if (rejected && (await wants('  4xx. Retry with [{ toPuuid }]?'))) {
            const second = await postInvite(client, { method: 'puuid', puuid: friendPuuid });
            describe('invite (toPuuid)', second);
            save('lobby-invitations--by-puuid', second, '[{ toPuuid }] after a 4xx; --verify-commands');
          }
          const lobby = await readLobby();
          const row = lobby?.invitations?.find((invitation) => invitation.toPuuid === friendPuuid);
          const member = lobby?.members.some((entry) => entry.puuid === friendPuuid) ?? false;
          report.say(
            `  invitations[] row for the friend: ${row ? JSON.stringify(row) : '(none)'}; member: ${member}`,
          );
        } else if (
          summonerId === null &&
          (await wants('  No summonerId. POST with [{ toPuuid }] instead?'))
        ) {
          const only = await postInvite(client, { method: 'puuid', puuid: friendPuuid });
          describe('invite (toPuuid)', only);
          save('lobby-invitations--by-puuid', only, '[{ toPuuid }]; --verify-commands');
          await readLobby();
        } else {
          report.say('  skipped');
        }
      }
    } else {
      report.say('  skipped');
    }
    report.say();

    // --- 3. switch ---------------------------------------------------------------------------------------
    report.say('3. Switch side');
    const before = await readLobby();
    if (before === null) {
      report.say('  no lobby; skipped');
    } else if (await wants('  POST /lol-lobby/v1/lobby/custom/switch-teams with no body (v2 on a 404)?')) {
      const sent = await postSwitchTeams(client);
      for (const attempt of sent.attempts) {
        describe(`switch (${attempt.path.includes('/v1/') ? 'v1' : 'v2'})`, attempt);
        save(
          attempt.path.includes('/v1/') ? 'switch-teams-v1' : 'switch-teams-v2',
          attempt,
          'no body; --verify-commands',
        );
      }
      const after = await readLobby();
      const sideBefore = sideOf(before, localPuuid);
      const sideAfter = after === null ? null : sideOf(after, localPuuid);
      report.say(
        `  local side before ${sideBefore ?? 'none'}, after ${sideAfter ?? 'none'}: ${sideBefore !== sideAfter ? 'MOVED' : 'did not move'}`,
      );
      if (
        sent.used.response.ok ||
        (sent.used.response.reason === 'http' && sent.used.response.status !== 404)
      ) {
        if (
          await optIn(
            '  Fill the side you would move to (the friend plus bots, five in all), then probe the full-side answer?',
          )
        ) {
          const full = await readLobby();
          const again = await postSwitchTeams(client);
          describe('switch (full target side)', again.used);
          save('switch-teams--full-side', again.used, 'target side holding five; --verify-commands');
          const afterFull = await readLobby();
          report.say(
            `  local side before ${full === null ? 'none' : (sideOf(full, localPuuid) ?? 'none')}, after ${afterFull === null ? 'none' : (sideOf(afterFull, localPuuid) ?? 'none')}`,
          );
        }
      }
    } else {
      report.say('  skipped');
    }
    report.say();

    const path = reportPath(options.configDir, patch, date);
    mkdirSync(options.configDir, { recursive: true });
    writeFileSync(path, `${report.lines.join('\n')}\n`);
    io.say(`Report written to ${path}`);
    io.say('Paste that file back, plus these fixtures:');
    for (const file of written) {
      io.say(`  ${file}`);
    }
    if (written.length === 0) {
      io.say('  (none written: every probe was skipped or the client gave no answer)');
    }
    io.say(
      'The engineer writes the reference rows and flips the per-kind gate from them; this tool changes nothing else.',
    );
    return 0;
  } finally {
    client.close();
  }
}
