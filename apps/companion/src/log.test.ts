import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createFileLogger,
  createMemoryLogger,
  DEFAULT_KEEP_DAYS,
  errorFields,
  type LogLevel,
  listLogFiles,
  logFileName,
} from './log.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'companion-log-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function readAll(dir: string): string {
  return readdirSync(dir)
    .map((name) => readFileSync(join(dir, name), 'utf8'))
    .join('');
}

describe('file logger', () => {
  it('writes one JSON object per line to companion-<date>.log and echoes a console line', () => {
    const dir = join(tempDir(), 'logs');
    const consoleLines: { level: LogLevel; line: string }[] = [];
    const now = new Date('2026-09-08T20:15:30.000Z');
    const logger = createFileLogger({
      dir,
      now: () => now,
      console: (level, line) => consoleLines.push({ level, line }),
    });
    logger.info('hello', { port: 1234, name: 'two words' });
    logger.debug('quiet', { x: 1 });

    const file = join(dir, logFileName(now));
    expect(logger.currentFile).toBe(file);
    const lines = readFileSync(file, 'utf8').trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? '')).toEqual({
      ts: '2026-09-08T20:15:30.000Z',
      level: 'info',
      msg: 'hello',
      port: 1234,
      name: 'two words',
    });
    // Console: info only by default, one human line.
    expect(consoleLines).toEqual([
      { level: 'info', line: '20:15:30 info  hello port=1234 name="two words"' },
    ]);
    expect(statSync(dir).mode & 0o077).toBe(0);
  });

  it('rotates daily and keeps only the newest 14 files', () => {
    const dir = join(tempDir(), 'logs');
    let now = new Date('2026-09-01T00:00:00.000Z');
    const logger = createFileLogger({ dir, now: () => now, console: null });
    for (let day = 0; day < 20; day += 1) {
      now = new Date(Date.UTC(2026, 8, 1 + day, 12));
      logger.info('tick', { day });
    }
    const files = listLogFiles(dir);
    expect(files).toHaveLength(DEFAULT_KEEP_DAYS);
    expect(files[0]).toBe('companion-2026-09-20.log');
    expect(files[files.length - 1]).toBe('companion-2026-09-07.log');
    expect(readFileSync(join(dir, 'companion-2026-09-20.log'), 'utf8')).toContain('"day":19');
  });

  it('never writes a registered secret or a credential-looking field', () => {
    const dir = join(tempDir(), 'logs');
    const consoleLines: string[] = [];
    const token = 'tok_0123456789abcdefABCDEF';
    const password = 'lockfile-password-XYZ';
    const logger = createFileLogger({
      dir,
      console: (_level, line) => consoleLines.push(line),
      secrets: [token],
    });
    logger.addSecret(password);
    logger.info(`bearer ${token} in the message`, {
      authorization: `Basic ${Buffer.from(`riot:${password}`).toString('base64')}`,
      nested: { password, list: [token, 'fine'] },
      url: `https://127.0.0.1:1234?x=${password}`,
      companionToken: 'anything-under-a-token-key',
    });
    const child = logger.child({ component: 'c' });
    child.warn('child line', { note: `contains ${token}` });

    const text = readAll(dir);
    const all = `${text}\n${consoleLines.join('\n')}`;
    expect(all).not.toContain(token);
    expect(all).not.toContain(password);
    expect(all).not.toContain('anything-under-a-token-key');
    expect(all).toContain('[redacted]');
    expect(text).toContain('"component":"c"');
    expect(text).toContain('"fine"');
  });

  it('respects the file and console levels separately', () => {
    const dir = join(tempDir(), 'logs');
    const consoleLines: string[] = [];
    const logger = createFileLogger({
      dir,
      fileLevel: 'warn',
      consoleLevel: 'error',
      console: (_level, line) => consoleLines.push(line),
    });
    logger.info('nope');
    logger.warn('file only');
    logger.error('both');
    const text = readAll(dir);
    expect(text).toContain('file only');
    expect(text).toContain('both');
    expect(text).not.toContain('nope');
    expect(consoleLines).toHaveLength(1);
    expect(consoleLines[0]).toContain('both');
  });

  it('keeps going when the log directory cannot be written', () => {
    const blocked = join(tempDir(), 'not-a-dir');
    // A file where the directory should be: mkdir fails.
    const consoleLines: string[] = [];
    const logger = createFileLogger({
      dir: join(blocked, 'logs'),
      console: (_level, line) => consoleLines.push(line),
    });
    // Create the blocking file after the logger exists but before the first write.
    writeFileSync(blocked, 'block');
    expect(() => logger.info('first')).not.toThrow();
    expect(() => logger.info('second')).not.toThrow();
    expect(consoleLines.some((line) => line.includes('log file write failed'))).toBe(true);
    expect(consoleLines.filter((line) => line.includes('log file write failed'))).toHaveLength(1);
  });

  it('works with no file at all', () => {
    const consoleLines: string[] = [];
    const logger = createFileLogger({ dir: null, console: (_level, line) => consoleLines.push(line) });
    logger.info('console only');
    expect(logger.currentFile).toBeNull();
    expect(consoleLines).toHaveLength(1);
  });
});

describe('memory logger and helpers', () => {
  it('records lines with merged child fields', () => {
    const logger = createMemoryLogger();
    logger.child({ a: 1 }).info('x', { b: 2 });
    expect(logger.lines).toEqual([{ level: 'info', message: 'x', fields: { a: 1, b: 2 } }]);
  });

  it('flattens errors', () => {
    const error = Object.assign(new Error('boom'), { code: 'ECONNREFUSED' });
    const fields = errorFields(error);
    expect(fields.error).toBe('boom');
    expect(fields.code).toBe('ECONNREFUSED');
    expect(errorFields('plain')).toEqual({ error: 'plain' });
  });
});
