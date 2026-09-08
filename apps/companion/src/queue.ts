/**
 * The durable end-of-game queue (M2.3): one file per `gameId` under `<configDir>/queue/`, written before the
 * first POST and deleted only once the server has the game (a 2xx) or has refused it for good (a permanent
 * 4xx). A crash, a closed laptop lid or an API that is down for the two minutes that matter loses nothing:
 * the next start replays whatever is here.
 *
 * File: `<gameId>.json`, holding `{ version: 1, queuedAt, payload }` where `payload` is the exact request
 * body of `POST /api/companion/game`. Written as `<gameId>.json.tmp` and renamed so a half-written file is
 * never mistaken for a queued game; owner-only permissions (Windows ignores the mode). Only digits are
 * allowed in a name. The directory is capped at `MAX_QUEUED_GAMES` files: over that the oldest `queuedAt`
 * is deleted with a log line rather than filling a friend's disk. A file that no longer parses is logged
 * once and deleted.
 *
 * Nothing here talks to the API or the client; `gameWatcher.ts` does the posting.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { type CompanionGamePayloadInput, companionGamePayloadSchema } from '@customs/db/schemas';
import { z } from 'zod';
import { type CompanionLogger, createMemoryLogger, errorFields } from './log.js';

export const QUEUE_DIR_NAME = 'queue';
export const QUEUE_FILE_VERSION = 1;
/** The cap on files in the queue directory. */
export const MAX_QUEUED_GAMES = 50;

const FILE_PATTERN = /^(\d+)\.json$/;

export const queueEntrySchema = z.object({
  version: z.literal(QUEUE_FILE_VERSION),
  queuedAt: z.iso.datetime({ offset: true }),
  /** Validated with the wire schema so a file that would be refused as malformed is never re-posted. */
  payload: companionGamePayloadSchema,
});

export interface QueuedGame {
  /** Decimal digits, as in the file name. */
  readonly gameId: string;
  readonly queuedAt: string;
  /** The exact request body, as written (not the parsed/transformed form). */
  readonly payload: CompanionGamePayloadInput;
  readonly path: string;
}

export function queueDir(configDir: string): string {
  return join(configDir, QUEUE_DIR_NAME);
}

/** The digits-only file stem for a game id, or null when the id is not a positive integer. */
export function queueFileStem(gameId: number | string): string | null {
  const text = typeof gameId === 'number' ? String(gameId) : gameId;
  return /^\d+$/.test(text) && Number.isSafeInteger(Number(text)) && Number(text) > 0 ? text : null;
}

export interface GameQueueOptions {
  readonly configDir: string;
  readonly logger?: CompanionLogger;
  readonly maxFiles?: number;
}

export class GameQueue {
  readonly dir: string;
  private readonly logger: CompanionLogger;
  private readonly maxFiles: number;

  constructor(options: GameQueueOptions) {
    this.dir = queueDir(options.configDir);
    this.logger = (options.logger ?? createMemoryLogger()).child({ component: 'queue' });
    this.maxFiles = options.maxFiles ?? MAX_QUEUED_GAMES;
  }

  pathFor(gameId: string): string {
    return join(this.dir, `${gameId}.json`);
  }

  /** True when a file for this game is on disk (the third dedupe layer). */
  has(gameId: number | string): boolean {
    const stem = queueFileStem(gameId);
    return stem !== null && existsSync(this.pathFor(stem));
  }

