/**
 * `pnpm --filter @customs/lcu record-ws [--insecure] [--lockfile <path>] [--topic <topic>]... [--out <dir>]`
 *
 * Connects to the client's WebSocket, subscribes to everything (or the given topics) and appends every event
 * to `fixtures/<patch>/ws-events.ndjson` until Ctrl-C. Malformed frames are appended too, flagged with
 * `dropped: true`, so M0.3 can see what the parser refused; they go through the same scrub
 * (`scrubDroppedFrame`), never to disk verbatim.
 *
 * The file is committed, so events are scrubbed first (`scrub.ts`): login, RSO, Riot Client auth, chat and any
 * URI mentioning auth/token are written without `data` (`redacted: true`), and credential-looking keys inside
 * every other payload are replaced. Counts are printed in the summary.
 *
 * If the client closes the socket (patch restart, crash) the recorder re-discovers the lockfile and reconnects
 * every few seconds. That is the simplest possible loop, not the companion's backoff policy (M2.1).
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { FIXTURES_DIR } from '../fixtures.js';
import { discoverLockfile } from '../lockfile.js';
import { scrubDroppedFrame, scrubEvent } from '../scrub.js';
import { ALL_EVENTS_TOPIC, LcuSocket } from '../socket.js';
import { describeTlsMode } from '../tls.js';
import {
  describeAttempts,
  describeNotFound,
  isoNow,
  makeLogger,
  probeTls,
  resolveVersion,
  todayStamp,
} from './common.js';

const HELP = `record-ws: append every WebSocket event from the client to fixtures/<patch>/ws-events.ndjson.

  --insecure        skip certificate pinning (rejectUnauthorized: false)
  --lockfile <p>    lockfile path for a non-default install
  --topic <t>       subscribe to one topic (repeatable); default OnJsonApiEvent (everything)
  --out <dir>       fixtures root (default packages/lcu/fixtures)
  --verbose         debug logging
`;

const RETRY_MS = 3000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      insecure: { type: 'boolean', default: false },
      lockfile: { type: 'string' },
      topic: { type: 'string', multiple: true },
      out: { type: 'string' },
      verbose: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  const logger = makeLogger(values.verbose);
  const root = values.out ?? FIXTURES_DIR;
  const topics = values.topic && values.topic.length > 0 ? values.topic : [ALL_EVENTS_TOPIC];

  const counts = new Map<string, number>();
  let total = 0;
  let dropped = 0;
  let redacted = 0;
  let outFile: string | undefined;
  let stopping = false;

  const summary = (): void => {
    console.log(
      `\n${total} events (${redacted} written without data: sensitive URI), ${dropped} malformed frames dropped${outFile ? `, written to ${outFile}` : ''}`,
    );
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [uri, count] of sorted) {
      console.log(`${String(count).padStart(6)}  ${uri}`);
    }
  };

  let active: LcuSocket | undefined;
  process.on('SIGINT', () => {
    stopping = true;
    active?.close();
    summary();
    process.exit(0);
  });

  while (!stopping) {
    const discovered = await discoverLockfile({ overridePath: values.lockfile });
    if (discovered.status === 'not_found') {
      console.error(describeNotFound(discovered));
      if (total === 0) {
        return 2;
      }
      console.log(`retrying in ${RETRY_MS / 1000}s (Ctrl-C to stop)`);
      await sleep(RETRY_MS);
      continue;
    }

    const probe = await probeTls(discovered.credentials, { insecure: values.insecure, logger });
    if (probe.client === null) {
      console.error(`No TLS mode reached the client:\n${describeAttempts(probe.attempts)}`);
      if (total === 0) {
        return 3;
      }
      await sleep(RETRY_MS);
      continue;
    }
    const resolved = await resolveVersion(probe.client, probe.versionResponse, todayStamp());
    probe.client.close();
    const dir = join(root, resolved.patch);
    mkdirSync(dir, { recursive: true });
    outFile = join(dir, 'ws-events.ndjson');
    console.log(
      `client ${resolved.version ?? 'unknown'}; tls ${describeTlsMode(probe.mode)}; appending to ${outFile}`,
    );

    const socket = LcuSocket.fromCredentials(discovered.credentials, { tls: probe.mode, logger });
    active = socket;
    for (const topic of topics) {
      socket.subscribe(topic);
    }
    socket.on('event', (event) => {
      total += 1;
      counts.set(event.uri, (counts.get(event.uri) ?? 0) + 1);
      const scrubbed = scrubEvent(event);
      const line =
        scrubbed.kind === 'redacted'
          ? { ts: isoNow(), ...scrubbed.event, redacted: true }
          : { ts: isoNow(), ...scrubbed.event };
      if (scrubbed.kind === 'redacted') {
        redacted += 1;
      }
      appendFileSync(outFile ?? '', `${JSON.stringify(line)}\n`);
      console.log(
        `${isoNow().slice(11, 19)} ${event.eventType.padEnd(6)} ${event.uri}${scrubbed.kind === 'redacted' ? '  (data redacted)' : ''}`,
      );
    });
    socket.on('dropped', (frame) => {
      dropped += 1;
      appendFileSync(
        outFile ?? '',
        `${JSON.stringify({ ts: isoNow(), reason: frame.reason, ...scrubDroppedFrame(frame.raw) })}\n`,
      );
    });
    socket.on('error', () => {});

    const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
    try {
      await socket.connect();
      console.log(
        `subscribed to ${topics.join(', ')}${socket.negotiatedProtocol ? ` (subprotocol ${socket.negotiatedProtocol})` : ' (no subprotocol)'}. Ctrl-C to stop.`,
      );
    } catch (error) {
      console.error(`socket connect failed: ${error instanceof Error ? error.message : String(error)}`);
      await sleep(RETRY_MS);
      continue;
    }
    await closed;
    active = undefined;
    if (!stopping) {
      console.log(`socket closed; reconnecting in ${RETRY_MS / 1000}s (Ctrl-C to stop)`);
      await sleep(RETRY_MS);
    }
  }
  summary();
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error('record-ws crashed:', error);
    process.exit(1);
  },
);
