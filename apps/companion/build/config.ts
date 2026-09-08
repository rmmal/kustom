/**
 * Everything the release build pins, in one place (M2.6).
 *
 * - The Node release the exe carries. Node's single-executable blob must be produced by the same Node version
 *   as the binary it is injected into, so the build downloads this exact release for both sides (the host
 *   copy for the blob, the win-x64 `node.exe` for the target) and never relies on whatever `node` is on PATH.
 * - The API origin baked into the exe (`DEFAULT_API_BASE` in `src/config.ts`), overridable per build with
 *   `CUSTOMS_NIGHT_API_BASE`. `pnpm --filter companion dev` never sees it and stays on localhost.
 * - Where the release is published: the public Supabase Storage bucket `releases` on the hosted project.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const COMPANION_DIR = fileURLToPath(new URL('..', import.meta.url));
export const REPO_ROOT = dirname(dirname(COMPANION_DIR));
export const DIST_DIR = join(COMPANION_DIR, 'dist');
export const CACHE_DIR = join(COMPANION_DIR, 'build', 'cache');

/** The bundle the exe wraps. CommonJS: Node's SEA loads only CommonJS main scripts. */
export const BUNDLE_FILE = join(DIST_DIR, 'customs-night.cjs');

export const RIOT_ROOT_CA_FILE = join(REPO_ROOT, 'packages', 'lcu', 'certs', 'riotgames.pem');
export const FRIEND_README_FILE = join(COMPANION_DIR, 'README-friends.md');

/** Node release carried by the exe. LTS "Krypton". Change it here and nowhere else. */
export const NODE_RELEASE = '24.20.0';

/**
 * SHA-256 of the artifacts we download from nodejs.org, from `SHASUMS256.txt` of that release. The build
 * fetches the live list too and refuses a mismatch; these are the belt for the artifacts we have already
 * used, so a changed upstream file is noticed even if the list changed with it.
 */
export const NODE_SHA256: Readonly<Record<string, string>> = {
  'win-x64/node.exe': '5c976096e04e5c2c1f091938926234cc9fbebfe9787ddd149351b3b0ecc707b5',
  'node-v24.20.0-darwin-arm64.tar.gz': '40e5607e5ecb3db9192723776da2d75d966260fc74a7a9e731c1bd67dda96bc8',
};

export const NODE_DIST_BASE = `https://nodejs.org/dist/v${NODE_RELEASE}`;

/** The deployed API. `CUSTOMS_NIGHT_API_BASE` overrides it for a build against another deployment. */
export const RELEASE_API_BASE = 'https://kustom-delta.vercel.app';

export function apiBaseForBuild(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CUSTOMS_NIGHT_API_BASE?.trim();
  return override && override.length > 0 ? override : RELEASE_API_BASE;
}

/** The version stamped into the exe and its file name: `apps/companion/package.json` `version`. */
export function companionVersion(): string {
  const pkg = JSON.parse(readFileSync(join(COMPANION_DIR, 'package.json'), 'utf8')) as { version?: unknown };
  if (typeof pkg.version !== 'string' || !/^\d+\.\d+\.\d+/.test(pkg.version)) {
    throw new Error('apps/companion/package.json has no semver "version"');
  }
  return pkg.version;
}

export function exeFileName(version: string): string {
  return `customs-night-${version}.exe`;
}

/**
 * Object keys in the bucket, exactly as the M2.6 brief states them: the link in the group chat is
 * `.../releases/latest/CustomsNight.exe`, the versioned copy is `.../releases/v<version>/CustomsNight.exe`.
 */
export const RELEASE_EXE_OBJECT = 'CustomsNight.exe';
export const LATEST_EXE_KEY = `latest/${RELEASE_EXE_OBJECT}`;
export const LATEST_README_KEY = 'latest/README.txt';

export function versionedExeKey(version: string): string {
  return `v${version}/${RELEASE_EXE_OBJECT}`;
}

/**
 * The hosted Supabase project the release goes to. Hard-coded on purpose: the user also owns an unrelated
 * project, and the upload refuses any other ref (`upload.ts`).
 */
export const RELEASE_PROJECT_REF = 'ubwpmxujdzssfqfbrbej';
export const RELEASE_BUCKET = 'releases';
export const RELEASE_KEY_ENV = 'CUSTOMS_NIGHT_RELEASE_SERVICE_ROLE_KEY';

export function storageBaseUrl(projectRef: string): string {
  return `https://${projectRef}.supabase.co/storage/v1`;
}

export function publicObjectUrl(projectRef: string, name: string): string {
  return `${storageBaseUrl(projectRef)}/object/public/${RELEASE_BUCKET}/${name}`;
}
