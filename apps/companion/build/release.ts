/**
 * `pnpm --filter companion release`: bundle, package for Windows, upload. One command, in that order, so
 * the file in the bucket is always the file that was just built against the origin in `config.ts`.
 *
 * Needs `CUSTOMS_NIGHT_RELEASE_SERVICE_ROLE_KEY` in the environment (see `.env.example`).
 */

import { buildSea } from './sea.js';
import { upload } from './upload.js';

async function release(): Promise<void> {
  const built = await buildSea({ target: 'win-x64' });
  const mib = (built.bytes / (1024 * 1024)).toFixed(1);
  console.log(`built ${built.output} (${mib} MiB, Node ${built.nodeRelease}, version ${built.version})`);
  console.log(`sha256 ${built.sha256}`);
  if (built.bytes > 120 * 1024 * 1024) {
    throw new Error('over the 120 MB budget; not uploading');
  }
  const uploaded = await upload({ version: built.version });
  console.log('');
  console.log('public URLs:');
  for (const object of uploaded.objects) {
    console.log(`  ${object.url}`);
  }
}

release().catch((error) => {
  console.error('release failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
