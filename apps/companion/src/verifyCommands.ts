/**
 * `--verify-commands` (M4.1): the human-run, live verification of the three lobby writes, and the **only**
 * code allowed to POST to the League client while their rows in docs/03-lcu-reference.md are `unverified`.
 *
 * Second edition (2026-09-10), after the first live run on 16.17 refused the community create body with
 * `500 INVALID_LOBBY` and so never had a lobby to invite into or switch in. Everything it sends now comes
 * from the 16.17 client's own lobby UI and OpenAPI document (see `packages/lcu/src/writes.ts`).
 *
 * Run with the client up, in no lobby (or a lobby you are happy to replace), and one friend online:
 *  1. create — reads `GET /lol-game-queues/v1/custom` (what the client's Create Custom dialog lists) and
 *     `GET /lol-game-queues/v1/queues` (names for the ids), saves both as fixtures, prints the Summoner's Rift
 *     entries, then `POST /lol-lobby/v2/lobby` with the ranked candidate bodies from `createLobbyCandidates`
 *     in order, stopping at the first 2xx; every attempt is a fixture; then, opt-in, the accepted shape again
 *     with the dialog's draft entry;
 *  2. invite — the friend's Riot ID -> puuid -> summonerId (verified GETs), then
 *     `POST /lol-lobby/v2/lobby/invitations` with `[{ toSummonerId }]`, and `[{ toPuuid }]` on any 4xx;
 *  3. switch — `POST /lol-lobby/v2/lobby/team/TEAM1|TEAM2` (the side you are not on) with no body; then,
 *     optionally, the same POST against a full target side.
 *
 * It prompts before every write step, prints each request, status and body shape, saves each answer as a
 * fixture (`packages/lcu/fixtures/<patch>/` when run from the repo, else `<configDir>/fixtures/<patch>/`)
 * scrubbed like every other fixture, and writes `<configDir>/verify-commands-<patch>-<date>.txt` for the
 * person to paste back. It makes no API call, needs no token, and every POST goes through `@customs/lcu`'s
 * allow-list. It never deletes the lobby it made (`DELETE /lol-lobby/v2/lobby` is not a listed-safe path):
 * close it from the client afterwards. The engineer then writes the rows and flips
 * `LOBBY_WRITE_VERIFICATION`; nothing here flips anything.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AliasLookupSchema,
  type CreateLobbyAttempt,
  CustomGameQueuesSchema,
  type CustomGameSubcategory,
  type CustomLobbyIds,
  chooseCustomLobbyMutator,
  createLobbyBodyVariant,
  createLobbyCandidates,
  describeMutators,
  describeWriteResponse,
  discoverLockfile,
  FIXTURES_DIR,
  type FixtureEnvelope,
  fillPath,
  GameflowPhaseSchema,
  GameQueuesSchema,
  GameVersionSchema,
  isAcceptedWrite,
  LcuClient,
  type Lobby,
  LobbySchema,
  type LobbyWrite,
  type LockfileDiscoveryOptions,
  patchFromVersion,
  postCreateLobbyCandidates,
  postInvite,
  postSwitchSide,
  readEndpoint,
  SummonerSchema,
  scrubValue,
  summonersRiftSubcategory,
  switchSidePath,
  type TlsMode,
  WRITE_ENDPOINTS,
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
const CUSTOM_GAME_QUEUES = readEndpoint('custom-game-queues');
const GAME_QUEUES = readEndpoint('game-queues');

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

/** A typed id, or null: what a person typed at an "id [default]" prompt. */
export function parseIdAnswer(answer: string, fallback: number | null): number | null {
  const trimmed = answer.trim();
  if (trimmed === '') {
    return fallback;
  }
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
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

function describeSubcategory(index: number, entry: CustomGameSubcategory): string {
  return `    #${index} map ${entry.mapId} ${entry.gameMode} ${entry.numPlayersPerTeam ?? '?'}v${entry.numPlayersPerTeam ?? '?'} ${entry.queueAvailability ?? ''} mutators: ${describeMutators(entry) || '(none)'}`;
}

export async function runVerifyCommands(options: VerifyCommandsOptions): Promise<number> {
  const { io } = options;
  const now = options.now ?? (() => new Date());
  const report = new Report(io);
  const date = now().toISOString().slice(0, 10);
  const fixturesDir = resolveFixturesDir(options.configDir, options.fixturesDir);
  const written: string[] = [];

  report.say(
    `verify-commands ${date} (second edition): the M4.1 live verification of the three lobby writes.`,
  );
  report.say(
    `It POSTs only to ${WRITE_ENDPOINTS.createLobby.path}, ${WRITE_ENDPOINTS.invite.path} and ${WRITE_ENDPOINTS.switchSide.template},`,
  );
  report.say('prompts before each write step, and never touches champion select, matchmaking or a game.');
  report.say('Answer Enter to run a probe, s to skip it. Nothing here talks to the Kustom API.');
  report.say('It does not close the lobby it makes: close it from the client when you are done.');
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

    const saveEnvelope = (envelope: FixtureEnvelope): void => {
      const path = writeFixture(envelope, fixturesDir);
      written.push(path);
      report.say(`  fixture: ${path}`);
    };

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
      saveEnvelope(
        !response.ok && response.reason === 'malformed'
          ? { ...base, bodyText: response.text.slice(0, 4000) }
          : { ...base, body: scrubValue(response.json) },
      );
    };

    /** A verified-style GET fixture for the two dialog reads, whatever they answered (except no answer). */
    const saveRead = (id: string, path: string, response: Awaited<ReturnType<LcuClient['get']>>): void => {
      if (!response.ok && response.reason === 'network') {
        report.say(`  (no fixture for ${id}: the client gave no HTTP answer)`);
        return;
      }
      const base = {
        id,
        method: 'GET',
        path,
        status: response.status,
        capturedAt: now().toISOString(),
        patch,
        clientVersion: version.json,
        contentType: null,
        note: '--verify-commands',
      };
      saveEnvelope(
        !response.ok && response.reason === 'malformed'
          ? { ...base, bodyText: response.text.slice(0, 4000) }
          : { ...base, body: scrubValue(response.json) },
      );
    };

    const describe = (label: string, write: LobbyWrite): void => {
      report.say(`  ${label}: ${write.method} ${write.path}`);
      if (write.body !== undefined) {
        report.say(`  request: ${JSON.stringify(scrubValue(write.body))}`);
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

    // What the client's own Create Custom dialog would send: read, print, save.
    const dialog = await client.get(CUSTOM_GAME_QUEUES.path, CustomGameQueuesSchema);
    report.say(
      `  GET ${CUSTOM_GAME_QUEUES.path} -> ${dialog.ok ? `200 ${dialog.json.subcategories.length} subcategories` : describeWriteResponse(dialog)}`,
    );
    saveRead(CUSTOM_GAME_QUEUES.id, CUSTOM_GAME_QUEUES.path, dialog);
    let rift: CustomGameSubcategory | null = null;
    if (dialog.ok) {
      dialog.json.subcategories.forEach((entry, index) => {
        report.say(describeSubcategory(index, entry));
      });
      rift = summonersRiftSubcategory(dialog.json);
      report.say(
        rift === null
          ? "  no Summoner's Rift CLASSIC subcategory in the dialog data"
          : `  Summoner's Rift entries: ${describeMutators(rift) || '(none)'}`,
      );
    }
    const queues = await client.get(GAME_QUEUES.path, GameQueuesSchema);
    report.say(
      `  GET ${GAME_QUEUES.path} -> ${queues.ok ? `200 ${queues.json.length} queues` : describeWriteResponse(queues)}`,
    );
    saveRead(GAME_QUEUES.id, GAME_QUEUES.path, queues);
    if (queues.ok) {
      for (const queue of queues.json.filter((entry) => entry.isCustom === true)) {
        report.say(
          `    custom queue ${queue.id} "${queue.name ?? ''}" ${queue.gameMode ?? ''} map ${queue.mapId ?? '?'} gameTypeConfig ${queue.gameTypeConfig?.id ?? '?'} "${queue.gameTypeConfig?.name ?? ''}" pick=${queue.gameTypeConfig?.pickMode ?? ''}`,
        );
      }
    }

    const autoBlind =
      rift === null ? null : chooseCustomLobbyMutator(rift, 'blind', queues.ok ? queues.json : null);
    const autoDraft =
      rift === null ? null : chooseCustomLobbyMutator(rift, 'draft', queues.ok ? queues.json : null);
    report.say(
      `  auto-picked dialog entries: blind ${autoBlind === null ? 'none' : autoBlind.id}, draft ${autoDraft === null ? 'none' : autoDraft.id}`,
    );

    let runCreate = true;
    if (existing !== null) {
      runCreate = await optIn(
        `  You are already in a lobby (${existing.partyId}). Creating one REPLACES it. Create anyway?`,
      );
    }
    let acceptedAttempt: CreateLobbyAttempt | null = null;
    if (runCreate) {
      const blindId = parseIdAnswer(
        await io.ask(
          `  Dialog entry id for the first create (blind; see the list above) [${autoBlind === null ? 'none: known pair only' : autoBlind.id}]: `,
        ),
        autoBlind === null ? null : autoBlind.id,
      );
      const live: CustomLobbyIds | null = blindId === null ? null : { queueId: blindId, mutatorId: blindId };
      const candidates = createLobbyCandidates({
        lobbyName: VERIFY_LOBBY_NAME,
        lobbyPassword: VERIFY_LOBBY_PASSWORD,
        live,
      });
      report.say(`  ${candidates.length} candidate bodies, best evidence first:`);
      candidates.forEach((candidate, index) => {
        report.say(`    ${index + 1}. ${candidate.id}: ${candidate.evidence}`);
      });
      if (
        await wants(
          `  POST ${WRITE_ENDPOINTS.createLobby.path} with them in order, stopping at the first 2xx (name ${VERIFY_LOBBY_NAME}, password ${VERIFY_LOBBY_PASSWORD})?`,
        )
      ) {
        // The loop stops on any 2xx, or when a lobby exists after the POST whatever the answer said, so a
        // later candidate can never replace a lobby the client just made.
        const result = await postCreateLobbyCandidates(client, candidates, async (attempt) => {
          describe(`create (${attempt.candidate.id})`, attempt.write);
          save(
            `create-lobby--${attempt.candidate.id}`,
            attempt.write,
            `${attempt.candidate.evidence}; --verify-commands`,
          );
          const lobby = await readLobby();
          if (lobby !== null && !isAcceptedWrite(attempt.write.response)) {
            report.say('  a lobby exists after that answer: stopping here, no more candidates');
            return 'stop';
          }
          return undefined;
        });
        acceptedAttempt = result.accepted;
        if (acceptedAttempt !== null) {
          report.say(
            `  ACCEPTED: ${acceptedAttempt.candidate.id} (${acceptedAttempt.candidate.variant} shape, queueId ${acceptedAttempt.candidate.ids.queueId}, mutators.id ${acceptedAttempt.candidate.ids.mutatorId})`,
          );
          save(
            'create-lobby',
            acceptedAttempt.write,
            `accepted candidate ${acceptedAttempt.candidate.id}; --verify-commands`,
          );
          const shown = (
            await io.ask(
              `  Does the client lobby screen show the password ${VERIFY_LOBBY_PASSWORD}? [y/n/?] `,
            )
          ).trim();
          report.say(`  password visible in the client: ${shown || '?'}`);
          const draftId = parseIdAnswer(
            await io.ask(
              `  Also probe draft with the accepted shape? Dialog entry id for draft [${autoDraft === null ? 'skip' : autoDraft.id}]: `,
            ),
            autoDraft === null ? null : autoDraft.id,
          );
          if (
            draftId !== null &&
            (await optIn(`  Create the draft lobby with id ${draftId}? This replaces the lobby.`))
          ) {
            const draftBody = createLobbyBodyVariant(acceptedAttempt.candidate.variant, {
              lobbyName: VERIFY_LOBBY_NAME,
              lobbyPassword: VERIFY_LOBBY_PASSWORD,
              ids: { queueId: draftId, mutatorId: draftId },
            });
            const draft = await postCreateLobbyCandidates(client, [
              {
                id: `draft-${draftId}`,
                variant: acceptedAttempt.candidate.variant,
                ids: { queueId: draftId, mutatorId: draftId },
                evidence: `the accepted shape with the dialog's draft entry ${draftId}`,
                body: draftBody,
              },
            ]);
            const attempt = draft.attempts[0];
            if (attempt !== undefined) {
              describe('create (draft)', attempt.write);
              save('create-lobby--draft', attempt.write, `dialog entry ${draftId}; --verify-commands`);
              await readLobby();
            }
          }
        } else {
          report.say('  NONE ACCEPTED: every candidate was refused; paste the fixtures back.');
        }
      } else {
        report.say('  skipped');
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
          (await wants(`  POST ${WRITE_ENDPOINTS.invite.path} with [{ toSummonerId: ${summonerId} }]?`))
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
    const sideBefore = before === null ? null : sideOf(before, localPuuid);
    if (before === null) {
      report.say('  no lobby; skipped');
    } else if (sideBefore === null) {
      report.say('  you are on neither side (spectator?); move to a team in the client first. skipped');
    } else {
      const target = sideBefore === 100 ? 200 : 100;
      const path = switchSidePath(target);
      if (await wants(`  POST ${path} with no body (moves you from ${sideBefore} to ${target})?`)) {
        const sent = await postSwitchSide(client, target);
        describe(`switch (${target === 100 ? 'TEAM1' : 'TEAM2'})`, sent);
        save('lobby-team', sent, `no body, target ${target}; --verify-commands`);
        const after = await readLobby();
        const sideAfter = after === null ? null : sideOf(after, localPuuid);
        report.say(
          `  local side before ${sideBefore}, after ${sideAfter ?? 'none'}: ${sideBefore !== sideAfter ? 'MOVED' : 'did not move'}`,
        );
        if (sent.response.ok || (sent.response.reason === 'http' && sent.response.status !== 404)) {
          if (
            await optIn(
              '  Fill the side you would move to next (the friend plus bots, five in all), then probe the full-side answer?',
            )
          ) {
            const full = await readLobby();
            const sideNow = full === null ? null : sideOf(full, localPuuid);
            if (sideNow === null) {
              report.say('  you are on neither side; skipped');
            } else {
              const nextTarget = sideNow === 100 ? 200 : 100;
              const again = await postSwitchSide(client, nextTarget);
              describe('switch (full target side)', again);
              save(
                'lobby-team--full-side',
                again,
                `target side ${nextTarget} holding five; --verify-commands`,
              );
              const afterFull = await readLobby();
              report.say(
                `  local side before ${sideNow}, after ${afterFull === null ? 'none' : (sideOf(afterFull, localPuuid) ?? 'none')}`,
              );
            }
          }
        }
      } else {
        report.say('  skipped');
      }
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
    io.say('The lobby this made is still open: close it from the client.');
    io.say(
      'The engineer writes the reference rows and flips the per-kind gate from them; this tool changes nothing else.',
    );
    return 0;
  } finally {
    client.close();
  }
}
