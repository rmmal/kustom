import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LogFields, Logger } from './log.js';
import {
  ALL_EVENTS_TOPIC,
  type LcuEvent,
  LcuSocket,
  type LcuSocketCloseInfo,
  type LcuSocketDroppedFrame,
  parseFrame,
  subscribeMessage,
  topicForUri,
  unsubscribeMessage,
} from './socket.js';
import { type FakeLcu, startFakeLcu } from './test-support/fake-lcu.js';

function once<T>(register: (handler: (value: T) => void) => void, timeoutMs = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for event')), timeoutMs);
    register((value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

describe('frame helpers', () => {
  it('builds subscribe and unsubscribe frames', () => {
    expect(subscribeMessage()).toBe('[5,"OnJsonApiEvent"]');
    expect(subscribeMessage('OnJsonApiEvent_lol-lobby_v2_lobby')).toBe(
      '[5,"OnJsonApiEvent_lol-lobby_v2_lobby"]',
    );
    expect(unsubscribeMessage()).toBe('[6,"OnJsonApiEvent"]');
  });

  it('derives a topic from a URI', () => {
    expect(topicForUri('/lol-lobby/v2/lobby')).toBe('OnJsonApiEvent_lol-lobby_v2_lobby');
    expect(topicForUri('/lol-gameflow/v1/gameflow-phase')).toBe(
      'OnJsonApiEvent_lol-gameflow_v1_gameflow-phase',
    );
    expect(ALL_EVENTS_TOPIC).toBe('OnJsonApiEvent');
  });

  it('parses a valid event frame', () => {
    const raw = JSON.stringify([
      8,
      'OnJsonApiEvent',
      { data: { partyId: 'p1' }, eventType: 'Update', uri: '/lol-lobby/v2/lobby' },
    ]);
    expect(parseFrame(raw)).toEqual({
      kind: 'event',
      event: {
        topic: 'OnJsonApiEvent',
        uri: '/lol-lobby/v2/lobby',
        eventType: 'Update',
        data: { partyId: 'p1' },
      },
    });
  });

  it('accepts buffers and buffer arrays', () => {
    const raw = JSON.stringify([8, 't', { data: null, eventType: 'Delete', uri: '/x' }]);
    expect(parseFrame(Buffer.from(raw)).kind).toBe('event');
    expect(parseFrame([Buffer.from(raw.slice(0, 5)), Buffer.from(raw.slice(5))]).kind).toBe('event');
    expect(parseFrame(new TextEncoder().encode(raw).buffer as ArrayBuffer).kind).toBe('event');
  });

  it('treats empty frames as empty, not malformed', () => {
    expect(parseFrame('')).toEqual({ kind: 'empty' });
    expect(parseFrame('  ')).toEqual({ kind: 'empty' });
  });

  it('drops malformed frames with a reason', () => {
    const cases: [string, RegExp][] = [
      ['not json', /invalid JSON/],
      ['{"a":1}', /<root>/],
      ['[5,"OnJsonApiEvent"]', /./],
      ['[9,"t",{"data":1,"eventType":"Update","uri":"/x"}]', /^0: /],
      ['[8,"t",{"data":1,"eventType":"Upsert","uri":"/x"}]', /eventType/],
      ['[8,"t",{"data":1,"eventType":"Update"}]', /uri/],
      ['[8,"t",{"eventType":"Update","uri":"/x"}]', /./],
    ];
    for (const [raw, pattern] of cases) {
      const result = parseFrame(raw);
      expect(result.kind, raw).toBe('malformed');
      if (result.kind === 'malformed') {
        expect(result.reason, raw).toMatch(pattern);
        expect(result.raw).toBe(raw);
      }
    }
  });

  it('allows data to be absent only as an explicit undefined-free payload', () => {
    // `data` is required on the wire; a frame with `data: null` is still an event.
    const result = parseFrame('[8,"t",{"data":null,"eventType":"Create","uri":"/x"}]');
    expect(result.kind).toBe('event');
  });
});

describe('LcuSocket', () => {
  let fake: FakeLcu;
  const logs: { level: string; message: string; fields?: LogFields }[] = [];
  const logger: Logger = {
    debug: (message, fields) =>
      logs.push(fields ? { level: 'debug', message, fields } : { level: 'debug', message }),
    info: (message, fields) =>
      logs.push(fields ? { level: 'info', message, fields } : { level: 'info', message }),
    warn: (message, fields) =>
      logs.push(fields ? { level: 'warn', message, fields } : { level: 'warn', message }),
    error: (message, fields) =>
      logs.push(fields ? { level: 'error', message, fields } : { level: 'error', message }),
  };

  beforeAll(async () => {
    fake = await startFakeLcu();
  });

  afterAll(async () => {
    await fake.close();
  });

  function makeSocket(): LcuSocket {
    return new LcuSocket({
      port: fake.port,
      password: fake.password,
      tls: { mode: 'pinned', ca: fake.ca },
      logger,
    });
  }

  it('connects with Basic auth and sends remembered subscriptions on open', async () => {
    const socket = makeSocket();
    socket.subscribe();
    socket.subscribe(topicForUri('/lol-gameflow/v1/gameflow-phase'));
    await socket.connect();
    expect(socket.isOpen).toBe(true);

    const upgrade = fake.requests.find((request) => request.method === 'WS');
    expect(upgrade?.authorization).toBe(`Basic ${Buffer.from(`riot:${fake.password}`).toString('base64')}`);

    const frames = await fake.waitForWsFrames(2);
    expect(frames).toEqual(['[5,"OnJsonApiEvent"]', '[5,"OnJsonApiEvent_lol-gameflow_v1_gameflow-phase"]']);
    expect(socket.subscriptions).toEqual(['OnJsonApiEvent', 'OnJsonApiEvent_lol-gameflow_v1_gameflow-phase']);

    const closed = once<LcuSocketCloseInfo>((handler) => socket.once('close', handler));
    socket.close();
    expect((await closed).code).toBe(1000);
    expect(socket.isOpen).toBe(false);
  });

  it('subscribes immediately when already open, and unsubscribes', async () => {
    const socket = makeSocket();
    await socket.connect();
    const before = fake.wsReceived.length;
    socket.subscribe('OnJsonApiEvent_lol-lobby_v2_lobby');
    socket.unsubscribe('OnJsonApiEvent_lol-lobby_v2_lobby');
    const frames = await fake.waitForWsFrames(before + 2);
    expect(frames.slice(before)).toEqual([
      '[5,"OnJsonApiEvent_lol-lobby_v2_lobby"]',
      '[6,"OnJsonApiEvent_lol-lobby_v2_lobby"]',
    ]);
    expect(socket.subscriptions).toEqual([]);
    socket.close();
  });

  it('emits typed events and drops malformed frames', async () => {
    const socket = makeSocket();
    socket.subscribe();
    await socket.connect();
    await fake.waitForSockets(1);

    const dropped = once<LcuSocketDroppedFrame>((handler) => socket.once('dropped', handler));
    fake.broadcast('[8,"OnJsonApiEvent",{"eventType":"Bogus","uri":"/x","data":1}]');
    const droppedFrame = await dropped;
    expect(droppedFrame.reason).toContain('eventType');
    expect(logs.some((entry) => entry.level === 'warn' && entry.message === 'lcu socket dropped frame')).toBe(
      true,
    );

    // A refused frame that carries a credential is logged scrubbed, never raw.
    const droppedSecret = once<LcuSocketDroppedFrame>((handler) => socket.once('dropped', handler));
    fake.broadcast(
      '[8,"OnJsonApiEvent",{"eventType":"Bogus","uri":"/x","data":{"password":"hunter2-secret","ok":1}}]',
    );
    await droppedSecret;
    fake.broadcast('not json at all password=plaintext-secret-value');
    await once<LcuSocketDroppedFrame>((handler) => socket.once('dropped', handler));
    const droppedLogs = logs.filter((entry) => entry.message === 'lcu socket dropped frame');
    expect(droppedLogs.length).toBeGreaterThanOrEqual(3);
    const logText = JSON.stringify(droppedLogs);
    expect(logText).not.toContain('hunter2-secret');
    expect(logText).not.toContain('plaintext-secret-value');
    expect(logText).toContain('[redacted]');

    const received = once<LcuEvent>((handler) => socket.once('event', handler));
    fake.emitEvent('/lol-gameflow/v1/gameflow-phase', 'Update', 'Lobby');
    expect(await received).toEqual({
      topic: 'OnJsonApiEvent',
      uri: '/lol-gameflow/v1/gameflow-phase',
      eventType: 'Update',
      data: 'Lobby',
    });

    // An empty frame (the client sends one after subscribing) is neither an event nor a drop.
    let counted = 0;
    socket.on('event', () => {
      counted += 1;
    });
    socket.on('dropped', () => {
      counted += 1;
    });
    fake.broadcast('');
    fake.broadcast('not json');
    const secondDrop = once<LcuSocketDroppedFrame>((handler) => socket.once('dropped', handler));
    await secondDrop;
    expect(counted).toBe(1);

    socket.close();
  });

  it('reports a server-side close and re-sends subscriptions on the next connect', async () => {
    const socket = makeSocket();
    socket.subscribe();
    await socket.connect();
    await fake.waitForSockets(1);
    const before = fake.wsReceived.length;

    const closed = once<LcuSocketCloseInfo>((handler) => socket.once('close', handler));
    fake.closeSockets(1001, 'client exiting');
    const info = await closed;
    expect(info.code).toBe(1001);
    expect(info.reason).toBe('client exiting');
    expect(socket.isOpen).toBe(false);

    // Same instance, reconnect: the subscription set survives.
    await socket.connect();
    const frames = await fake.waitForWsFrames(before + 1);
    expect(frames.at(-1)).toBe('[5,"OnJsonApiEvent"]');
    socket.close();
  });

  it('rejects connect() when the client is not there, without throwing elsewhere', async () => {
    const socket = new LcuSocket({ port: 1, password: 'x', tls: { mode: 'insecure' } });
    await expect(socket.connect()).rejects.toThrow();
    expect(socket.isOpen).toBe(false);
  });

  it('rejects connect() when the certificate does not chain to the pinned root', async () => {
    const socket = new LcuSocket({ port: fake.port, password: fake.password });
    await expect(socket.connect()).rejects.toThrow();
  });

  it('rejects connect() on bad auth', async () => {
    const socket = new LcuSocket({
      port: fake.port,
      password: 'wrong',
      tls: { mode: 'pinned', ca: fake.ca },
    });
    await expect(socket.connect()).rejects.toThrow();
  });
});
