/**
 * Structured logging for the companion.
 *
 * Every line is one JSON object appended to `<dir>/companion-<YYYY-MM-DD>.log` (daily rotation, oldest files
 * pruned so at most `keepDays` remain) and, when enabled, one human-readable line on the console. This is
 * the only file the companion writes besides its config (`docs/01-architecture.md` "Companion").
 *
 * Secrets never reach a line: fields are walked with `scrubValue` from `@customs/lcu` (credential-looking
 * keys become `[redacted]`), and every registered secret string (the companion token, the lockfile
 * password) is replaced wherever it appears in the serialised line, message included. A write that fails
 * (disk full, permissions) is reported once on the console and otherwise ignored; logging never throws.
 *
 * Implements the `Logger` contract from `@customs/lcu` so the client and socket log through the same file.
 */

import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { type LogFields, type Logger, REDACTED, scrubValue } from '@customs/lcu';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

/** Files older than this many days (by name) are deleted at rotation. */
export const DEFAULT_KEEP_DAYS = 14;

export const LOG_FILE_PREFIX = 'companion-';
const LOG_FILE_PATTERN = /^companion-(\d{4}-\d{2}-\d{2})\.log$/;

export interface CompanionLogger extends Logger {
  /** A logger that adds `fields` to every line. */
  child(fields: LogFields): CompanionLogger;
  /** Registers a string that must never appear in a log line. Short values are ignored. */
  addSecret(value: string): void;
  /** Path of the file lines are currently going to. */
  readonly currentFile: string | null;
}

export interface FileLoggerOptions {
  /** Directory for `companion-<date>.log`. Created on first write. Null disables the file entirely. */
  readonly dir: string | null;
  /** Minimum level written to the file. Default `debug`. */
  readonly fileLevel?: LogLevel;
  /** Minimum level echoed on the console. Default `info`. */
  readonly consoleLevel?: LogLevel;
  /** Where console lines go. Default `console.log` / `console.error`; tests capture. Null silences. */
  readonly console?: ((level: LogLevel, line: string) => void) | null;
  /** Injected clock. */
  readonly now?: () => Date;
  readonly keepDays?: number;
  /** Secrets known at construction. */
  readonly secrets?: readonly string[];
}

/** `2026-09-08` from a Date, UTC. */
export function dateStamp(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function logFileName(date: Date): string {
  return `${LOG_FILE_PREFIX}${dateStamp(date)}.log`;
}

/** Lists the log files in `dir`, newest first by date in the name. Missing directory means none. */
export function listLogFiles(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((name) => LOG_FILE_PATTERN.test(name)).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

/** Deletes every log file beyond the newest `keepDays`. Returns what it deleted. */
export function pruneLogFiles(dir: string, keepDays: number): string[] {
  const stale = listLogFiles(dir).slice(Math.max(0, keepDays));
  const deleted: string[] = [];
  for (const name of stale) {
    try {
      unlinkSync(join(dir, name));
      deleted.push(name);
    } catch {
      // A file we cannot delete is not worth failing over; the next rotation tries again.
    }
  }
  return deleted;
}

function defaultConsole(level: LogLevel, line: string): void {
  if (level === 'error' || level === 'warn') {
    console.error(line);
  } else {
    console.log(line);
  }
}

function formatConsoleFields(fields: LogFields): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) {
      continue;
    }
    const text =
      typeof value === 'string'
        ? /[\s"=]/.test(value)
          ? JSON.stringify(value)
          : value
        : JSON.stringify(value);
    parts.push(`${key}=${text}`);
  }
  return parts.join(' ');
}

interface Sink {
  write(level: LogLevel, message: string, fields: LogFields): void;
  addSecret(value: string): void;
  readonly currentFile: string | null;
}

class FileSink implements Sink {
  private readonly dir: string | null;
  private readonly fileLevel: number;
  private readonly consoleLevel: number;
  private readonly console: ((level: LogLevel, line: string) => void) | null;
  private readonly now: () => Date;
  private readonly keepDays: number;
  private readonly secrets = new Set<string>();
  private currentStamp: string | null = null;
  private currentPath: string | null = null;
  private fileBroken = false;

  constructor(options: FileLoggerOptions) {
    this.dir = options.dir;
    this.fileLevel = LEVEL_RANK[options.fileLevel ?? 'debug'];
    this.consoleLevel = LEVEL_RANK[options.consoleLevel ?? 'info'];
    this.console = options.console === undefined ? defaultConsole : options.console;
    this.now = options.now ?? (() => new Date());
    this.keepDays = options.keepDays ?? DEFAULT_KEEP_DAYS;
    for (const secret of options.secrets ?? []) {
      this.addSecret(secret);
    }
  }

