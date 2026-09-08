/**
 * An in-process stand-in for `apps/web`'s API: a plain HTTP server that answers scripted responses per
 * route and records every request. Test-only; production code never imports it. This is the one file in
 * the companion that opens a listening socket, and it is not the League client (which only `@customs/lcu`
 * may talk to).
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeApiResponse {
  readonly status: number;
  /** Serialised as JSON unless it is a string, which is sent verbatim. */
  readonly body: unknown;
  readonly contentType?: string;
  /** Close the connection without answering (a network error on the client side). */
  readonly drop?: boolean;
  /** Delay before answering, for coalescing tests. */
  readonly delayMs?: number;
}

export interface FakeApiRequest {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | undefined;
  readonly userAgent: string | undefined;
  readonly body: string;
}

export interface FakeApiOptions {
  /** Keyed by `"<METHOD> <path>"`. A list is consumed in order; the last entry repeats. */
  readonly routes?: Readonly<Record<string, readonly FakeApiResponse[]>>;
  /** When set, requests to `/api/companion/*` without this bearer token get the API's 401 envelope. */
  readonly token?: string;
}

export interface FakeApi {
  readonly baseUrl: string;
  readonly port: number;
  readonly requests: readonly FakeApiRequest[];
  close(): Promise<void>;
}

export async function startFakeApi(options: FakeApiOptions = {}): Promise<FakeApi> {
  const requests: FakeApiRequest[] = [];
  const cursors = new Map<string, number>();
  const routes: Record<string, readonly FakeApiResponse[]> = {
    'GET /api/health': [
      { status: 200, body: { ok: true, service: 'customs-night', time: new Date().toISOString() } },
    ],
    ...options.routes,
  };

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const record: FakeApiRequest = {
        method: req.method ?? '',
        path: req.url ?? '',
        authorization: req.headers.authorization,
        userAgent: req.headers['user-agent'],
        body: Buffer.concat(chunks).toString('utf8'),
      };
      requests.push(record);

      if (
        options.token !== undefined &&
        record.path.startsWith('/api/companion/') &&
        record.authorization !== `Bearer ${options.token}`
      ) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'unknown companion token' }));
        return;
      }

      const key = `${record.method} ${record.path}`;
      const script = routes[key];
      if (!script || script.length === 0) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: `fake api: no route ${key}` }));
        return;
      }
      const index = cursors.get(key) ?? 0;
      const response = script[Math.min(index, script.length - 1)] as FakeApiResponse;
      cursors.set(key, index + 1);

      if (response.drop) {
        res.socket?.destroy();
        return;
      }
      const send = (): void => {
        const isText = typeof response.body === 'string';
        const payload = isText ? (response.body as string) : JSON.stringify(response.body);
        res.writeHead(response.status, {
          'content-type': response.contentType ?? (isText ? 'text/plain' : 'application/json'),
        });
        res.end(payload);
      };
      if (response.delayMs) {
        setTimeout(send, response.delayMs);
      } else {
        send();
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    requests,
    close() {
      return new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      });
    },
  };
}
