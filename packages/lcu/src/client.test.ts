import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LcuClient, parseBody } from './client.js';
import type { LogFields, Logger } from './log.js';
import { type FakeLcu, readTestCert, startFakeLcu } from './test-support/fake-lcu.js';

function recordingLogger(): Logger & { entries: { level: string; message: string; fields?: LogFields }[] } {
  const entries: { level: string; message: string; fields?: LogFields }[] = [];
  const push = (level: string) => (message: string, fields?: LogFields) => {
    entries.push(fields ? { level, message, fields } : { level, message });
  };
  return { entries, debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') };
}

const routes = {
  'GET /lol-summoner/v1/current-summoner': {
    status: 200,
    body: { puuid: 'abc-123', summonerId: 42, gameName: 'Name', tagLine: 'TAG' },
  },
  'GET /list': { status: 200, body: [{ gameId: 1 }, { gameId: 2 }] },
  'GET /html': { status: 200, body: '<html>not json</html>', contentType: 'text/html' },
  'GET /empty': { status: 204, body: '' },
  'GET /lol-lobby/v2/lobby': {
    status: 404,
    body: { errorCode: 'RPC_ERROR', httpStatus: 404, message: 'No lobby' },
  },
  'GET /broken-404': { status: 404, body: 'gone', contentType: 'text/plain' },
  'POST /echo': { status: 200, body: { echoed: true } },
  'GET /slow': { status: 200, body: {}, delayMs: 400 },
} as const;

describe('LcuClient', () => {
  let fake: FakeLcu;
  let client: LcuClient;
  let logger: ReturnType<typeof recordingLogger>;

  beforeAll(async () => {
    fake = await startFakeLcu({ routes });
    logger = recordingLogger();
    client = new LcuClient({
      port: fake.port,
      password: fake.password,
      tls: { mode: 'pinned', ca: fake.ca },
      logger,
    });
  });

  afterAll(async () => {
    client.close();
    await fake.close();
  });

  it('sends Basic auth for riot:<password> and an Accept header', async () => {
    const result = await client.get('/lol-summoner/v1/current-summoner', z.object({ puuid: z.string() }));
    expect(result.ok).toBe(true);
    const last = fake.requests.at(-1);
    expect(last?.authorization).toBe(`Basic ${Buffer.from(`riot:${fake.password}`).toString('base64')}`);
    expect(last?.method).toBe('GET');
    expect(last?.path).toBe('/lol-summoner/v1/current-summoner');
  });

  it('returns typed JSON on 2xx when the schema matches', async () => {
    const schema = z.object({ puuid: z.string(), summonerId: z.number() });
    const result = await client.get('/lol-summoner/v1/current-summoner', schema);
    expect(result).toEqual({ ok: true, status: 200, json: { puuid: 'abc-123', summonerId: 42 } });
  });

  it('returns a schema failure with issues, and logs the endpoint, on a shape mismatch', async () => {
    logger.entries.length = 0;
    const result = await client.get('/lol-summoner/v1/current-summoner', z.object({ puuid: z.number() }));
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === 'schema') {
      expect(result.status).toBe(200);
      expect(result.issues[0]).toMatch(/^puuid: /);
      expect(result.json).toMatchObject({ puuid: 'abc-123' });
    } else {
      throw new Error(`expected schema failure, got ${JSON.stringify(result)}`);
    }
    const warning = logger.entries.find((entry) => entry.level === 'warn');
    expect(warning?.fields?.endpoint).toBe('GET /lol-summoner/v1/current-summoner');
  });

  it('returns an http failure with the parsed body on 404', async () => {
    const result = await client.get('/lol-lobby/v2/lobby', z.unknown());
    expect(result).toEqual({
      ok: false,
      reason: 'http',
      status: 404,
      json: { errorCode: 'RPC_ERROR', httpStatus: 404, message: 'No lobby' },
    });
  });

  it('returns the raw text on a non-JSON error body', async () => {
    const result = await client.get('/broken-404', z.unknown());
    expect(result).toEqual({ ok: false, reason: 'http', status: 404, json: 'gone' });
  });

  it('returns a malformed failure on a 2xx non-JSON body', async () => {
    const result = await client.get('/html', z.unknown());
    expect(result).toEqual({ ok: false, reason: 'malformed', status: 200, text: '<html>not json</html>' });
  });

  it('treats an empty 204 body as null', async () => {
    const result = await client.get('/empty', z.null());
    expect(result).toEqual({ ok: true, status: 204, json: null });
  });

  it('parses arrays', async () => {
    const result = await client.get('/list', z.array(z.object({ gameId: z.number() })));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.json).toHaveLength(2);
    }
  });

  it('posts a JSON body with the right content type', async () => {
    const result = await client.post('/echo', { toSummonerId: 42 }, z.object({ echoed: z.boolean() }));
    expect(result).toEqual({ ok: true, status: 200, json: { echoed: true } });
    const last = fake.requests.at(-1);
    expect(last?.method).toBe('POST');
    expect(last?.contentType).toBe('application/json');
    expect(JSON.parse(last?.body ?? '')).toEqual({ toSummonerId: 42 });
  });

  it('gets a 401 http failure with the wrong password', async () => {
    const wrong = new LcuClient({ port: fake.port, password: 'nope', tls: { mode: 'pinned', ca: fake.ca } });
    const result = await wrong.get('/lol-summoner/v1/current-summoner', z.unknown());
    wrong.close();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('http');
      expect(result.status).toBe(401);
    }
  });

  it('returns a network failure, not a throw, when nothing listens', async () => {
    const dead = new LcuClient({ port: 1, password: 'x', tls: { mode: 'insecure' } });
    const result = await dead.get('/anything', z.unknown());
    dead.close();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('network');
      expect(result.status).toBe(0);
      if (result.reason === 'network') {
        expect(result.code).toBe('ECONNREFUSED');
      }
    }
  });

  it('times out as a network failure', async () => {
    const impatient = new LcuClient({
      port: fake.port,
      password: fake.password,
      tls: { mode: 'pinned', ca: fake.ca },
      timeoutMs: 50,
    });
    const result = await impatient.get('/slow', z.unknown());
    impatient.close();
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === 'network') {
      expect(result.code).toBe('ETIMEDOUT');
    } else {
      throw new Error(`expected timeout, got ${JSON.stringify(result)}`);
    }
  });

  it('rejects relative paths without a request', async () => {
    const result = await client.get('relative', z.unknown());
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === 'network') {
      expect(result.code).toBe('ERR_LCU_BAD_PATH');
    }
  });

  it('exposes the raw response for the smoke script', async () => {
    const raw = await client.raw('GET', '/lol-lobby/v2/lobby');
    expect(raw.kind).toBe('response');
    if (raw.kind === 'response') {
      expect(raw.status).toBe(404);
      expect(raw.contentType).toContain('application/json');
      expect(raw.body).toEqual({
        parsed: true,
        value: { errorCode: 'RPC_ERROR', httpStatus: 404, message: 'No lobby' },
      });
    }
  });
});

