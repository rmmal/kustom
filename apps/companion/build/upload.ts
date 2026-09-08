/**
 * Step three of the release build: publish the exe and the friend README to the public Supabase Storage
 * bucket `releases` on the hosted project (docs/04-decisions.md, 2026-09-08).
 *
 *   CUSTOMS_NIGHT_RELEASE_SERVICE_ROLE_KEY=... pnpm --filter companion upload
 *
 * Objects, all upserted so a re-run is safe (keys as the M2.6 brief states them):
 *   latest/README.txt              README-friends.md, verbatim (small; uploaded first, so a transport problem
 *                                  shows before the big one)
 *   v<version>/CustomsNight.exe    the versioned build (stays reachable when a newer one misbehaves)
 *   latest/CustomsNight.exe        the link for the group chat
 *
 * The bucket is created public if it does not exist. The target project ref is hard-coded and printed; any
 * other ref is refused, because the same account owns an unrelated project. The key is read from the
 * environment only (`.env.example` documents it) and never printed.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { Agent, fetch as undiciFetch } from 'undici';
import {
  companionVersion,
  DIST_DIR,
  exeFileName,
  FRIEND_README_FILE,
  LATEST_EXE_KEY,
  LATEST_README_KEY,
  publicObjectUrl,
  RELEASE_BUCKET,
  RELEASE_KEY_ENV,
  RELEASE_PROJECT_REF,
  storageBaseUrl,
  versionedExeKey,
} from './config.js';

/** The slice of fetch the upload uses; tests can inject one. */
export type UploadFetch = (
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: Buffer | string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }>;

export interface UploadOptions {
  readonly version?: string;
  readonly projectRef?: string;
  readonly serviceRoleKey?: string;
  readonly fetch?: UploadFetch;
}

/**
 * A 90 MB body on a slow uplink takes minutes, and Node's global fetch gives up on headers after 300 s while
 * the body is still going out (`UND_ERR_HEADERS_TIMEOUT`). undici's own fetch with both timeouts off.
 */
function patientFetch(): UploadFetch {
  const dispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 });
  return async (url, init) => {
    const response = await undiciFetch(url, { ...init, dispatcher });
    return {
      ok: response.ok,
      status: response.status,
      text: () => response.text(),
      json: () => response.json(),
    };
  };
}

export interface UploadedObject {
  readonly name: string;
  readonly bytes: number;
  readonly url: string;
}

export interface UploadResult {
  readonly projectRef: string;
  readonly bucketCreated: boolean;
  readonly objects: readonly UploadedObject[];
}

function readKey(env: NodeJS.ProcessEnv): string {
  const key = env[RELEASE_KEY_ENV]?.trim();
  if (!key) {
    throw new Error(
      `${RELEASE_KEY_ENV} is not set. It is the service_role key of the hosted project ` +
        `(packages/db: supabase projects api-keys --project-ref ${RELEASE_PROJECT_REF} -o json).`,
    );
  }
  return key;
}

async function ensureBucket(
  base: string,
  headers: Record<string, string>,
  fetchImpl: UploadFetch,
): Promise<boolean> {
  const listed = await fetchImpl(`${base}/bucket/${RELEASE_BUCKET}`, { headers });
  if (listed.ok) {
    const bucket = (await listed.json()) as { public?: unknown };
    if (bucket.public !== true) {
      const updated = await fetchImpl(`${base}/bucket/${RELEASE_BUCKET}`, {
        method: 'PUT',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ public: true }),
      });
      if (!updated.ok) {
        throw new Error(
          `bucket ${RELEASE_BUCKET} exists but could not be made public: HTTP ${updated.status}`,
        );
      }
    }
    return false;
  }
  if (listed.status !== 404 && listed.status !== 400) {
    throw new Error(`could not read bucket ${RELEASE_BUCKET}: HTTP ${listed.status} ${await listed.text()}`);
  }
  const created = await fetchImpl(`${base}/bucket`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ id: RELEASE_BUCKET, name: RELEASE_BUCKET, public: true }),
  });
  if (created.ok) {
    return true;
  }
  if (created.status === 409) {
    return false;
  }
  throw new Error(
    `could not create bucket ${RELEASE_BUCKET}: HTTP ${created.status} ${await created.text()}`,
  );
}

