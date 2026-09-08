import { describe, expect, it } from 'vitest';
import { Backoff, DEFAULT_BACKOFF_MAX_MS, DEFAULT_BACKOFF_MIN_MS, sleep } from './backoff.js';

describe('Backoff', () => {
  it('grows exponentially from 1 s and caps at 60 s with the defaults', () => {
    const backoff = new Backoff({ random: () => 1 });
    const delays = Array.from({ length: 8 }, () => backoff.next());
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000]);
    expect(backoff.attempts).toBe(8);
  });

  it('jitters within [base/2, base] and never below the minimum', () => {
    const low = new Backoff({ random: () => 0 });
    expect(low.next()).toBe(DEFAULT_BACKOFF_MIN_MS);
    expect(low.next()).toBe(1_000);
    expect(low.next()).toBe(2_000);
    const high = new Backoff({ random: () => 0.999 });
    for (let i = 0; i < 20; i += 1) {
      const delay = high.next();
      expect(delay).toBeGreaterThanOrEqual(DEFAULT_BACKOFF_MIN_MS);
      expect(delay).toBeLessThanOrEqual(DEFAULT_BACKOFF_MAX_MS);
    }
  });

  it('resets to the first delay', () => {
    const backoff = new Backoff({ random: () => 1, minMs: 10, maxMs: 100 });
    backoff.next();
    backoff.next();
    backoff.reset();
    expect(backoff.attempts).toBe(0);
    expect(backoff.next()).toBe(10);
  });
});

describe('sleep', () => {
  it('resolves early when the signal aborts', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const waiting = sleep(5_000, controller.signal);
    controller.abort();
    await waiting;
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('resolves immediately on an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await sleep(5_000, controller.signal);
  });
});