  get currentFile(): string | null {
    return this.currentPath;
  }

  addSecret(value: string): void {
    // Anything shorter would redact ordinary words; a real token or lockfile password is far longer.
    if (value.length >= 6) {
      this.secrets.add(value);
    }
  }

  write(level: LogLevel, message: string, fields: LogFields): void {
    const rank = LEVEL_RANK[level];
    if (rank < this.fileLevel && rank < this.consoleLevel) {
      return;
    }
    const now = this.now();
    const safeFields = this.redact(scrubValue(fields)) as LogFields;
    const safeMessage = this.redactText(message);

    if (rank >= this.fileLevel && this.dir !== null) {
      const record = { ts: now.toISOString(), level, msg: safeMessage, ...safeFields };
      this.appendLine(now, `${JSON.stringify(record)}\n`);
    }
    if (rank >= this.consoleLevel && this.console) {
      const time = now.toISOString().slice(11, 19);
      const extra = formatConsoleFields(safeFields);
      this.console(level, `${time} ${level.padEnd(5)} ${safeMessage}${extra ? ` ${extra}` : ''}`);
    }
  }

  private appendLine(now: Date, line: string): void {
    if (this.dir === null) {
      return;
    }
    try {
      const stamp = dateStamp(now);
      const rotated = stamp !== this.currentStamp;
      if (rotated) {
        mkdirSync(this.dir, { recursive: true, mode: 0o700 });
        this.currentStamp = stamp;
        this.currentPath = join(this.dir, logFileName(now));
      }
      appendFileSync(this.currentPath ?? join(this.dir, logFileName(now)), line, { mode: 0o600 });
      this.fileBroken = false;
      if (rotated) {
        // Today's file now exists, so "keep 14" counts it.
        pruneLogFiles(this.dir, this.keepDays);
      }
    } catch (error) {
      if (!this.fileBroken && this.console) {
        this.fileBroken = true;
        const reason = error instanceof Error ? error.message : String(error);
        this.console('error', `log file write failed, continuing without file logging: ${reason}`);
      }
    }
  }

  private redactText(text: string): string {
    let out = text;
    for (const secret of this.secrets) {
      out = out.split(secret).join(REDACTED);
    }
    return out;
  }

  private redact(value: unknown): unknown {
    if (this.secrets.size === 0) {
      return value;
    }
    if (typeof value === 'string') {
      return this.redactText(value);
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.redact(item));
    }
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        out[this.redactText(key)] = this.redact(item);
      }
      return out;
    }
    return value;
  }
}

function makeLogger(sink: Sink, base: LogFields): CompanionLogger {
  const emit = (level: LogLevel, message: string, fields?: LogFields): void => {
    try {
      sink.write(level, message, { ...base, ...fields });
    } catch {
      // Logging must never take the process down.
    }
  };
  return {
    debug: (message, fields) => emit('debug', message, fields),
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
    child: (fields) => makeLogger(sink, { ...base, ...fields }),
    addSecret: (value) => sink.addSecret(value),
    get currentFile() {
      return sink.currentFile;
    },
  };
}

export function createFileLogger(options: FileLoggerOptions): CompanionLogger {
  return makeLogger(new FileSink(options), {});
}

/** Records every line in memory. For tests. */
export interface MemoryLogger extends CompanionLogger {
  readonly lines: readonly { level: LogLevel; message: string; fields: LogFields }[];
}

export function createMemoryLogger(): MemoryLogger {
  const lines: { level: LogLevel; message: string; fields: LogFields }[] = [];
  const sink: Sink = {
    write: (level, message, fields) => {
      lines.push({ level, message, fields });
    },
    addSecret: () => {},
    currentFile: null,
  };
  return { ...makeLogger(sink, {}), lines };
}

/** Turns anything thrown into log fields. */
export function errorFields(error: unknown): LogFields {
  if (error instanceof Error) {
    const fields: LogFields = { error: error.message };
    if ('code' in error && typeof error.code === 'string') {
      fields.code = error.code;
    }
    if (error.stack) {
      fields.stack = error.stack.split('\n').slice(1, 4).join(' | ');
    }
    return fields;
  }
  return { error: String(error) };
}
