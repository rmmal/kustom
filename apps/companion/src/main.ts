/**
 * `pnpm --filter companion dev` (and, packaged, the exe a friend leaves running).
 *
 * Startup: resolve the config directory, load or prompt for the config, open the log, ping the API, then hand
 * over to the connection state machine, which runs until SIGINT/SIGTERM. Nothing after startup exits the
 * process on an error: uncaught exceptions and unhandled rejections are logged and the loop goes on.
 *
 * Environment:
 *  - `CUSTOMS_NIGHT_CONFIG_DIR` overrides the config directory (config.json and logs/).
 *  - `CUSTOMS_NIGHT_LOG_LEVEL` sets the console level (`debug`, `info`, `warn`, `error`; default `info`).
 *    The file always gets `debug`.
 *  - `LCU_LOCKFILE_CANDIDATES` (from `@customs/lcu`) replaces the default lockfile paths.
 */

import { ApiClient, healthCheck } from './api.js';
import {
  type CompanionConfig,
  configDir,
  loadConfig,
  logsDir,
  promptFirstRun,
  saveConfig,
  stdioPrompt,
} from './config.js';
import { ConnectionMachine } from './connection.js';
import { loggingHooks } from './hooks.js';
import { type CompanionLogger, createFileLogger, errorFields, isLogLevel } from './log.js';
import { COMPANION_VERSION } from './version.js';

async function resolveConfig(dir: string, logger: CompanionLogger): Promise<CompanionConfig | null> {
  const loaded = loadConfig(dir);
  switch (loaded.status) {
    case 'ok':
      return loaded.config;
    case 'invalid':
      logger.error('config file is unreadable; fix or delete it and start again', {
        path: loaded.path,
        reason: loaded.reason,
      });
      return null;
    case 'missing': {
      const config = await promptFirstRun({
        io: stdioPrompt(),
        partial: loaded.partial,
        checkApiBase: healthCheck(),
      });
      const path = saveConfig(dir, config);
      logger.info('config saved', { path });
      return config;
    }
  }
}

async function main(): Promise<number> {
  const dir = configDir();
  const consoleLevelRaw = process.env.CUSTOMS_NIGHT_LOG_LEVEL ?? 'info';
  const consoleLevel = isLogLevel(consoleLevelRaw) ? consoleLevelRaw : 'info';
  const logger = createFileLogger({ dir: logsDir(dir), consoleLevel, fileLevel: 'debug' });
  logger.info('customs night companion starting', {
    version: COMPANION_VERSION,
    node: process.version,
    platform: process.platform,
    configDir: dir,
    logDir: logsDir(dir),
  });

  const config = await resolveConfig(dir, logger);
  if (config === null) {
    return 1;
  }
  logger.addSecret(config.companionToken);

  const api = new ApiClient({
    apiBase: config.apiBase,
    token: config.companionToken,
    logger: logger.child({ component: 'api' }),
  });
  const health = await api.health();
  if (health === null) {
    logger.info('api reachable', { apiBase: config.apiBase });
  } else {
    logger.warn('api not reachable now; calls will retry', { apiBase: config.apiBase, reason: health });
  }

  const machine = new ConnectionMachine({
    logger,
    hooks: loggingHooks(logger),
    lockfile: config.lockfilePath ? { overridePath: config.lockfilePath } : {},
  });

  let signals = 0;
  const onSignal = (signal: NodeJS.Signals): void => {
    signals += 1;
    if (signals > 1) {
      logger.warn('second signal; exiting immediately', { signal });
      process.exit(130);
    }
    logger.info('shutting down', { signal });
    machine.stop();
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  process.on('uncaughtException', (error) => {
    logger.error('uncaught exception (continuing)', errorFields(error));
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled rejection (continuing)', errorFields(reason));
  });

  await machine.run();
  logger.info('stopped');
  return 0;
}

main().then(
  (code) => {
    process.exit(code);
  },
  (error) => {
    // Only startup can get here (the loop never rejects). Say why, then exit non-zero.
    console.error('companion failed to start:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
