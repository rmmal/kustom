/**
 * `pnpm --filter companion release`: bundle, package for Windows, publish the GitHub release. One command,
 * in that order, so the published file is always the file that was just built against the origin in
 * `config.ts`. Needs `gh auth login` once; nothing else.
 */

import { publish } from './publish.js';
import { buildSea } from './sea.js';

async function release(): Promise<void> {
  const built = await buildSea({ target: 'win-x64' });
  const mib = (built.bytes / (1024 * 1024)).toFixed(1);
  console.log(`built ${built.output} (${mib} MiB, Node ${built.nodeRelease}, version ${built.version})`);
  console.log(`sha256 ${built.sha256}`);
  if (built.bytes > 120 * 1024 * 1024) {
    throw new Error('over the 120 MB budget; not publishing');
  }
  await publish({ version: built.version });
}

release().catch((error) => {
  console.error('release failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
