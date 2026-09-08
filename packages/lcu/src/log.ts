/**
 * Minimal logger contract. The companion injects its own (file logger with rotation, M2);
 * tests inject a recording logger; scripts use the console.
 *
 * Every "log and drop" path in this package goes through a `Logger`, never through a throw.
 */

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

function line(level: string, message: string, fields?: LogFields): string {
  const suffix = fields && Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : '';
  return `[lcu] ${level} ${message}${suffix}`;
}

/** Writes to the console. Used by the smoke and record-ws scripts. */
export const consoleLogger: Logger = {
  debug: () => {},
  info: (message, fields) => console.log(line('info', message, fields)),
  warn: (message, fields) => console.warn(line('warn', message, fields)),
  error: (message, fields) => console.error(line('error', message, fields)),
};

/** Writes debug lines too. `--verbose` in the scripts. */
export const verboseConsoleLogger: Logger = {
  ...consoleLogger,
  debug: (message, fields) => console.log(line('debug', message, fields)),
};

/** Discards everything. Default for library use when the caller passes no logger. */
export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
