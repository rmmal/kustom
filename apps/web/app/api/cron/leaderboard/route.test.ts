import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebhookOutcome } from '@/lib/discord/webhook';
import { GET } from './route';

/**
 * The post itself is mocked here on purpose: what it decides is covered by
 * `lib/discord/leaderboardPost.test.ts` (the three skip rules) and by the embed's snapshot.
 * What is only true at this seam is that the route hands a `WebhookOutcome` to the caller
 * unchanged — a scheduler that gets `{"ok":true}` and nothing else cannot tell a post from a
 * silence, and the first morning of a season is a silence on purpose.
 */
const outcome = vi.hoisted(() => ({
  value: { status: 'posted', httpStatus: 204, reason: null, attempts: 1 } as WebhookOutcome,
}));

vi.mock('@/lib/discord/post', () => ({
  postNightlyLeaderboard: async (): Promise<WebhookOutcome> => outcome.value,
}));

/**
 * The nightly post's door (M3.5) and the answer it gives a scheduler. Deliberately the same
 * shape as `GET /api/cron/sweep`.
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

  it('reports a post that landed', async () => {
    process.env.CRON_SECRET = 'secret-value';
    outcome.value = { status: 'posted', httpStatus: 204, reason: null, attempts: 1 };

    const response = await GET(get('Bearer secret-value'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: 'posted', reason: null });
  });

  it('reports the silence on the first morning of a season, and why', async () => {
    process.env.CRON_SECRET = 'secret-value';
    outcome.value = {
      status: 'skipped',
      httpStatus: null,
      reason: 'no games this season',
      attempts: 0,
    };

    const response = await GET(get('Bearer secret-value'));

    // 200: nothing went wrong. A scheduler is told what happened rather than left to guess
    // from a bare `ok`.
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      status: 'skipped',
      reason: 'no games this season',
    });
  });

  it('reports a webhook that would not take it, without ever naming the URL', async () => {
    process.env.CRON_SECRET = 'secret-value';
    outcome.value = { status: 'failed', httpStatus: 500, reason: 'HTTP 500', attempts: 2 };

    const response = await GET(get('Bearer secret-value'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, status: 'failed', reason: 'HTTP 500' });
    expect(JSON.stringify(body)).not.toContain('http');
  });
});
