/**
 * Step three of the release build: publish the exe as a GitHub release on the public repo
 * `suyaser/kustom-releases` (lead, 2026-09-09), through the `gh` CLI and its own login.
 *
 *   pnpm --filter companion publish:gh         # after build:win; needs `gh auth login` once
 *   (`publish:gh`, not `publish`: pnpm intercepts a script named `publish` with its own command)
 *
 * One release per version: tag `v<version>`, title `Customs Night companion <version>`, notes = the friend
 * README, assets `CustomsNight.exe`, `CustomsNight.exe.sha256` and `README.txt`. The stable link for the group
 * chat is `https://github.com/suyaser/kustom-releases/releases/latest/download/CustomsNight.exe`.
 *
 * Nothing here needs a token in the environment. When `gh` is not logged in (or not installed) the script
 * prints the exact command to run by hand and exits 1; it never half-publishes.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  companionVersion,
  DIST_DIR,
  EXE_NAME,
  EXE_SHA256_NAME,
  friendReadme,
  README_ASSET_NAME,
  RELEASE_LATEST_URL,
  RELEASE_REPO,
  releaseAssetUrl,
  releaseTag,
} from './config.js';

export interface PublishOptions {
  readonly version?: string;
  /** Path of the `gh` binary. Default: `gh` on PATH. */
  readonly gh?: string;
}

export interface PublishPlan {
  readonly version: string;
  readonly tag: string;
  readonly title: string;
  readonly assets: readonly string[];
  readonly notesFile: string;
  readonly command: readonly string[];
  readonly latestUrl: string;
  readonly assetUrls: readonly string[];
}

/** The `gh release create` invocation, as argv. Pure: no I/O beyond reading the version. */
export function publishPlan(version: string = companionVersion()): PublishPlan {
  const tag = releaseTag(version);
  const title = `Customs Night companion ${version}`;
  const notesFile = join(DIST_DIR, README_ASSET_NAME);
  const assets = [join(DIST_DIR, EXE_NAME), join(DIST_DIR, EXE_SHA256_NAME), notesFile];
  return {
    version,
    tag,
    title,
    assets,
    notesFile,
    command: [
      'gh',
      'release',
      'create',
      tag,
      '--repo',
      RELEASE_REPO,
      '--title',
      title,
      '--notes-file',
      notesFile,
      ...assets,
    ],
    latestUrl: RELEASE_LATEST_URL,
    assetUrls: [EXE_NAME, EXE_SHA256_NAME, README_ASSET_NAME].map((asset) => releaseAssetUrl(version, asset)),
  };
}

function shellQuote(arg: string): string {
  return /^[A-Za-z0-9_./:=@-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

export function commandLine(plan: PublishPlan): string {
  return plan.command.map(shellQuote).join(' ');
}

/** Writes `dist/README.txt` (the friend copy) and checks the exe and its hash file are there. */
export function stageAssets(plan: PublishPlan): void {
  writeFileSync(plan.notesFile, friendReadme());
  for (const asset of plan.assets) {
    if (!existsSync(asset)) {
      throw new Error(`${asset} does not exist; run pnpm --filter companion build:win first`);
    }
  }
  const exe = plan.assets[0] ?? '';
  const sha = plan.assets[1] ?? '';
  const recorded = readFileSync(sha, 'utf8').split(/\s+/)[0] ?? '';
  if (!/^[0-9a-f]{64}$/.test(recorded)) {
    throw new Error(`${sha} does not hold a SHA-256`);
  }
  console.log(`staged ${exe} (${statSync(exe).size} bytes, sha256 ${recorded}) and ${plan.notesFile}`);
}

export function ghLoggedIn(gh: string): boolean {
  const status = spawnSync(gh, ['auth', 'status'], { encoding: 'utf8' });
  return status.status === 0;
}

export async function publish(options: PublishOptions = {}): Promise<PublishPlan> {
  const gh = options.gh ?? 'gh';
  const plan = publishPlan(options.version);
  if (!ghLoggedIn(gh)) {
    console.error(
      'gh is not logged in (or not installed). Run `gh auth login`, then `pnpm --filter companion publish:gh` ' +
        'again (it writes dist/README.txt and runs exactly this):',
    );
    console.error('');
    console.error(`  cd ${DIST_DIR}`);
    console.error(`  ${commandLine(plan)}`);
    console.error('');
    console.error(`Expected download link afterwards: ${plan.latestUrl}`);
    console.error('(dist/ was left untouched; README.txt is written only once gh is logged in.)');
    process.exit(1);
  }
  stageAssets(plan);
  const [, ...args] = plan.command;
  const result = spawnSync(gh, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`gh release create exited ${result.status ?? 'by signal'}`);
  }
  console.log(`published ${plan.tag} to ${RELEASE_REPO}`);
  console.log(`  ${plan.latestUrl}`);
  for (const url of plan.assetUrls) {
    console.log(`  ${url}`);
  }
  return plan;
}

function isMain(): boolean {
  const entry = process.argv[1];
  return typeof entry === 'string' && /publish\.(ts|js|cjs|mjs)$/.test(entry);
}

if (isMain()) {
  const { values } = parseArgs({ options: { version: { type: 'string' } } });
  publish(values.version ? { version: values.version } : {}).then(
    () => {},
    (error) => {
      console.error('publish failed:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