describe('LcuClient TLS modes', () => {
  let fake: FakeLcu;

  beforeAll(async () => {
    fake = await startFakeLcu({ routes });
  });

  afterAll(async () => {
    await fake.close();
  });

  it('pinned mode rejects a certificate that does not chain to the pinned root', async () => {
    const client = new LcuClient({
      port: fake.port,
      password: fake.password,
      tls: { mode: 'pinned', ca: readTestCert('other-ca') },
    });
    const result = await client.get('/list', z.unknown());
    client.close();
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === 'network') {
      expect(result.code).toMatch(/SELF_SIGNED|UNABLE_TO_VERIFY|CERT/);
    } else {
      throw new Error(`expected a TLS failure, got ${JSON.stringify(result)}`);
    }
    // Pinning fails before any request reaches the server.
    expect(fake.requests).toHaveLength(0);
  });

  it('the default pinned mode (Riot root) also rejects the fake, proving the pin is not a no-op', async () => {
    const client = new LcuClient({ port: fake.port, password: fake.password });
    const result = await client.get('/list', z.unknown());
    client.close();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('network');
    }
  });

  it('insecure mode accepts any certificate on loopback', async () => {
    const client = new LcuClient({ port: fake.port, password: fake.password, tls: { mode: 'insecure' } });
    const result = await client.get('/list', z.array(z.unknown()));
    client.close();
    expect(result.ok).toBe(true);
  });

  it('pinned mode with legacy digests still verifies the chain', async () => {
    const client = new LcuClient({
      port: fake.port,
      password: fake.password,
      tls: { mode: 'pinned', ca: fake.ca, legacyDigests: true },
    });
    const result = await client.get('/list', z.array(z.unknown()));
    client.close();
    expect(result.ok).toBe(true);
  });
});

describe('parseBody', () => {
  it('maps empty to null, JSON to its value and anything else to an error', () => {
    expect(parseBody('')).toEqual({ parsed: true, value: null });
    expect(parseBody('  \n')).toEqual({ parsed: true, value: null });
    expect(parseBody('"16.17.1"')).toEqual({ parsed: true, value: '16.17.1' });
    expect(parseBody('{"a":1}')).toEqual({ parsed: true, value: { a: 1 } });
    const bad = parseBody('{nope');
    expect(bad.parsed).toBe(false);
  });
});
