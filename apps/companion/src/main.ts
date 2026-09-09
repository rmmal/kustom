/**
 * `pnpm --filter companion dev` (and, packaged, the exe a friend leaves running).
 *
 * Startup: resolve the config directory, load or prompt for the config, open the log, ping the API, say who
 * the token is (`GET /api/companion/me`), replay the end-of-game queue, then hand over to the connection state
 * machine, which runs until SIGINT/SIGTERM. Nothing after startup exits the process on an error: uncaught
 * exceptions and unhandled rejections are logged and the loop goes on.
 *
 * Flags: `--version` / `-v` prints the version and exits 0; `--help` / `-h` prints the usage and exits 0.
 * Both are answered before anything is read or written, so the build's smoke test can run the bundle on any
 * machine. `--show-token` makes the first-run token prompt echo what is typed (M2.19). `--verify-commands`
 * runs the M4.1 live verification of the three lobby writes against the client (`verifyCommands.ts`) and
 * exits; it makes no API call and needs no token.
 *
 * Environment:
 *  - `CUSTOMS_NIGHT_CONFIG_DIR` overrides the config directory (config.json, logs/, queue/, backfill.json,
 *    commands-done.json and the verify-commands reports).
 *  - `CUSTOMS_NIGHT_LOG_LEVEL` sets the console level (`debug`, `info`, `warn`, `error`; default `info`).
 *    The file always gets `debug`.
 *  - `CUSTOMS_NIGHT_SHOW_TOKEN=1` is `--show-token` for a shortcut that cannot pass flags.
 *  - `CUSTOMS_NIGHT_VERIFY_COMMANDS=1` is `--verify-commands` for the same reason.
 *  - `LCU_LOCKFILE_CANDIDATES` (from `@customs/lcu`) replaces the default lockfile paths.
 */

import { ApiClient, healthCheck } from './api.js';
import { Backfill } from './backfill.js';
import { CommandRunner } from './commandRunner.js';
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
import { GameWatcher } from './gameWatcher.js';
import { composeHooks, loggingHooks } from './hooks.js';
import { announceIdentity, checkIdentity } from './identity.js';
import { LobbyWatcher } from './lobbyWatcher.js';
import { type CompanionLogger, createFileLogger, errorFields, isLogLevel } from './log.js';
import { RankSync } from './rankSync.js';
import { runVerifyCommands } from './verifyCommands.js';
import { COMPANION_VERSION } from './version.js';

export const APP_NAME = 'Customs Night companion';

export function usage(): string {
  return [
    `${APP_NAME} ${COMPANION_VERSION}`,
    '',
    'Watches the League client and reports lobbies and results to the Customs Night API.',
    'Double-click it (or run it with no arguments) and leave it running.',
    '',
    'Flags:',
    '  --version, -v   print the version and exit',
    '  --help, -h      print this text and exit',
    '  --show-token    show the token as you type it at the first-run prompt (for a terminal that',
    '                  cannot paste into a hidden prompt); it is still never written to the log',
    '  --verify-commands',
    '                  verify the lobby writes (create, invite, switch side) against the running client,',
    '                  one prompt per probe, and write a report to paste back; no API call, no token needed',
    '',
    'Environment:',
    '  CUSTOMS_NIGHT_CONFIG_DIR   config directory (config.json, logs/, queue/, backfill.json,',
    '                             commands-done.json, verify-commands reports)',
    '  CUSTOMS_NIGHT_LOG_LEVEL    console level: debug | info | warn | error (default info)',
    '  CUSTOMS_NIGHT_SHOW_TOKEN   1 is the same as --show-token',
    '  CUSTOMS_NIGHT_VERIFY_COMMANDS',
    '                             1 is the same as --verify-commands',
    '',
    `Config: ${configDir()}`,
  ].join('\n');
}

/**
 * A double-clicked exe whose process exits closes its console window with it, so the one sentence that
 * says why is gone before anyone reads it. On a TTY, wait for Enter first. Never on a pipe (tests, CI).
 */
async function holdWindowOpen(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return;
  }
  const io = stdioPrompt();
  await io.ask('Press Enter to close this window. ');
}

