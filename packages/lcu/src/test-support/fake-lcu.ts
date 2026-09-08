/**
 * An in-process stand-in for the League client: an HTTPS server with a self-signed certificate that serves
 * canned routes and a WebSocket endpoint that emits scripted frames.
 *
 * Used by this package's tests and, later, by the companion's state-machine tests (M2). Never imported by
 * production code. The certificates in `certs/` are test-only and were generated with openssl; they are not
 * secrets.
 */

import { readFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { type WebSocket, WebSocketServer } from 'ws';

export type TestCertName = 'fake-lcu' | 'other-ca';

function certPath(name: TestCertName, ext: 'pem' | 'key'): string {
  return fileURLToPath(new URL(`./certs/${name}.${ext}`, import.meta.url));
}

export function readTestCert(name: TestCertName): string {
  return readFileSync(certPath(name, 'pem'), 'utf8');
}

export interface CannedRoute {
  readonly status: number;
  /** Serialized as JSON unless it is a string, which is sent verbatim. */
  readonly body: unknown;
  readonly contentType?: string;
  /** Delay before answering, for timeout tests. */
  readonly delayMs?: number;
}

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | undefined;
  readonly contentType: string | undefined;
  readonly body: string;
}

export interface FakeLcuOptions {
  readonly password?: string;
  /** Keyed by `"<METHOD> <path>"`; the path includes the query string. */
  readonly routes?: Readonly<Record<string, CannedRoute>>;
  readonly cert?: TestCertName;
  /** When true, requests with a wrong Authorization header get a 401. Default true. */
  readonly enforceAuth?: boolean;
  /** Answer WebSocket pings with pongs, as the real client does. Default true; false plays a dead socket. */
  readonly autoPong?: boolean;
}

export interface FakeLcu {
  readonly port: number;
  readonly password: string;
  /** PEM of the certificate the server presents. Pin to it with `{ mode: 'pinned', ca }`. */
  readonly ca: string;
  readonly requests: readonly RecordedRequest[];
  /** WebSocket clients currently connected. */
  readonly sockets: ReadonlySet<WebSocket>;
  /** Frames received from WebSocket clients, in order. */
  readonly wsReceived: readonly string[];
  /** Waits until at least `count` frames were received. */
  waitForWsFrames(count: number, timeoutMs?: number): Promise<readonly string[]>;
  /** Waits until at least `count` WebSocket clients are connected. */
  waitForSockets(count: number, timeoutMs?: number): Promise<void>;
  /** Sends a raw frame to every connected WebSocket client. */
  broadcast(frame: string): void;
  /** Sends an LCU-style event frame to every connected client. */
  emitEvent(uri: string, eventType: 'Create' | 'Update' | 'Delete', data: unknown, topic?: string): void;
  /** Closes every WebSocket client with a code, as the client does when it exits. */
  closeSockets(code?: number, reason?: string): void;
  close(): Promise<void>;
}

function expectedAuthorization(password: string): string {
  return `Basic ${Buffer.from(`riot:${password}`).toString('base64')}`;
}

export async function startFakeLcu(options: FakeLcuOptions = {}): Promise<FakeLcu> {
  const password = options.password ?? 'test-password';
  const certName = options.cert ?? 'fake-lcu';
  const enforceAuth = options.enforceAuth ?? true;
  const routes = options.routes ?? {};
  const requests: RecordedRequest[] = [];
  const sockets = new Set<WebSocket>();
  const wsReceived: string[] = [];
  const frameWaiters: { count: number; resolve: (frames: readonly string[]) => void }[] = [];
  const socketWaiters: { count: number; resolve: () => void }[] = [];

  const server: Server = createServer(
    { key: readFileSync(certPath(certName, 'key')), cert: readFileSync(certPath(certName, 'pem')) },
    (req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const record: RecordedRequest = {
          method: req.method ?? '',
          path: req.url ?? '',
          authorization: req.headers.authorization,
          contentType: req.headers['content-type'],
          body: Buffer.concat(chunks).toString('utf8'),
        };
        requests.push(record);
        if (enforceAuth && record.authorization !== expectedAuthorization(password)) {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({ errorCode: 'UNAUTHORIZED', httpStatus: 401, message: 'fake lcu: bad auth' }),
          );
          return;
        }
        const route = routes[`${record.method} ${record.path}`];
        if (!route) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({ errorCode: 'RPC_ERROR', httpStatus: 404, message: 'fake lcu: no such route' }),
          );
          return;
        }
        const send = (): void => {
          const isText = typeof route.body === 'string';
          const payload = isText ? (route.body as string) : JSON.stringify(route.body);
          const contentType = route.contentType ?? (isText ? 'text/plain' : 'application/json');
          if (route.status === 204) {
            res.writeHead(204);
            res.end();
            return;
          }
          res.writeHead(route.status, { 'content-type': contentType });
          res.end(payload);
        };
        if (route.delayMs) {
          setTimeout(send, route.delayMs);
        } else {
          send();
        }
      });
    },
  );

  const wss = new WebSocketServer({
    server,
    autoPong: options.autoPong ?? true,
    // Reject bad auth at the upgrade (HTTP 401), the way an HTTP server would, so the client's
    // `connect()` fails instead of opening and then closing.
    verifyClient: ({ req }: { req: IncomingMessage }) => {
      requests.push({
        method: 'WS',
        path: req.url ?? '',
        authorization: req.headers.authorization,
        contentType: undefined,
        body: '',
      });
      return !enforceAuth || req.headers.authorization === expectedAuthorization(password);
    },
  });
  wss.on('connection', (socket) => {
    sockets.add(socket);
    for (const waiter of socketWaiters.splice(0)) {
      if (sockets.size >= waiter.count) {
        waiter.resolve();
      } else {
        socketWaiters.push(waiter);
      }
    }
    socket.on('message', (raw) => {
      wsReceived.push(raw.toString());
      for (const waiter of frameWaiters.splice(0)) {
        if (wsReceived.length >= waiter.count) {
          waiter.resolve([...wsReceived]);
        } else {
          frameWaiters.push(waiter);
        }
      }
    });
    socket.on('close', () => sockets.delete(socket));
  });

  const broadcast = (frame: string): void => {
    for (const socket of sockets) {
      socket.send(frame);
    }
  };

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    port,
    password,
    ca: readTestCert(certName),
    requests,
    sockets,
    wsReceived,
    waitForWsFrames(count, timeoutMs = 2000) {
      if (wsReceived.length >= count) {
        return Promise.resolve([...wsReceived]);
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`timed out waiting for ${count} ws frames`)),
          timeoutMs,
        );
        frameWaiters.push({
          count,
          resolve: (frames) => {
            clearTimeout(timer);
            resolve(frames);
          },
        });
      });
    },
    waitForSockets(count, timeoutMs = 2000) {
      if (sockets.size >= count) {
        return Promise.resolve();
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`timed out waiting for ${count} ws clients`)),
          timeoutMs,
        );
        socketWaiters.push({
          count,
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
        });
      });
    },
    broadcast,
    emitEvent(uri, eventType, data, topic = 'OnJsonApiEvent') {
      broadcast(JSON.stringify([8, topic, { data, eventType, uri }]));
    },
    closeSockets(code = 1006, reason = 'fake lcu: client exiting') {
      for (const socket of sockets) {
        socket.close(code, reason);
      }
    },
    close() {
      return new Promise<void>((resolve) => {
        for (const socket of sockets) {
          socket.terminate();
        }
        wss.close(() => {
          server.closeAllConnections();
          server.close(() => resolve());
        });
      });
    },
  };
}