  /**
   * Writes the file (tmp + rename, owner-only). Returns the entry, or null when the id is not digits, the
   * payload does not pass the wire schema, or the write failed; every refusal is one log line. Never throws.
   */
  write(payload: CompanionGamePayloadInput, queuedAt: string): QueuedGame | null {
    const stem = queueFileStem(payload.gameId);
    if (stem === null) {
      this.logger.warn('game not queued: its id is not a positive integer', {
        gameId: String(payload.gameId),
      });
      return null;
    }
    const check = queueEntrySchema.safeParse({ version: QUEUE_FILE_VERSION, queuedAt, payload });
    if (!check.success) {
      this.logger.warn('game not queued: the payload does not pass the wire schema', {
        gameId: stem,
        issues: check.error.issues
          .slice(0, 5)
          .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`),
      });
      return null;
    }
    const path = this.pathFor(stem);
    const tmp = `${path}.tmp`;
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      const body = `${JSON.stringify({ version: QUEUE_FILE_VERSION, queuedAt, payload }, null, 2)}\n`;
      writeFileSync(tmp, body, { mode: 0o600 });
      renameSync(tmp, path);
    } catch (error) {
      this.logger.error('game not queued: could not write the queue file', {
        gameId: stem,
        path,
        ...errorFields(error),
      });
      try {
        unlinkSync(tmp);
      } catch {
        // Nothing to clean up.
      }
      return null;
    }
    this.logger.info('game queued on disk', { gameId: stem, path });
    this.enforceCap();
    return { gameId: stem, queuedAt, payload, path };
  }

  /** Deletes the file for a game. A file that is already gone is not an error. */
  delete(gameId: string): void {
    try {
      unlinkSync(this.pathFor(gameId));
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if (code !== 'ENOENT') {
        this.logger.warn('could not delete a queue file', { gameId, ...errorFields(error) });
      }
    }
  }

  /**
   * Every queued game, oldest `queuedAt` first. Files that do not parse are logged and deleted on the way
   * past; stray `.tmp` files from an interrupted write are removed. Then the cap is applied.
   */
  list(): QueuedGame[] {
    let names: string[];
    try {
      names = readdirSync(this.dir);
    } catch {
      return [];
    }
    const entries: QueuedGame[] = [];
    for (const name of names) {
      if (name.endsWith('.json.tmp')) {
        this.remove(join(this.dir, name));
        continue;
      }
      const match = FILE_PATTERN.exec(name);
      if (match === null) {
        continue;
      }
      const gameId = match[1] as string;
      const path = join(this.dir, name);
      const entry = this.read(gameId, path);
      if (entry !== null) {
        entries.push(entry);
      }
    }
    entries.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt) || a.gameId.localeCompare(b.gameId));
    return this.applyCap(entries);
  }

  private read(gameId: string, path: string): QueuedGame | null {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      this.logger.warn('queue file is not JSON; deleting it (the game is left to backfill)', {
        gameId,
        path,
        ...errorFields(error),
      });
      this.remove(path);
      return null;
    }
    const parsed = queueEntrySchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.warn('queue file no longer parses; deleting it (the game is left to backfill)', {
        gameId,
        path,
        issues: parsed.error.issues
          .slice(0, 5)
          .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`),
      });
      this.remove(path);
      return null;
    }
    // Keep the body as written: the wire schema's transforms belong to the server side of the contract.
    const payload = (raw as { payload: CompanionGamePayloadInput }).payload;
    if (String(payload.gameId) !== gameId) {
      this.logger.warn('queue file name does not match its gameId; deleting it', {
        gameId,
        inner: String(payload.gameId),
      });
      this.remove(path);
      return null;
    }
    return { gameId, queuedAt: parsed.data.queuedAt, payload, path };
  }

  private enforceCap(): void {
    this.list();
  }

  private applyCap(entries: QueuedGame[]): QueuedGame[] {
    const excess = entries.length - this.maxFiles;
    if (excess <= 0) {
      return entries;
    }
    const dropped = entries.splice(0, excess);
    for (const entry of dropped) {
      this.logger.warn('queue is over its cap; deleting the oldest queued game (left to backfill)', {
        gameId: entry.gameId,
        queuedAt: entry.queuedAt,
        cap: this.maxFiles,
      });
      this.remove(entry.path);
    }
    return entries;
  }

  private remove(path: string): void {
    try {
      unlinkSync(path);
    } catch {
      // Already gone, or not ours to delete; the next listing tries again.
    }
  }
}
