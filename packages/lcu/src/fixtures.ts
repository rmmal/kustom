/**
 * Fixture layout helpers shared by the smoke script, the WS recorder and the tests.
 *
 * Layout (see fixtures/README.md):
 *   fixtures/<patch>/<endpoint-id>.json   one envelope per endpoint
 *   fixtures/<patch>/manifest.json        summary of the smoke run
 *   fixtures/<patch>/ws-events.ndjson     recorded WebSocket events
 *
 * `<patch>` is the first two components of the client version (`16.17.812.4632` -> `16.17`).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/', import.meta.url));

/** One saved response. `body` is the raw JSON body untouched; `bodyText` is set instead when it was not JSON. */
export const FixtureEnvelopeSchema = z.object({
  id: z.string(),
  method: z.string(),
  path: z.string(),
  status: z.number().int(),
  capturedAt: z.string(),
  patch: z.string(),
  clientVersion: z.string().nullable(),
  contentType: z.string().nullable(),
  body: z.unknown().optional(),
  bodyText: z.string().optional(),
  /** The request body that produced this answer, for a write captured by `--verify-commands` (M4.1). */
  request: z.unknown().optional(),
  /** Free text from the capturing tool (which event, what the client showed). */
  note: z.string().optional(),
});
export type FixtureEnvelope = z.infer<typeof FixtureEnvelopeSchema>;

/** `16.17.812.4632` -> `16.17`. Null when the string does not start with `major.minor`. */
export function patchFromVersion(version: string): string | null {
  const match = /^(\d+)\.(\d+)/.exec(version.trim());
  return match ? `${match[1]}.${match[2]}` : null;
}

function comparePatches(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/** Patch directories under `root`, newest first. Non-numeric directory names sort last. */
export function listPatchDirs(root: string = FIXTURES_DIR): string[] {
  if (!existsSync(root)) {
    return [];
  }
  const numeric = /^\d+(\.\d+)*$/;
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => {
      const an = numeric.test(a);
      const bn = numeric.test(b);
      if (an && bn) {
        return comparePatches(b, a);
      }
      if (an !== bn) {
        return an ? -1 : 1;
      }
      return b.localeCompare(a);
    });
}

export function fixturePath(patch: string, id: string, root: string = FIXTURES_DIR): string {
  return join(root, patch, `${id}.json`);
}

export type FixtureRead =
  | { readonly ok: true; readonly envelope: FixtureEnvelope }
  | { readonly ok: false; readonly reason: string };

export function readFixture(patch: string, id: string, root: string = FIXTURES_DIR): FixtureRead {
  const path = fixturePath(patch, id, root);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      reason: `invalid JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const parsed = FixtureEnvelopeSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, reason: `not a fixture envelope: ${path}` };
  }
  return { ok: true, envelope: parsed.data };
}

/** Writes one envelope to `<root>/<patch>/<id>.json` (creating the directory). Callers scrub the body first. */
export function writeFixture(envelope: FixtureEnvelope, root: string = FIXTURES_DIR): string {
  const path = fixturePath(envelope.patch, envelope.id, root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(envelope, null, 2)}\n`);
  return path;
}

/** The newest saved envelope for an endpoint id across all patch directories, if any. */
export function newestFixture(
  id: string,
  root: string = FIXTURES_DIR,
): { readonly patch: string; readonly envelope: FixtureEnvelope } | null {
  for (const patch of listPatchDirs(root)) {
    const read = readFixture(patch, id, root);
    if (read.ok) {
      return { patch, envelope: read.envelope };
    }
  }
  return null;
}

export interface ShapeDiff {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  /** Keys present in both whose JSON type changed (`object` -> `array`, `number` -> `string`, ...). */
  readonly typeChanged: readonly string[];
  /** Set when one side is not an object at all; the shape comparison is then only `typeof`. */
  readonly note?: string;
}

function jsonType(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  return typeof value;
}

/**
 * Compares the top-level key sets of two JSON values. Arrays are compared by their first element, which is
 * enough for list endpoints whose items share a shape. Deeper diffs are a job for the M0.3 zod schemas.
 */
export function diffTopLevelKeys(previous: unknown, current: unknown): ShapeDiff {
  const previousType = jsonType(previous);
  const currentType = jsonType(current);
  if (previousType !== currentType) {
    return {
      added: [],
      removed: [],
      typeChanged: [],
      note: `type changed: ${previousType} -> ${currentType}`,
    };
  }
  if (previousType === 'array') {
    const prevArray = previous as unknown[];
    const currArray = current as unknown[];
    if (prevArray.length === 0 || currArray.length === 0) {
      return {
        added: [],
        removed: [],
        typeChanged: [],
        note: 'one side is an empty array; nothing to compare',
      };
    }
    const diff = diffTopLevelKeys(prevArray[0], currArray[0]);
    return { ...diff, note: `compared first array element${diff.note ? `; ${diff.note}` : ''}` };
  }
  if (previousType !== 'object') {
    return { added: [], removed: [], typeChanged: [], note: `both are ${previousType}; nothing to compare` };
  }
  const prevObject = previous as Record<string, unknown>;
  const currObject = current as Record<string, unknown>;
  const prevKeys = new Set(Object.keys(prevObject));
  const currKeys = new Set(Object.keys(currObject));
  const added = [...currKeys].filter((key) => !prevKeys.has(key)).sort();
  const removed = [...prevKeys].filter((key) => !currKeys.has(key)).sort();
  const typeChanged = [...prevKeys]
    .filter((key) => currKeys.has(key) && jsonType(prevObject[key]) !== jsonType(currObject[key]))
    .sort();
  return { added, removed, typeChanged };
}

export function isShapeDiffEmpty(diff: ShapeDiff): boolean {
  return diff.added.length === 0 && diff.removed.length === 0 && diff.typeChanged.length === 0;
}
