import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET } from './route';

/**
 * The nightly post's door (M3.5). The post itself is `postNightlyLeaderboard`, which is
 * `loadBoard` plus the pure `leaderboardEmbed` — both covered elsewhere; this is only about
 * who gets in, and it is deliberately the same shape as `GET /api/cron/sweep`.
 */

function get(authorization?: string): Request {
  return new Request('http://localhost/api/cron/leaderboard', {
    headers: authorization === undefined ? {} : { authorization },
  });
}

describe('GET /api/cron/leaderboard', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
    process.env.CRON_SECRET = '';
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it('is closed when no secret is configured, rather than open', async () => {
    const response = await GET(get('Bearer anything'));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      error: 'the leaderboard post is not configured',
    });
  });

  it('answers 401 without a bearer token', async () => {
    process.env.CRON_SECRET = 'secret-value';

    const missing = await GET(get());
    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({ ok: false, error: 'missing bearer token' });

    const wrongScheme = await GET(get('Basic secret-value'));
    expect(wrongScheme.status).toBe(401);
  });

  it('answers 401 for the wrong secret', async () => {
    process.env.CRON_SECRET = 'secret-value';

    const response = await GET(get('Bearer not-the-secret'));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: 'bad cron secret' });
  });

  it('answers 500 when the process cannot reach the database at all', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = '';

    const response = await GET(get('Bearer secret-value'));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: 'server is not configured' });
  });
});
