/**
 * `pnpm --filter @customs/lcu smoke [--diff] [--insecure] [--lockfile <path>] [--puuid <puuid>]
 *   [--riot-id Name#TAG] [--out <dir>] [--verbose]`
 *
 * Hits every read-only endpoint in the catalogue against the running client and writes each raw response
 * to `fixtures/<patch>/<endpoint-id>.json` (see fixtures/README.md). GET only, by construction: this script
 * never creates a lobby, invites, or touches champion select.
 *
 * `--diff` compares each fresh response's top-level key set (and status) with the newest saved fixture instead
 * of writing. This is the post-patch health check named in docs/01-architecture.md.
 *
 * `--puuid` and `--riot-id` add probes for another player (M0.3 question 4: does `ranked-stats/{puuid}` work
 * for someone who is not you?). `--game-id` pins the match-detail probe to one game (the history list cannot
 * tell a full 5v5 from a solo abort, so the automatic choice is only "newest completed custom").
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { LcuClient, type RawResponse } from '../client.js';
import {
  canFill,
  fillPath,
  LIVE_CLIENT_DATA,
  type PathParam,
  READ_ENDPOINTS,
  type ReadEndpoint,
} from '../endpoints.js';
import {
  diffTopLevelKeys,
  FIXTURES_DIR,
  type FixtureEnvelope,
  isShapeDiffEmpty,
  newestFixture,
  type ShapeDiff,
} from '../fixtures.js';
import { discoverLockfile } from '../lockfile.js';
import { CurrentSummonerMinimalSchema, MatchHistoryMinimalSchema } from '../schemas.js';
import { scrubText, scrubValue } from '../scrub.js';
import { describeTlsMode } from '../tls.js';
import {
  describeAttempts,
  describeNotFound,
  isoNow,
  makeLogger,
  probeTls,
  resolveVersion,
  todayStamp,
} from './common.js';

const HELP = `smoke: hit every read-only LCU endpoint and save the raw responses as fixtures.

  --diff            compare with the newest saved fixtures instead of writing
  --insecure        skip certificate pinning (rejectUnauthorized: false)
  --lockfile <p>    lockfile path for a non-default install
  --puuid <puuid>   also probe ranked-stats and summoner lookup for another player
  --riot-id N#TAG   also probe the alias lookup for another Riot ID
  --game-id <id>    probe match-detail for this game instead of the newest completed custom in the history
  --out <dir>       fixtures root (default packages/lcu/fixtures)
  --live-port <n>   port of the in-game live data server (default 2999; tests point it at a dead port)
  --verbose         debug logging
`;

interface Row {
  readonly id: string;
  readonly path: string;
  readonly status: string;
  readonly bytes: number;
  readonly note: string;
  /** `--diff` only: status or top-level shape differs from the newest fixture, or there is none. */
  readonly changed: boolean;
}

/**
 * Builds the fixture envelope. Bodies go through the same key scrub as recorded WebSocket events
 * (`eog-stats-block` carries `mucJwtDto` and `multiUserChatPassword`, for example); `redacted` says whether
 * anything was replaced so the table can show it.
 */
function envelopeFor(
  endpoint: { id: string; path: string },
  response: Extract<RawResponse, { kind: 'response' }>,
  patch: string,
  clientVersion: string | null,
): { envelope: FixtureEnvelope; redacted: boolean } {
  const base = {
    id: endpoint.id,
    method: 'GET',
    path: endpoint.path,
    status: response.status,
    capturedAt: isoNow(),
    patch,
    clientVersion,
    contentType: response.contentType ?? null,
  };
  if (response.body.parsed) {
    const body = scrubValue(response.body.value);
    return {
      envelope: { ...base, body },
      redacted: JSON.stringify(body) !== JSON.stringify(response.body.value),
    };
  }
  const bodyText = scrubText(response.text, response.text.length);
  return { envelope: { ...base, bodyText }, redacted: bodyText !== response.text };
}

function describeDiff(
  previous: FixtureEnvelope,
  current: FixtureEnvelope,
  previousDir: string,
): { note: string; changed: boolean } {
  const parts: string[] = [];
  if (previous.status !== current.status) {
    parts.push(`status ${previous.status} -> ${current.status}`);
  }
  const diff: ShapeDiff = diffTopLevelKeys(previous.body, current.body);
  const changed = previous.status !== current.status || !isShapeDiffEmpty(diff);
  if (diff.added.length > 0) {
    parts.push(`+${diff.added.join(',+')}`);
  }
  if (diff.removed.length > 0) {
    parts.push(`-${diff.removed.join(',-')}`);
  }
  if (diff.typeChanged.length > 0) {
    parts.push(`type:${diff.typeChanged.join(',')}`);
  }
  if (!changed) {
    return { note: `same as ${previousDir}`, changed };
  }
  return { note: `${parts.join(' ')} (vs ${previousDir})`, changed };
}

