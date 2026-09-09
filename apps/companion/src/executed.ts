/**
 * The execute-once record (M4.1): `<configDir>/commands-done.json`, every command this companion has finished,
 * with the outcome it will re-ack from. Written **after the client call returns and before the ack POST**, so a
 * lost ack is re-sent from here on the next poll and the client is never asked twice. The one hole is a process
 * killed between the client call and this write; the read-before-write executors in `commandRunner.ts` are
 * what make that harmless.
 *
 * File: `{ version: 1, entries: [{ id, kind, at, outcome, result?, error? }] }`, capped at `MAX_ENTRIES` (200,
 * oldest dropped), entries older than `MAX_AGE_MS` (24 h) dropped on write, tmp-file-and-rename like the
 * end-of-game queue. A file that does not parse is logged once and started over: the worst case is one
 * re-execution that the executors' lobby read turns into a no-op.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { type CompanionLogger, createMemoryLogger, errorFields } from './log.js';

export const EXECUTED_FILE = 'commands-done.json';
export const EXECUTED_FILE_VERSION = 1;
export const MAX_ENTRIES = 200;
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const executedEntrySchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  /** ISO time of the client call's return (or of the refusal). */
  at: z.iso.datetime({ offset: true }),
  outcome: z.enum(['done', 'failed']),
  /** The kind's result, present on `done`. */
  result: z.record(z.string(), z.unknown()).optional(),
  /** The nack text, present on `failed`. */
  error: z.string().optional(),
});
export type ExecutedEntry = z.infer<typeof executedEntrySchema>;

export const executedFileSchema = z.object({
  version: z.literal(EXECUTED_FILE_VERSION),
  entries: z.array(executedEntrySchema),
});
export type ExecutedFile = z.infer<typeof executedFileSchema>;

export function executedFilePath(configDir: string): string {
  return join(configDir, EXECUTED_FILE);
}

export interface ExecutedStoreOptions {
  readonly configDir: string;
  readonly logger?: CompanionLogger;
  readonly now?: () => number;
  readonly maxEntries?: number;
  readonly maxAgeMs?: number;
}

export class ExecutedStore {
  readonly path: string;
  private readonly logger: CompanionLogger;
  private readonly now: () => number;
  private readonly maxEntries: number;
  private readonly maxAgeMs: number;
  private entries: ExecutedEntry[] | null = null;

  constructor(options: ExecutedStoreOptions) {
    this.path = executedFilePath(options.configDir);
    this.logger = (options.logger ?? createMemoryLogger()).child({ component: 'commands-done' });
    this.now = options.now ?? Date.now;
    this.maxEntries = options.maxEntries ?? MAX_ENTRIES;
    this.maxAgeMs = options.maxAgeMs ?? MAX_AGE_MS;
  }

  /** The recorded outcome for a command id, or null when it has never finished here. */
  get(id: string): ExecutedEntry | null {
    return this.load().find((entry) => entry.id === id) ?? null;
  }

  has(id: string): boolean {
    return this.get(id) !== null;
  }

  /** Every entry, oldest first. Tests use it. */
  list(): readonly ExecutedEntry[] {
    return [...this.load()];
  }

  /**
   * Records an outcome and writes the file. Returns false (and logs) when the write failed: the caller still
   * acks, because the client call has already happened and the server must hear about it.
   */
  record(entry: ExecutedEntry): boolean {
    const entries = this.load().filter((existing) => existing.id !== entry.id);
    entries.push(entry);
    const cutoff = this.now() - this.maxAgeMs;
    const kept = entries.filter((existing) => Date.parse(existing.at) >= cutoff || existing.id === entry.id);
    const trimmed = kept.length > this.maxEntries ? kept.slice(kept.length - this.maxEntries) : kept;
    this.entries = trimmed;
    return this.write({ version: EXECUTED_FILE_VERSION, entries: trimmed });
  }

  private load(): ExecutedEntry[] {
    if (this.entries !== null) {
      return this.entries;
    }
    if (!existsSync(this.path)) {
      this.entries = [];
      return this.entries;
    }
    try {
      const parsed = executedFileSchema.safeParse(JSON.parse(readFileSync(this.path, 'utf8')));
      if (parsed.success) {
        this.entries = parsed.data.entries;
        return this.entries;
      }
      this.logger.warn('commands-done.json no longer parses; starting it over', {
        path: this.path,
        issues: parsed.error.issues
          .slice(0, 3)
          .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`),
      });
    } catch (error) {
      this.logger.warn('commands-done.json is unreadable; starting it over', {
        path: this.path,
        ...errorFields(error),
      });
    }
    this.entries = [];
    return this.entries;
  }

  private write(file: ExecutedFile): boolean {
    const tmp = `${this.path}.tmp`;
    try {
      mkdirSync(join(this.path, '..'), { recursive: true, mode: 0o700 });
      writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
      renameSync(tmp, this.path);
      return true;
    } catch (error) {
      this.logger.error('could not write commands-done.json; a lost ack may run this command again', {
        path: this.path,
        ...errorFields(error),
      });
      try {
        unlinkSync(tmp);
      } catch {
        // Nothing to clean up.
      }
      return false;
    }
  }
}
