import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canFill, fillPath, READ_ENDPOINTS } from './endpoints.js';
import {
  diffTopLevelKeys,
  type FixtureEnvelope,
  isShapeDiffEmpty,
  listPatchDirs,
  newestFixture,
  patchFromVersion,
  readFixture,
} from './fixtures.js';

describe('patchFromVersion', () => {
  it('keeps major.minor', () => {
    expect(patchFromVersion('16.17.812.4632')).toBe('16.17');
    expect(patchFromVersion('14.1.555.1234\n')).toBe('14.1');
    expect(patchFromVersion('16.17')).toBe('16.17');
  });

  it('returns null for anything else', () => {
    expect(patchFromVersion('')).toBeNull();
    expect(patchFromVersion('latest')).toBeNull();
    expect(patchFromVersion('16')).toBeNull();
  });
});

describe('diffTopLevelKeys', () => {
  it('reports added, removed and retyped keys', () => {
    const diff = diffTopLevelKeys({ a: 1, b: 'x', c: null, d: [] }, { a: 1, b: 2, d: {}, e: true });
    expect(diff).toEqual({ added: ['e'], removed: ['c'], typeChanged: ['b', 'd'] });
    expect(isShapeDiffEmpty(diff)).toBe(false);
  });

  it('is empty for the same shape with different values', () => {
    const diff = diffTopLevelKeys({ a: 1, b: [1] }, { a: 2, b: [] });
    expect(isShapeDiffEmpty(diff)).toBe(true);
  });

  it('compares first elements of arrays', () => {
    const diff = diffTopLevelKeys([{ gameId: 1 }], [{ gameId: 2, queueId: 0 }]);
    expect(diff.added).toEqual(['queueId']);
    expect(diff.note).toContain('first array element');
    expect(diffTopLevelKeys([], [{ a: 1 }]).note).toContain('empty array');
  });

  it('reports a top-level type change', () => {
    expect(diffTopLevelKeys({ a: 1 }, [1]).note).toBe('type changed: object -> array');
    expect(diffTopLevelKeys('16.17', null).note).toBe('type changed: string -> null');
    expect(diffTopLevelKeys('a', 'b').note).toContain('both are string');
  });
});

describe('fixture directories', () => {
  let root: string;

  const envelope = (patch: string, id: string, body: unknown): FixtureEnvelope => ({
    id,
    method: 'GET',
    path: `/${id}`,
    status: 200,
    capturedAt: '2026-09-08T00:00:00.000Z',
    patch,
    clientVersion: `${patch}.1.1`,
    contentType: 'application/json',
    body,
  });

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'lcu-fixtures-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('lists patch directories newest first, numerically', async () => {
    for (const patch of ['16.9', '16.17', '15.24', 'unknown-2026-09-08']) {
      await mkdir(join(root, patch));
    }
    await writeFile(join(root, 'README.md'), '');
    expect(listPatchDirs(root)).toEqual(['16.17', '16.9', '15.24', 'unknown-2026-09-08']);
    expect(listPatchDirs(join(root, 'missing'))).toEqual([]);
  });

  it('reads envelopes and finds the newest for an id', async () => {
    await mkdir(join(root, '16.9'));
    await mkdir(join(root, '16.17'));
    await writeFile(join(root, '16.9', 'lobby.json'), JSON.stringify(envelope('16.9', 'lobby', { old: 1 })));
    await writeFile(join(root, '16.17', 'other.json'), JSON.stringify(envelope('16.17', 'other', {})));
    await writeFile(join(root, '16.17', 'broken.json'), '{nope');

    const newest = newestFixture('lobby', root);
    expect(newest?.patch).toBe('16.9');
    expect(newest?.envelope.body).toEqual({ old: 1 });
    expect(newestFixture('nothing', root)).toBeNull();

    const broken = readFixture('16.17', 'broken', root);
    expect(broken.ok).toBe(false);
    const missing = readFixture('16.17', 'lobby', root);
    expect(missing.ok).toBe(false);
  });
});

describe('endpoint catalogue', () => {
  it('fills and encodes path templates', () => {
    expect(fillPath('/lol-ranked/v1/ranked-stats/{puuid}', { puuid: 'a b' })).toBe(
      '/lol-ranked/v1/ranked-stats/a%20b',
    );
    expect(
      fillPath('/lol-summoner/v1/alias/lookup?gameName={gameName}&tagLine={tagLine}', {
        gameName: 'Näme Ω',
        tagLine: 'EUNE',
      }),
    ).toBe('/lol-summoner/v1/alias/lookup?gameName=N%C3%A4me%20%CE%A9&tagLine=EUNE');
    expect(fillPath('/x/{gameId}', {})).toBe('/x/{gameId}');
  });

  it('knows which endpoints can be hit with the values at hand', () => {
    const history = READ_ENDPOINTS.find((endpoint) => endpoint.id === 'match-history');
    const phase = READ_ENDPOINTS.find((endpoint) => endpoint.id === 'gameflow-phase');
    expect(history && canFill(history, {})).toBe(false);
    expect(history && canFill(history, { puuid: 'p' })).toBe(true);
    expect(phase && canFill(phase, {})).toBe(true);
  });

  it('has unique ids and only GET-safe paths', () => {
    const ids = READ_ENDPOINTS.map((endpoint) => endpoint.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const endpoint of READ_ENDPOINTS) {
      expect(endpoint.path.startsWith('/')).toBe(true);
      expect(endpoint.path).not.toMatch(/champ-select|matchmaking|ready-check/);
    }
  });
});