function printTable(rows: readonly Row[]): void {
  const widths = {
    id: Math.max(8, ...rows.map((row) => row.id.length)),
    path: Math.max(4, ...rows.map((row) => row.path.length)),
    status: 6,
    bytes: 7,
  };
  const line = (id: string, path: string, status: string, bytes: string, note: string): string =>
    `${id.padEnd(widths.id)}  ${path.padEnd(widths.path)}  ${status.padStart(widths.status)}  ${bytes.padStart(widths.bytes)}  ${note}`;
  console.log(line('endpoint', 'path', 'status', 'bytes', 'note'));
  console.log(line('-'.repeat(widths.id), '-'.repeat(widths.path), '------', '-------', '----'));
  for (const row of rows) {
    console.log(line(row.id, row.path, row.status, String(row.bytes), row.note));
  }
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      diff: { type: 'boolean', default: false },
      insecure: { type: 'boolean', default: false },
      lockfile: { type: 'string' },
      puuid: { type: 'string' },
      'riot-id': { type: 'string' },
      'game-id': { type: 'string' },
      out: { type: 'string' },
      'live-port': { type: 'string' },
      verbose: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  const logger = makeLogger(values.verbose);
  const root = values.out ?? FIXTURES_DIR;

  const discovered = await discoverLockfile({ overridePath: values.lockfile });
  if (discovered.status === 'not_found') {
    console.error(describeNotFound(discovered));
    return 2;
  }
  console.log(
    `lockfile: ${discovered.path} (pid ${discovered.credentials.pid}, port ${discovered.credentials.port})`,
  );

  const probe = await probeTls(discovered.credentials, { insecure: values.insecure, logger });
  console.log('tls:');
  console.log(describeAttempts(probe.attempts));
  if (probe.client === null) {
    console.error('No TLS mode reached the client. Is it still starting, or did it just exit?');
    return 3;
  }
  const { client } = probe;
  console.log(`using: ${describeTlsMode(probe.mode)}`);

  const resolved = await resolveVersion(client, probe.versionResponse, todayStamp());
  console.log(
    `client version: ${resolved.version ?? 'unknown'} (from ${resolved.source}) -> fixtures/${resolved.patch}`,
  );
  const patchDir = join(root, resolved.patch);
  if (!values.diff) {
    mkdirSync(patchDir, { recursive: true });
  }

  const rows: Row[] = [];
  const envelopes: FixtureEnvelope[] = [];
  const params: Partial<Record<PathParam, string>> = {};
  if (values['game-id']) {
    params.gameId = values['game-id'];
  }

  const probes: { endpoint: ReadEndpoint; suffix: string; overrides: Partial<Record<PathParam, string>> }[] =
    READ_ENDPOINTS.map((endpoint) => ({ endpoint, suffix: '', overrides: {} }));
  if (values.puuid) {
    for (const id of ['ranked-stats-by-puuid', 'summoner-by-puuid', 'match-history']) {
      const endpoint = READ_ENDPOINTS.find((candidate) => candidate.id === id);
      if (endpoint) {
        probes.push({ endpoint, suffix: '--other', overrides: { puuid: values.puuid } });
      }
    }
  }
  if (values['riot-id']) {
    const [gameName, tagLine] = values['riot-id'].split('#');
    const endpoint = READ_ENDPOINTS.find((candidate) => candidate.id === 'alias-lookup');
    if (endpoint && gameName && tagLine) {
      probes.push({ endpoint, suffix: '--other', overrides: { gameName, tagLine } });
    } else {
      console.error('--riot-id must look like Name#TAG');
    }
  }

  const record = async (
    id: string,
    path: string,
    target: LcuClient,
    idle: readonly number[],
  ): Promise<FixtureEnvelope | null> => {
    const response = await target.raw('GET', path);
    if (response.kind === 'network') {
      rows.push({
        id,
        path,
        status: 'ERR',
        bytes: 0,
        note: `${response.code ?? ''} ${response.message}`.trim(),
        changed: false,
      });
      return null;
    }
    const { envelope, redacted } = envelopeFor({ id, path }, response, resolved.patch, resolved.version);
    envelopes.push(envelope);
    const notes: string[] = [];
    if (!idle.includes(response.status)) {
      notes.push(`unexpected status (idle: ${idle.join('/')})`);
    }
    if (redacted) {
      notes.push('credential-looking keys redacted');
    }
    if (!response.body.parsed) {
      notes.push('body is not JSON');
    }
    let changed = false;
    if (values.diff) {
      const previous = newestFixture(id, root);
      if (previous) {
        const diff = describeDiff(previous.envelope, envelope, previous.patch);
        notes.push(diff.note);
        changed = diff.changed;
      } else {
        notes.push('no saved fixture');
        changed = true;
      }
    } else {
      writeFileSync(join(patchDir, `${id}.json`), `${JSON.stringify(envelope, null, 2)}\n`);
    }
    rows.push({
      id,
      path,
      status: String(response.status),
      bytes: Buffer.byteLength(response.text),
      note: notes.join('; '),
      changed,
    });
    return envelope;
  };

  for (const { endpoint, suffix, overrides } of probes) {
    const id = `${endpoint.id}${suffix}`;
    const values2 = { ...params, ...overrides };
    if (!canFill(endpoint, values2)) {
      const missing = endpoint.params.filter((param) => values2[param] === undefined);
      rows.push({
        id,
        path: endpoint.path,
        status: 'skip',
        bytes: 0,
        note: `needs ${missing.join(', ')}`,
        changed: false,
      });
      continue;
    }
    const path = fillPath(endpoint.path, values2);
    const envelope = await record(id, path, client, endpoint.idleStatuses);
    if (!envelope || suffix !== '' || envelope.status !== 200) {
      continue;
    }
    if (endpoint.id === 'current-summoner') {
      const self = CurrentSummonerMinimalSchema.safeParse(envelope.body);
      if (self.success) {
        params.puuid = self.data.puuid;
        if (self.data.gameName !== undefined) {
          params.gameName = self.data.gameName;
        }
        if (self.data.tagLine !== undefined) {
          params.tagLine = self.data.tagLine;
        }
      } else {
        logger.warn(
          'current-summoner did not carry puuid/gameName/tagLine; dependent probes will be skipped',
        );
      }
    }
    if (endpoint.id === 'match-history' && params.gameId === undefined) {
      const history = MatchHistoryMinimalSchema.safeParse(envelope.body);
      if (history.success) {
        const games = history.data.games.games;
        const customs = games.filter((game) => game.gameType === 'CUSTOM_GAME');
        // A completed custom carries every participant; an aborted one (Abort_TooFewPlayers) only the local
        // player, which makes a poor fixture. Fall back to any custom, then to anything.
        const custom = customs.find((game) => game.endOfGameResult === 'GameComplete') ?? customs[0];
        const chosen = custom ?? games[0];
        if (chosen) {
          params.gameId = String(chosen.gameId);
          const label = custom ? ` (custom, ${custom.endOfGameResult ?? 'result unknown'})` : '';
          console.log(
            `match-history: ${games.length} games, ${customs.length} CUSTOM_GAME; match-detail will use ${chosen.gameId}${label}`,
          );
        }
      } else {
        logger.warn('match-history did not match the minimal shape; match-detail will be skipped');
      }
    }
  }

  // The in-game live data server is a different process on a fixed port. Refused when not in a game.
  const livePort = values['live-port'] ? Number(values['live-port']) : LIVE_CLIENT_DATA.port;
  const live = new LcuClient({
    port: livePort,
    password: '',
    tls: { mode: 'insecure' },
    timeoutMs: 3000,
  });
  await record(LIVE_CLIENT_DATA.id, LIVE_CLIENT_DATA.path, live, [200]);
  live.close();

  console.log('');
  printTable(rows);

  if (!values.diff) {
    const manifest = {
      patch: resolved.patch,
      clientVersion: resolved.version,
      versionSource: resolved.source,
      capturedAt: isoNow(),
      tls: describeTlsMode(probe.mode),
      tlsAttempts: probe.attempts.map((attempt) => ({
        mode: describeTlsMode(attempt.mode),
        outcome: attempt.outcome,
      })),
      lockfile: discovered.path,
      results: rows,
    };
    writeFileSync(join(patchDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`\nwrote ${envelopes.length} fixtures and manifest.json to ${patchDir}`);
  } else {
    const changed = rows.filter((row) => row.changed);
    console.log(
      changed.length === 0
        ? '\nno shape changes against the newest fixtures'
        : `\n${changed.length} endpoint(s) differ`,
    );
    client.close();
    return changed.length === 0 ? 0 : 1;
  }

  client.close();
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error('smoke crashed:', error);
    process.exit(1);
  },
);
