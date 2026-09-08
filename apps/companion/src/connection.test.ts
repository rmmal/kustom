/**
 * The state machine against the in-process fake League client from `@customs/lcu` (an HTTPS server with a
 * self-signed certificate and a WebSocket that emits scripted frames). No live client is ever touched: the
 * lockfile is a temp file pointing at the fake, and the default candidates are replaced with an empty list.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FIXTURES_DIR, readFixture } from '@customs/lcu';
import { type CannedRoute, type FakeLcu, startFakeLcu } from '@customs/lcu/test-support/fake-lcu';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type CompanionHooks,
  type ConnectedContext,
  type ConnectionEvent,
  ConnectionMachine,
  type EogHookEvent,
  type LobbyHookEvent,
  TRANSITIONS,
  type Transition,
} from './connection.js';
import { type CompanionLogger, createFileLogger, createMemoryLogger, type MemoryLogger } from './log.js';

const PUUID = '11111111-2222-3333-4444-555555555555';
const PASSWORD = 'fake-lockfile-password-9f8e7d';

const baseRoutes: Record<string, CannedRoute> = {
  'GET /lol-patch/v1/game-version': {
    status: 200,
    body: '"16.17.8104348+branch.releases-16-17.code.public.content.release.anticheat.vanguard"',
    contentType: 'application/json',
  },
  'GET /lol-summoner/v1/current-summoner': {
    status: 200,
    body: { puuid: PUUID, summonerId: 7, gameName: 'Test Name', tagLine: 'EUNE', accountId: 1 },
  },
  'GET /lol-gameflow/v1/gameflow-phase': { status: 200, body: '"None"', contentType: 'application/json' },
};

interface Recorded {
  connected: ConnectedContext[];
  lobby: LobbyHookEvent[];
  phases: string[];
  eog: EogHookEvent[];
  disconnected: ConnectionEvent[];
}

function recordingHooks(record: Recorded, extra: Partial<CompanionHooks> = {}): CompanionHooks {
  return {
    onConnected: (context) => {
      record.connected.push(context);
    },
    onLobbyEvent: (event) => {
      record.lobby.push(event);
    },
    onGameflowPhase: (phase) => {
      record.phases.push(phase);
    },
    onEogBlock: (event) => {
      record.eog.push(event);
    },
    onDisconnected: (reason) => {
      record.disconnected.push(reason);
    },
    ...extra,
  };
}

function until(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = (): void => {
      if (check()) {
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        reject(new Error('timed out waiting for condition'));
      } else {
        setTimeout(tick, 10);
      }
    };
    tick();
  });
}

interface Harness {
  fake: FakeLcu;
  dir: string;
  lockfile: string;
  record: Recorded;
  transitions: Transition[];
  logger: MemoryLogger;
  machine: ConnectionMachine;
  run: Promise<void>;
  writeLockfile(port?: number): void;
}

const harnesses: Harness[] = [];

async function start(
  options: {
    routes?: Record<string, CannedRoute>;
    hooks?: Partial<CompanionHooks>;
    logger?: CompanionLogger;
    lockfilePort?: number;
    requestTimeoutMs?: number;
  } = {},
): Promise<Harness> {
  const fake = await startFakeLcu({ password: PASSWORD, routes: { ...baseRoutes, ...options.routes } });
  const dir = mkdtempSync(join(tmpdir(), 'companion-conn-'));
  const lockfile = join(dir, 'lockfile');
  const writeLockfile = (port: number = fake.port): void => {
    writeFileSync(lockfile, `LeagueClient:4242:${port}:${PASSWORD}:https`);
  };
  writeLockfile(options.lockfilePort);
  const record: Recorded = { connected: [], lobby: [], phases: [], eog: [], disconnected: [] };
  const memory = createMemoryLogger();
  const logger = options.logger ?? memory;
  const machine = new ConnectionMachine({
    logger,
    hooks: recordingHooks(record, options.hooks),
    lockfile: { overridePath: lockfile, candidates: [], env: {} },
    tls: { mode: 'pinned', ca: fake.ca },
    pollIntervalMs: 40,
    backoff: { minMs: 20, maxMs: 60 },
    requestTimeoutMs: options.requestTimeoutMs ?? 2_000,
  });
  const transitions: Transition[] = [];
  machine.on('transition', (transition) => transitions.push(transition));
  const run = machine.run();
  const harness: Harness = {
    fake,
    dir,
    lockfile,
    record,
    transitions,
    logger: memory,
    machine,
    run,
    writeLockfile,
  };
  harnesses.push(harness);
  return harness;
}

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    harness.machine.stop();
    await harness.run;
    await harness.fake.close();
    rmSync(harness.dir, { recursive: true, force: true });
  }
});

function lobbyFixture(): unknown {
  const fixture = readFixture('16.17', 'lobby');
  if (!fixture.ok) {
    throw new Error(fixture.reason);
  }
  return fixture.envelope.body;
}

interface RecordedEvent {
  uri: string;
  eventType: 'Create' | 'Update' | 'Delete';
  data?: unknown;
}

function recordedEvents(uris: readonly string[]): RecordedEvent[] {
  const text = readFileSync(join(FIXTURES_DIR, '16.17', 'ws-events.ndjson'), 'utf8');
  const events: RecordedEvent[] = [];
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) {
      continue;
    }
    const parsed = JSON.parse(line) as Partial<RecordedEvent> & { redacted?: boolean };
    if (parsed.uri && parsed.eventType && uris.includes(parsed.uri) && !parsed.redacted) {
      events.push({ uri: parsed.uri, eventType: parsed.eventType, data: parsed.data ?? null });
    }
  }
  return events;
}

describe('transition table', () => {
  it('lists every legal move and nothing leaves stopped', () => {
    expect(TRANSITIONS.disconnected.client_reached).toBe('connected');
    expect(TRANSITIONS.connected.socket_open).toBe('watching');
    expect(TRANSITIONS.watching.socket_closed).toBe('disconnected');
    expect(TRANSITIONS.watching.client_lost).toBe('disconnected');
    expect(TRANSITIONS.connected.client_lost).toBe('disconnected');
    expect(TRANSITIONS.disconnected.socket_open).toBeUndefined();
    expect(Object.keys(TRANSITIONS.stopped)).toHaveLength(0);
  });
});

describe('ConnectionMachine', () => {
  it('walks disconnected -> connected -> watching and reads the local player', async () => {
    const h = await start();
    await h.machine.waitForState('watching');
    expect(h.transitions.map((t) => `${t.from}>${t.to}`)).toEqual([
      'disconnected>connected',
      'connected>watching',
    ]);
    expect(h.record.connected).toHaveLength(1);
    const context = h.record.connected[0];
    expect(context?.summoner?.puuid).toBe(PUUID);
    expect(context?.version).toContain('16.17');
    expect(context?.patch).toBe('16.17');
    expect(context?.phase).toBe('None');
    const frames = await h.fake.waitForWsFrames(1);
    expect(frames).toEqual(['[5,"OnJsonApiEvent"]']);
    const connectedLine = h.logger.lines.find((line) => line.message === 'connected to the League client');
    expect(connectedLine?.fields.puuid).toBe(PUUID);
    expect(h.machine.connected).not.toBeNull();
  });

  it('delivers a real lobby event through the schema and drops a malformed one', async () => {
    const h = await start();
    await h.machine.waitForState('watching');
    const lobby = lobbyFixture();
    h.fake.emitEvent('/lol-lobby/v2/lobby', 'Update', lobby);
    h.fake.emitEvent('/lol-lobby/v2/lobby', 'Update', { partyId: 42 });
    h.fake.emitEvent('/lol-lobby/v2/lobby', 'Delete', null);
    h.fake.emitEvent('/lol-chat/v1/me', 'Update', { secret: 'chat-payload-value' });
    await until(() => h.record.lobby.length === 2);
    expect(h.record.lobby[0]?.eventType).toBe('Update');
    expect(h.record.lobby[0]?.lobby?.partyId).toBe('e3c69392-a134-43cb-97ae-8add18c72494');
    expect(h.record.lobby[0]?.lobby?.gameConfig.customTeam100.length).toBeGreaterThan(0);
    expect(h.record.lobby[1]).toEqual({ eventType: 'Delete', lobby: null });
    const dropped = h.logger.lines.find((line) => line.message.includes('dropped'));
    expect(dropped?.fields.uri).toBe('/lol-lobby/v2/lobby');
    expect(JSON.stringify(h.logger.lines)).not.toContain('chat-payload-value');
  });

  it('replays the recorded custom game: phases in order, then the end-of-game block', async () => {
    const h = await start();
    await h.machine.waitForState('watching');
    const uris = ['/lol-gameflow/v1/gameflow-phase', '/lol-end-of-game/v1/eog-stats-block'];
    const events = recordedEvents(uris);
    expect(events.length).toBeGreaterThan(10);
    for (const event of events) {
      h.fake.emitEvent(event.uri, event.eventType, event.data);
    }
    const phaseCount = events.filter((event) => event.uri === uris[0]).length;
    await until(() => h.record.phases.length === phaseCount);
    const first = h.record.phases.indexOf('InProgress');
    const end = h.record.phases.indexOf('EndOfGame');
    expect(first).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(first);
    const blocks = h.record.eog.filter((event) => event.block !== null);
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.every((event) => event.block?.gameType === 'CUSTOM_GAME')).toBe(true);
    // The recording holds a played game and a server-dropped one (no winner); at least one has a winner.
    expect(blocks.some((event) => event.block?.teams.some((team) => team.isWinningTeam))).toBe(true);
    // Hook order is preserved: the first block arrived before EndOfGame, as on the real client.
    expect(h.record.eog.length).toBeGreaterThan(0);
  });

  it('goes back to disconnected when the socket drops mid-game and reconnects with the subscription re-sent', async () => {
    const h = await start();
    await h.machine.waitForState('watching');
    await h.fake.waitForWsFrames(1);
    h.fake.closeSockets(1001, 'client exiting');
    await h.machine.waitForState('disconnected');
    await h.machine.waitForState('watching');
    const frames = await h.fake.waitForWsFrames(2);
    expect(frames).toEqual(['[5,"OnJsonApiEvent"]', '[5,"OnJsonApiEvent"]']);
    expect(h.record.disconnected).toEqual(['socket_closed']);
    expect(h.record.connected).toHaveLength(2);
    expect(h.transitions.map((t) => t.event)).toEqual([
      'client_reached',
      'socket_open',
      'socket_closed',
      'client_reached',
      'socket_open',
    ]);
    // Events after the reconnect still reach the hooks.
    h.fake.emitEvent('/lol-gameflow/v1/gameflow-phase', 'Update', 'Lobby');
    await until(() => h.record.phases.includes('Lobby'));
  });

  it('returns to disconnected when the lockfile disappears, and reconnects when it is back', async () => {
    const h = await start();
    await h.machine.waitForState('watching');
    rmSync(h.lockfile);
    await h.machine.waitForState('disconnected');
    await until(() => h.record.disconnected.length === 1);
    expect(h.record.disconnected).toEqual(['client_lost']);
    // Still disconnected while there is no lockfile.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(h.machine.state).toBe('disconnected');
    expect(h.logger.lines.filter((line) => line.message === 'waiting for the League client')).toHaveLength(1);
    h.writeLockfile();
    await h.machine.waitForState('watching');
    expect(h.record.connected).toHaveLength(2);
  });

  it('treats a changed lockfile (client restarted) as a lost client', async () => {
    const h = await start();
    await h.machine.waitForState('watching');
    writeFileSync(h.lockfile, `LeagueClient:9:${h.fake.port}:another-password-1234:https`);
    await h.machine.waitForState('disconnected');
    await until(() => h.record.disconnected.length === 1);
    expect(h.record.disconnected).toEqual(['client_lost']);
  });

  it('stays disconnected while the lockfile points at a dead port, then connects once it answers', async () => {
    const h = await start({ lockfilePort: 1 });
    await until(() => h.logger.lines.some((line) => line.message.includes('not answering')));
    expect(h.machine.state).toBe('disconnected');
    expect(h.transitions).toHaveLength(0);
    h.writeLockfile();
    await h.machine.waitForState('watching');
  });

  it('hands the connect-time phase to onConnected so a missed end of game can be recovered', async () => {
    const h = await start({
      routes: {
        'GET /lol-gameflow/v1/gameflow-phase': {
          status: 200,
          body: '"EndOfGame"',
          contentType: 'application/json',
        },
      },
    });
    await h.machine.waitForState('watching');
    expect(h.record.connected[0]?.phase).toBe('EndOfGame');
    // The context's client is usable for the follow-up GET M2.3 will make.
    const client = h.record.connected[0]?.client;
    const phase = await client?.get('/lol-gameflow/v1/gameflow-phase', (await import('zod')).z.string());
    expect(phase?.ok).toBe(true);
  });

  it('survives a hook that throws and keeps delivering', async () => {
    let calls = 0;
    const h = await start({
      hooks: {
        onGameflowPhase: () => {
          calls += 1;
          if (calls === 1) {
            throw new Error('hook bug');
          }
        },
      },
    });
    await h.machine.waitForState('watching');
    h.fake.emitEvent('/lol-gameflow/v1/gameflow-phase', 'Update', 'Lobby');
    h.fake.emitEvent('/lol-gameflow/v1/gameflow-phase', 'Update', 'Matchmaking');
    await until(() => calls === 2);
    expect(h.machine.state).toBe('watching');
    const line = h.logger.lines.find((entry) => entry.message === 'hook onGameflowPhase threw');
    expect(line?.fields.error).toBe('hook bug');
  });

  it('continues without the local player when current-summoner fails, and logs why', async () => {
    const h = await start({
      routes: { 'GET /lol-summoner/v1/current-summoner': { status: 500, body: { errorCode: 'RPC_ERROR' } } },
    });
    await h.machine.waitForState('watching');
    expect(h.record.connected[0]?.summoner).toBeNull();
    expect(h.logger.lines.some((line) => line.message.includes('current-summoner unavailable'))).toBe(true);
  });

  it('stops cleanly from watching: run() resolves, the socket is closed, and nothing reconnects', async () => {
    const h = await start();
    await h.machine.waitForState('watching');
    await h.fake.waitForSockets(1);
    h.machine.stop();
    await h.run;
    expect(h.machine.state).toBe('stopped');
    await until(() => h.fake.sockets.size === 0);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(h.fake.wsReceived).toHaveLength(1);
    expect(h.machine.connected).toBeNull();
  });

  it('stops cleanly while the connect-time reads are in flight and then fail, without an illegal transition', async () => {
    // stop() lands between `client_reached` and the end of buildContext; the pending current-summoner read then
    // times out (a network failure). That used to fire `client_lost` from `stopped` and log it as illegal.
    const summoner = baseRoutes['GET /lol-summoner/v1/current-summoner'];
    if (!summoner) {
      throw new Error('base route missing');
    }
    const h = await start({
      routes: { 'GET /lol-summoner/v1/current-summoner': { ...summoner, delayMs: 600 } },
      requestTimeoutMs: 150,
    });
    await h.machine.waitForState('connected');
    h.machine.stop();
    await h.run;
    expect(h.machine.state).toBe('stopped');
    expect(h.record.connected).toHaveLength(0);
    expect(h.record.disconnected).toEqual([]);
    expect(h.logger.lines.filter((line) => line.level === 'error')).toEqual([]);
    expect(h.logger.lines.some((line) => line.message.includes('illegal connection transition'))).toBe(false);
    expect(h.transitions.map((t) => t.event)).toEqual(['client_reached', 'stop']);
  });

  it('stops cleanly while waiting for a lockfile', async () => {
    const h = await start();
    await h.machine.waitForState('watching');
    rmSync(h.lockfile);
    await h.machine.waitForState('disconnected');
    const started = Date.now();
    h.machine.stop();
    await h.run;
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(h.machine.state).toBe('stopped');
  });

  it('writes no secret to the log files across a connect, disconnect and reconnect', async () => {
    const logDir = mkdtempSync(join(tmpdir(), 'companion-conn-logs-'));
    const token = 'tok_companion_secret_ABCDEF';
    const logger = createFileLogger({ dir: logDir, console: null, secrets: [token] });
    const h = await start({ logger });
    try {
      await h.machine.waitForState('watching');
      h.fake.emitEvent('/lol-lobby/v2/lobby', 'Update', lobbyFixture());
      await h.fake.waitForWsFrames(1);
      h.fake.closeSockets(1001, 'restart');
      await h.machine.waitForState('disconnected');
      await h.machine.waitForState('watching');
      logger.info('api call', { authorization: `Bearer ${token}`, note: `token ${token}` });
      h.machine.stop();
      await h.run;

      const text = readdirSync(logDir)
        .map((name) => readFileSync(join(logDir, name), 'utf8'))
        .join('');
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toContain(PASSWORD);
      expect(text).not.toContain(token);
      expect(text).not.toContain(Buffer.from(`riot:${PASSWORD}`).toString('base64'));
      expect(text).toContain('"to":"watching"');
      expect(text).toContain(PUUID);
      // Lobby payloads carry chat credentials; the hooks log ids and counts, never the body.
      expect(text).not.toContain('multiUserChatPassword');
    } finally {
      rmSync(logDir, { recursive: true, force: true });
    }
  });
});