async function resolveConfig(
  dir: string,
  logger: CompanionLogger,
  showToken: boolean,
): Promise<CompanionConfig | null> {
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
      if (loaded.reason === 'bad_token') {
        // Never the value: the file is where the token lives, and the log is what gets sent around.
        logger.warn('the saved companion token cannot be a token from the admin page; asking again', {
          path: loaded.path,
        });
      }
      const config = await promptFirstRun({
        io: stdioPrompt(process.stdin, process.stdout, { showToken }),
        partial: loaded.partial,
        checkApiBase: healthCheck(),
        reason: loaded.reason,
      });
      const path = saveConfig(dir, config);
      logger.info('config saved', { path });
      return config;
    }
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes('--version') || args.includes('-v')) {
    console.log(COMPANION_VERSION);
    return 0;
  }
  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage());
    return 0;
  }
  const dir = configDir();
  if (args.includes('--verify-commands') || process.env.CUSTOMS_NIGHT_VERIFY_COMMANDS === '1') {
    // The live verification of the lobby writes (M4.1). No API, no token: the config is read only for a
    // `lockfilePath`, and a missing config is fine.
    const loaded = loadConfig(dir);
    const lockfilePath =
      loaded.status === 'ok'
        ? loaded.config.lockfilePath
        : loaded.status === 'missing'
          ? loaded.partial?.lockfilePath
          : undefined;
    const code = await runVerifyCommands({
      configDir: dir,
      io: stdioPrompt(),
      ...(lockfilePath ? { lockfilePath } : {}),
    });
    await holdWindowOpen();
    return code;
  }
  const consoleLevelRaw = process.env.CUSTOMS_NIGHT_LOG_LEVEL ?? 'info';
  const consoleLevel = isLogLevel(consoleLevelRaw) ? consoleLevelRaw : 'info';
  const logger = createFileLogger({ dir: logsDir(dir), consoleLevel, fileLevel: 'debug' });
  logger.info(`${APP_NAME} ${COMPANION_VERSION} starting`, {
    node: process.version,
    platform: process.platform,
    configDir: dir,
    logDir: logsDir(dir),
  });

  const showToken = args.includes('--show-token') || process.env.CUSTOMS_NIGHT_SHOW_TOKEN === '1';
  const config = await resolveConfig(dir, logger, showToken);
  if (config === null) {
    await holdWindowOpen();
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

  // The queue needs the API, not League: replay it before anything else, so an API that is slow to answer
  // the identity check below never delays a queued game.
  const gameWatcher = new GameWatcher({ api, logger, configDir: dir });
  gameWatcher.start();

  // Who this token is, on every start and right after the first-run prompt. One attempt; never blocks.
  announceIdentity(await checkIdentity(api), logger);

  // The command queue (M4.1): polls the API, runs create-lobby / invite / switch-side through packages/lcu,
  // acks or nacks. Each kind is gated on its reference row being verified; see commandRunner.ts.
  const commandRunner = new CommandRunner({ api, logger, configDir: dir });
  const lobbyWatcher = new LobbyWatcher({
    api,
    logger,
    onResponse: (response) => rankSync.needed(response.ranksNeeded),
    passwordFor: (partyId) => commandRunner.passwordFor(partyId),
  });
  const rankSync = new RankSync({ api, logger, names: lobbyWatcher.knownNames });
  // Past customs from match history (M5.1): 60 s after the first connect, then every 6 h, only while the
  // client is idle. Its games go through the game watcher's queue like any end-of-game block.
  const backfill = new Backfill({ api, logger, configDir: dir, sink: gameWatcher });
  const machine = new ConnectionMachine({
    logger,
    hooks: composeHooks(
      logger,
      loggingHooks(logger),
      lobbyWatcher.hooks(),
      gameWatcher.hooks(),
      rankSync.hooks(),
      backfill.hooks(),
      commandRunner.hooks(),
    ),
    lockfile: config.lockfilePath ? { overridePath: config.lockfilePath } : {},
  });
  commandRunner.start();

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
  commandRunner.stop();
  lobbyWatcher.stop();
  rankSync.stop();
  backfill.stop();
  gameWatcher.stop();
  logger.info('stopped');
  return 0;
}

main().then(
  (code) => {
    process.exit(code);
  },
  async (error) => {
    // Only startup can get here (the loop never rejects). Say why, then exit non-zero.
    console.error('companion failed to start:', error instanceof Error ? error.message : String(error));
    await holdWindowOpen();
    process.exit(1);
  },
);
