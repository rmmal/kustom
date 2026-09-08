/**
 * Exponential backoff with jitter, and an abortable sleep.
 *
 * Used for every "try again later" in the companion: reconnecting to the client after the socket drops, and
 * re-sending an API call after a network error or a 5xx. Nothing here ever gives up; the caller decides
 * how many attempts it wants (the API client) or loops forever (the connection machine).
 */

export interface BackoffOptions {
  /** First delay. Default 1 s. */
  readonly minMs?: number;
  /** Ceiling. Default 60 s. */
  readonly maxMs?: number;
  /** Growth per attempt. Default 2. */
  readonly factor?: number;
  /** Injected in tests for a deterministic delay. Defaults to `Math.random`. */
  readonly random?: () => number;
}

export const DEFAULT_BACKOFF_MIN_MS = 1_000;
export const DEFAULT_BACKOFF_MAX_MS = 60_000;

/**
 * "Equal jitter": the delay for attempt `n` is uniformly drawn from `[base/2, base]` where
 * `base = min(max, min * factor^n)`. Never below `minMs`, never above `maxMs`.
 */
export class Backoff {
  private readonly minMs: number;
  private readonly maxMs: number;
  private readonly factor: number;
  private readonly random: () => number;
  private attempt = 0;

  constructor(options: BackoffOptions = {}) {
    this.minMs = options.minMs ?? DEFAULT_BACKOFF_MIN_MS;
    this.maxMs = options.maxMs ?? DEFAULT_BACKOFF_MAX_MS;
    this.factor = options.factor ?? 2;
    this.random = options.random ?? Math.random;
  }

  /** Attempts taken since the last `reset()`. */
  get attempts(): number {
    return this.attempt;
  }

  /** The next delay in milliseconds; advances the attempt counter. */
  next(): number {
    const base = Math.min(this.maxMs, this.minMs * this.factor ** this.attempt);
    this.attempt += 1;
    const jittered = base / 2 + this.random() * (base / 2);
    return Math.round(Math.min(this.maxMs, Math.max(this.minMs, jittered)));
  }

  reset(): void {
    this.attempt = 0;
  }
}

/**
 * Resolves after `ms`, or as soon as `signal` aborts (resolving, not rejecting: an aborted wait is a normal
 * shutdown, not an error). A zero or negative delay resolves on the next tick.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(
      () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      },
      Math.max(0, ms),
    );
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