async function putObject(
  base: string,
  headers: Record<string, string>,
  fetchImpl: UploadFetch,
  name: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  let response: Awaited<ReturnType<UploadFetch>>;
  try {
    response = await fetchImpl(`${base}/object/${RELEASE_BUCKET}/${name}`, {
      method: 'POST',
      headers: { ...headers, 'content-type': contentType, 'x-upsert': 'true' },
      body,
    });
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : undefined;
    const detail = cause ? ` (${'code' in cause ? String(cause.code) : cause.message})` : '';
    throw new Error(
      `upload of ${name} (${body.byteLength} bytes) failed before a response: ${error instanceof Error ? error.message : String(error)}${detail}`,
    );
  }
  if (!response.ok) {
    const text = await response.text();
    if (response.status === 413 || /exceeded the maximum allowed size|too large/i.test(text)) {
      throw new Error(
        `${name} (${(body.byteLength / (1024 * 1024)).toFixed(1)} MiB) is over the project's upload size limit: ` +
          `HTTP ${response.status} ${text}. Raise the global file size limit in the Supabase dashboard ` +
          '(Storage settings) or move to a plan that allows it.',
      );
    }
    throw new Error(`upload of ${name} failed: HTTP ${response.status} ${text}`);
  }
}

export async function upload(options: UploadOptions = {}): Promise<UploadResult> {
  const version = options.version ?? companionVersion();
  const projectRef =
    options.projectRef ?? process.env.CUSTOMS_NIGHT_RELEASE_PROJECT_REF ?? RELEASE_PROJECT_REF;
  console.log(`targeting Supabase project ref ${projectRef}`);
  if (projectRef !== RELEASE_PROJECT_REF) {
    throw new Error(
      `refusing to upload to ${projectRef}: the Customs Night project is ${RELEASE_PROJECT_REF}`,
    );
  }
  const key = options.serviceRoleKey ?? readKey(process.env);
  const fetchImpl = options.fetch ?? patientFetch();
  const base = storageBaseUrl(projectRef);
  const headers = { authorization: `Bearer ${key}`, apikey: key };

  const exePath = join(DIST_DIR, exeFileName(version));
  if (!existsSync(exePath)) {
    throw new Error(`${exePath} does not exist; run pnpm --filter companion build:win first`);
  }
  const exe = readFileSync(exePath);
  const readme = readFileSync(FRIEND_README_FILE);

  const bucketCreated = await ensureBucket(base, headers, fetchImpl);
  console.log(bucketCreated ? `created public bucket ${RELEASE_BUCKET}` : `bucket ${RELEASE_BUCKET} exists`);

  const plan: { name: string; body: Buffer; type: string }[] = [
    { name: LATEST_README_KEY, body: readme, type: 'text/plain; charset=utf-8' },
    { name: versionedExeKey(version), body: exe, type: 'application/vnd.microsoft.portable-executable' },
    { name: LATEST_EXE_KEY, body: exe, type: 'application/vnd.microsoft.portable-executable' },
  ];
  const objects: UploadedObject[] = [];
  for (const item of plan) {
    await putObject(base, headers, fetchImpl, item.name, item.body, item.type);
    const url = publicObjectUrl(projectRef, item.name);
    objects.push({ name: item.name, bytes: item.body.byteLength, url });
    console.log(`uploaded ${item.name} (${item.body.byteLength} bytes) -> ${url}`);
  }
  console.log(`local exe: ${exePath} (${statSync(exePath).size} bytes)`);
  return { projectRef, bucketCreated, objects };
}

function isMain(): boolean {
  const entry = process.argv[1];
  return typeof entry === 'string' && /upload\.(ts|js|cjs|mjs)$/.test(entry);
}

if (isMain()) {
  const { values } = parseArgs({ options: { version: { type: 'string' } } });
  upload(values.version ? { version: values.version } : {}).then(
    () => {},
    (error) => {
      console.error('upload failed:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
