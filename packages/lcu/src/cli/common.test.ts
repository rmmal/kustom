import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LockfileCredentials } from '../lockfile.js';
import { silentLogger } from '../log.js';
import { type FakeLcu, startFakeLcu } from '../test-support/fake-lcu.js';
import { probeTls, tlsModesToTry } from './common.js';

function credentials(port: number, password: string): LockfileCredentials {
  return { name: 'LeagueClient', pid: 1, port, password, protocol: 'https' };
}

describe('probeTls', () => {
  let fake: FakeLcu;

  beforeAll(async () => {
    fake = await startFakeLcu({
      routes: {
        'GET /lol-patch/v1/game-version': {
          status: 200,
          body: '"16.17.1.1"',
          contentType: 'application/json',
        },
      },
    });
  });

  afterAll(async () => {
    await fake.close();
  });

  it('tries strictest first and only steps down on a certificate failure', async () => {
    // The fake's certificate does not chain to Riot's root, so pinned and pinned+legacy fail with a TLS
    // error and the probe legitimately reaches insecure.
    const probe = await probeTls(credentials(fake.port, fake.password), {
      insecure: false,
      logger: silentLogger,
    });
    expect(probe.client).not.toBeNull();
    expect(probe.attempts.map((attempt) => attempt.ok)).toEqual([false, false, true]);
    expect(probe.attempts[0]?.outcome).toMatch(/SELF_SIGNED|UNABLE_TO_VERIFY|CERT/);
    if (probe.client) {
      expect(probe.mode).toEqual({ mode: 'insecure' });
      expect(probe.versionResponse.status).toBe(200);
      probe.client.close();
    }
  });

  it('stops at the first non-TLS failure instead of stepping down to insecure', async () => {
    const probe = await probeTls(credentials(1, 'x'), { insecure: false, logger: silentLogger });
    expect(probe.client).toBeNull();
    expect(probe.attempts).toHaveLength(1);
    expect(probe.attempts[0]?.mode).toEqual({ mode: 'pinned' });
    expect(probe.attempts[0]?.outcome).toContain('ECONNREFUSED');
  });

  it('does not count a timeout as a reason to loosen TLS', async () => {
    const slow = await startFakeLcu({
      routes: { 'GET /lol-patch/v1/game-version': { status: 200, body: {}, delayMs: 10_000 } },
    });
    try {
      // Insecure only, so the very first attempt reaches the server and then times out.
      const started = Date.now();
      const probe = await probeTls(credentials(slow.port, slow.password), {
        insecure: true,
        logger: silentLogger,
      });
      expect(probe.client).toBeNull();
      expect(probe.attempts).toHaveLength(1);
      expect(probe.attempts[0]?.outcome).toContain('ETIMEDOUT');
      expect(Date.now() - started).toBeLessThan(9000);
    } finally {
      await slow.close();
    }
  }, 15_000);

  it('offers exactly one mode with --insecure', () => {
    expect(tlsModesToTry(true)).toEqual([{ mode: 'insecure' }]);
    expect(tlsModesToTry(false).map((mode) => mode.mode)).toEqual(['pinned', 'pinned', 'insecure']);
  });
});
