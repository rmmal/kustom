/**
 * `packages/lcu` is the only place in the repo that talks to the League client.
 * Lockfile discovery, the basic-auth HTTPS client, the WebSocket subscriber and the typed
 * endpoints all live here (M0.1). Nothing else may import `https` or reach 127.0.0.1.
 *
 * This file is a stub so the workspace builds before M0.1 lands. Do not design the API here.
 */

/** Package name, so the stub exports something a test can assert on. */
export const LCU_PACKAGE = '@customs/lcu';

/** Set by M0.1. Present now only so consumers can `import type` without a placeholder of their own. */
export type LcuConnection = {
  readonly port: number;
  readonly password: string;
};
