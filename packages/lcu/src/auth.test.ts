import type { PeerCertificate } from 'node:tls';
import { describe, expect, it } from 'vitest';
import { basicAuthHeader, buildUrl, httpBaseUrl, LCU_HOST, wsBaseUrl } from './auth.js';
import {
  checkServerIdentity,
  describeTlsMode,
  isTlsError,
  loadRiotRootCa,
  tlsConnectionOptions,
} from './tls.js';

describe('basicAuthHeader', () => {
  it('encodes riot:<password> in base64', () => {
    expect(basicAuthHeader('secret')).toBe(`Basic ${Buffer.from('riot:secret').toString('base64')}`);
    expect(basicAuthHeader('secret')).toBe('Basic cmlvdDpzZWNyZXQ=');
  });

  it('keeps unusual characters intact', () => {
    const password = 'a-b_c+d/e=f:g';
    expect(Buffer.from(basicAuthHeader(password).slice('Basic '.length), 'base64').toString()).toBe(
      `riot:${password}`,
    );
  });
});

describe('urls', () => {
  it('binds to loopback only', () => {
    expect(LCU_HOST).toBe('127.0.0.1');
    expect(httpBaseUrl(51234)).toBe('https://127.0.0.1:51234');
    expect(wsBaseUrl(51234)).toBe('wss://127.0.0.1:51234');
  });

  it('joins absolute paths verbatim, including query strings', () => {
    expect(buildUrl('https://127.0.0.1:1', '/lol-summoner/v1/current-summoner')).toBe(
      'https://127.0.0.1:1/lol-summoner/v1/current-summoner',
    );
    expect(buildUrl('https://127.0.0.1:1', '/lol-summoner/v1/alias/lookup?gameName=a%20b&tagLine=EUNE')).toBe(
      'https://127.0.0.1:1/lol-summoner/v1/alias/lookup?gameName=a%20b&tagLine=EUNE',
    );
  });

  it('refuses relative paths', () => {
    expect(() => buildUrl('https://127.0.0.1:1', 'lol-summoner')).toThrow(/must start with/);
  });
});

describe('tls options', () => {
  it('defaults to pinning the vendored Riot root with the loopback identity check', () => {
    const options = tlsConnectionOptions();
    expect(options.rejectUnauthorized).toBe(true);
    expect(options.ca).toBe(loadRiotRootCa());
    expect(String(options.ca)).toContain('BEGIN CERTIFICATE');
    expect(options.checkServerIdentity).toBe(checkServerIdentity);
    expect(options.ciphers).toBeUndefined();
  });

  it('lowers the OpenSSL security level only when legacy digests are requested', () => {
    expect(tlsConnectionOptions({ mode: 'pinned', legacyDigests: true }).ciphers).toBe('DEFAULT@SECLEVEL=0');
  });

  it('accepts a custom trust anchor', () => {
    expect(tlsConnectionOptions({ mode: 'pinned', ca: 'PEM' }).ca).toBe('PEM');
  });

  it('insecure mode disables verification and nothing else', () => {
    expect(tlsConnectionOptions({ mode: 'insecure' })).toEqual({ rejectUnauthorized: false });
  });

  it('describes modes for logs', () => {
    expect(describeTlsMode({ mode: 'pinned' })).toBe('pinned to riotgames.pem');
    expect(describeTlsMode({ mode: 'pinned', legacyDigests: true })).toContain('legacy digests');
    expect(describeTlsMode({ mode: 'insecure' })).toContain('insecure');
  });

  it('classifies certificate failures as TLS errors and refused connections as not', () => {
    expect(isTlsError('SELF_SIGNED_CERT_IN_CHAIN', '')).toBe(true);
    expect(isTlsError('UNABLE_TO_VERIFY_LEAF_SIGNATURE', '')).toBe(true);
    expect(isTlsError('ERR_TLS_CERT_ALTNAME_INVALID', '')).toBe(true);
    expect(isTlsError('EPROTO', '')).toBe(true);
    expect(isTlsError('UNSPECIFIED', 'CA signature digest algorithm too weak')).toBe(true);
    expect(isTlsError(undefined, 'CA signature digest algorithm too weak')).toBe(true);
    expect(isTlsError(undefined, 'certificate has expired')).toBe(true);
    expect(isTlsError('ECONNREFUSED', 'connect ECONNREFUSED')).toBe(false);
    expect(isTlsError('ETIMEDOUT', '')).toBe(false);
  });
});

describe('checkServerIdentity', () => {
  const cert = {
    subject: { CN: 'fake-lcu test only' },
    subjectaltname: 'IP Address:127.0.0.1, DNS:localhost',
  } as unknown as PeerCertificate;

  it('skips the check for the loopback address only', () => {
    expect(checkServerIdentity('127.0.0.1', {} as PeerCertificate)).toBeUndefined();
  });

  it('delegates to Node for any other host', () => {
    expect(checkServerIdentity('localhost', cert)).toBeUndefined();
    const error = checkServerIdentity('example.com', cert);
    expect(error).toBeInstanceOf(Error);
    expect((error as NodeJS.ErrnoException).code).toBe('ERR_TLS_CERT_ALTNAME_INVALID');
    expect(checkServerIdentity('10.0.0.1', cert)).toBeInstanceOf(Error);
  });
});
