import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EOG_SECRET_KEYS, isEogSecretKey, REDACTED, scrubRawEogBlock } from './scrub';

/**
 * `games.raw` is public-read under RLS, so these two values leaving the server is a leak.
 * Everything else in the block has to survive intact: it is what M5.2's rebuild reads.
 */

describe('scrubRawEogBlock', () => {
  it('replaces both chat credentials at the top level', () => {
    const scrubbed = scrubRawEogBlock({
      gameId: 4_000_969_091,
      mucJwtDto: { jwt: 'eyJhbGciOi...', channelClaim: 'x' },
      multiUserChatPassword: 'hunter2',
      multiUserChatId: 'not-a-secret',
    });

    expect(scrubbed).toEqual({
      gameId: 4_000_969_091,
      mucJwtDto: REDACTED,
      multiUserChatPassword: REDACTED,
      multiUserChatId: 'not-a-secret',
    });
  });

  it('replaces them at any depth, inside arrays too', () => {
    const scrubbed = scrubRawEogBlock({
      teams: [
        { teamId: 100, players: [{ puuid: 'a', mucJwtDto: 'secret-1' }] },
        { teamId: 200, players: [{ puuid: 'b', nested: { deep: { multiUserChatPassword: 'secret-2' } } }] },
      ],
    });

    const text = JSON.stringify(scrubbed);
    expect(text).not.toContain('secret-1');
    expect(text).not.toContain('secret-2');
    expect(text.match(/\[redacted\]/g)).toHaveLength(2);
    // Nothing else moved.
    expect(text).toContain('"teamId":100');
    expect(text).toContain('"puuid":"b"');
  });

  it('never mutates the block it was given', () => {
    const original = { mucJwtDto: 'live-jwt', teams: [{ multiUserChatPassword: 'live-password' }] };

    scrubRawEogBlock(original);

    expect(original.mucJwtDto).toBe('live-jwt');
    expect(original.teams[0]?.multiUserChatPassword).toBe('live-password');
  });

  it('keeps every other value, type for type', () => {
    const block = {
      gameLength: 913,
      ranked: false,
      invalid: null,
      empty: {},
      list: [1, 'two', null, { three: 3 }],
    };

    expect(scrubRawEogBlock(block)).toEqual(block);
  });

  it('matches the key however the client cases it', () => {
    expect(isEogSecretKey('mucJwtDto')).toBe(true);
    expect(isEogSecretKey('MUCJWTDTO')).toBe(true);
    expect(isEogSecretKey('multiuserchatpassword')).toBe(true);
    expect(isEogSecretKey('multiUserChatId')).toBe(false);
    expect(scrubRawEogBlock({ MucJwtDTO: 'x' })).toEqual({ MucJwtDTO: REDACTED });
  });

  it('leaves a __proto__ key an ordinary key', () => {
    // Object.fromEntries defines rather than assigns; a client payload cannot reach a prototype.
    const scrubbed = scrubRawEogBlock(JSON.parse('{"__proto__": {"polluted": true}}'));

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(scrubbed as object)).toEqual(['__proto__']);
  });

  it('leaves the committed 16.17 fixture with no credential values in it', () => {
    // The smoke script already scrubbed the fixture on capture, so this asserts the server's
    // own pass is a no-op on an already-clean block rather than proving the redaction.
    const fixture = JSON.parse(
      readFileSync(new URL('../../lcu/fixtures/16.17/eog-stats-block.json', import.meta.url), 'utf8'),
    ) as { body: Record<string, unknown> };

    const scrubbed = scrubRawEogBlock(fixture.body);

    expect(scrubbed.mucJwtDto).toBe(REDACTED);
    expect(scrubbed.multiUserChatPassword).toBe(REDACTED);
    expect(EOG_SECRET_KEYS).toEqual(['mucJwtDto', 'multiUserChatPassword']);
  });
});
