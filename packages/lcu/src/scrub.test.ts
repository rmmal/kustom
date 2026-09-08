import { describe, expect, it } from 'vitest';
import {
  DROPPED_PREVIEW_CHARS,
  isSensitiveUri,
  REDACTED,
  scrubDroppedFrame,
  scrubEvent,
  scrubText,
  scrubValue,
} from './scrub.js';
import type { LcuEvent } from './socket.js';

describe('isSensitiveUri', () => {
  it('denies login, RSO, Riot Client auth and chat', () => {
    for (const uri of [
      '/lol-login/v1/session',
      '/lol-rso-auth/v1/authorization',
      '/lol-rso-auth/v1/session',
      '/riotclient/auth-token',
      '/riotclient/auth/session',
      '/rso-auth/v1/authorization',
      '/lol-chat/v1/conversations/abc/messages',
      '/lol-chat/v1/me',
      '/lol-cookie-jar/v1/cookies',
    ]) {
      expect(isSensitiveUri(uri), uri).toBe(true);
    }
  });

  it('denies anything mentioning auth or token', () => {
    expect(isSensitiveUri('/lol-something/v1/access-token')).toBe(true);
    expect(isSensitiveUri('/lol-something/v1/AuthCode')).toBe(true);
    expect(isSensitiveUri('/lol-x/v1/oauth')).toBe(true);
  });

  it('keeps the URIs the companion needs', () => {
    for (const uri of [
      '/lol-lobby/v2/lobby',
      '/lol-gameflow/v1/gameflow-phase',
      '/lol-gameflow/v1/session',
      '/lol-end-of-game/v1/eog-stats-block',
      '/lol-summoner/v1/current-summoner',
      '/lol-ranked/v1/current-ranked-stats',
      '/lol-match-history/v1/games/123',
    ]) {
      expect(isSensitiveUri(uri), uri).toBe(false);
    }
  });
});

describe('scrubValue', () => {
  it('replaces credential-looking keys at any depth and leaves the rest', () => {
    const scrubbed = scrubValue({
      puuid: 'p',
      idToken: 'x',
      nested: { accessToken: 'y', refresh_token: 'z', authorization: 'Basic ...', name: 'ok' },
      list: [{ password: 'pw', kills: 3 }, 'plain', null],
      cookie: 'c',
    });
    expect(scrubbed).toEqual({
      puuid: 'p',
      idToken: REDACTED,
      nested: { accessToken: REDACTED, refresh_token: REDACTED, authorization: REDACTED, name: 'ok' },
      list: [{ password: REDACTED, kills: 3 }, 'plain', null],
      cookie: REDACTED,
    });
  });

  it('passes primitives through and does not mutate the input', () => {
    expect(scrubValue('Lobby')).toBe('Lobby');
    expect(scrubValue(null)).toBeNull();
    const input = { token: 't', inner: { a: 1 } };
    const out = scrubValue(input) as { inner: { a: number } };
    expect(input.token).toBe('t');
    expect(out.inner).not.toBe(input.inner);
  });
});

describe('scrubEvent', () => {
  it('drops data entirely for sensitive URIs', () => {
    const event: LcuEvent = {
      topic: 'OnJsonApiEvent',
      uri: '/lol-login/v1/session',
      eventType: 'Update',
      data: { idToken: 'secret', puuid: 'p' },
    };
    const result = scrubEvent(event);
    expect(result).toEqual({
      kind: 'redacted',
      event: { topic: 'OnJsonApiEvent', uri: '/lol-login/v1/session', eventType: 'Update' },
    });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('keeps ordinary events with sensitive keys scrubbed', () => {
    const event: LcuEvent = {
      topic: 'OnJsonApiEvent',
      uri: '/lol-lobby/v2/lobby',
      eventType: 'Update',
      data: { partyId: 'party', members: [{ puuid: 'p', summonerName: 'n' }], inviteToken: 'nope' },
    };
    expect(scrubEvent(event)).toEqual({
      kind: 'kept',
      event: {
        ...event,
        data: { partyId: 'party', members: [{ puuid: 'p', summonerName: 'n' }], inviteToken: REDACTED },
      },
    });
  });
});

describe('scrubDroppedFrame', () => {
  const SECRET = 'eyJhbGciOiJSUzI1NiJ9.SECRET-TOKEN-VALUE';

  it('keeps only the URI of a malformed frame from a sensitive URI', () => {
    // Fails LcuEventFrameSchema (unknown eventType) but is an RSO payload.
    const raw = JSON.stringify([
      8,
      'OnJsonApiEvent',
      {
        data: { accessToken: SECRET, idToken: SECRET },
        eventType: 'Bogus',
        uri: '/lol-rso-auth/v1/authorization',
      },
    ]);
    const line = scrubDroppedFrame(raw);
    expect(line).toEqual({ dropped: true, redacted: true, uri: '/lol-rso-auth/v1/authorization' });
    expect(JSON.stringify(line)).not.toContain('SECRET');
  });

  it('finds the URI in an object-shaped frame too', () => {
    const raw = JSON.stringify({ uri: '/lol-login/v1/session', data: { idToken: SECRET } });
    expect(scrubDroppedFrame(raw)).toEqual({ dropped: true, redacted: true, uri: '/lol-login/v1/session' });
  });

  it('key-scrubs a malformed frame from an ordinary URI and keeps the rest', () => {
    const raw = JSON.stringify([
      8,
      't',
      { data: { partyId: 'p', inviteToken: SECRET }, eventType: 'Upsert', uri: '/lol-lobby/v2/lobby' },
    ]);
    const line = scrubDroppedFrame(raw);
    expect(line).toEqual({
      dropped: true,
      frame: [
        8,
        't',
        { data: { partyId: 'p', inviteToken: REDACTED }, eventType: 'Upsert', uri: '/lol-lobby/v2/lobby' },
      ],
    });
    expect(JSON.stringify(line)).not.toContain('SECRET');
  });

  it('writes a bounded, text-scrubbed preview for a frame that is not JSON', () => {
    const truncated = `[8,"OnJsonApiEvent",{"uri":"/lol-rso-auth/v1/authorization","accessToken":"${SECRET}","refresh_token":${SECRET}, password = ${SECRET}`;
    const line = scrubDroppedFrame(truncated);
    expect(line.dropped).toBe(true);
    if ('preview' in line) {
      expect(line.preview.length).toBeLessThanOrEqual(DROPPED_PREVIEW_CHARS);
      expect(line.preview).toContain('/lol-rso-auth/v1/authorization');
      expect(line.preview).toContain(`"accessToken":"${REDACTED}"`);
    } else {
      throw new Error('expected a preview');
    }
    expect(JSON.stringify(line)).not.toContain('SECRET');

    const long = `not json ${'x'.repeat(1000)} token=${SECRET}`;
    const longLine = scrubDroppedFrame(long);
    expect(JSON.stringify(longLine)).not.toContain('SECRET');
    expect('preview' in longLine && longLine.preview.length).toBeLessThanOrEqual(DROPPED_PREVIEW_CHARS);
  });

  it('scrubText handles bare and quoted pairs', () => {
    expect(scrubText('token=abc, "password": "p w", cookie:zzz; name=ok')).toBe(
      `token="${REDACTED}", "password": "${REDACTED}", cookie:"${REDACTED}"; name=ok`,
    );
  });
});
