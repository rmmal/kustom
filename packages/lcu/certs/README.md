# Riot root certificate

`riotgames.pem` is the "LoL Game Engineering Certificate Authority" root that signs the League client's local
HTTPS certificate. `packages/lcu` pins to it by default (`DEFAULT_TLS_MODE`, see `src/tls.ts`).

- Source: `https://static.developer.riotgames.com/docs/lol/riotgames.pem` (Riot's developer portal static host),
  fetched 2026-09-08.
- Subject/issuer: `C=US, ST=California, L=Santa Monica, O=Riot Games, OU=LoL Game Engineering,
  CN=LoL Game Engineering Certificate Authority`
- Valid: 2013-12-04 to 2043-11-27
- SHA-256 fingerprint: `CA:8C:9D:32:5B:4C:DC:46:4C:6C:94:A5:85:C8:5E:91:EC:23:D4:0B:A5:BF:3A:E2:82:2B:95:1A:4A:50:4E:A3`
- Signature: sha1WithRSAEncryption (the root's own self-signature; harmless at Node's default OpenSSL security
  level, which does not check a trust anchor's signature. A SHA-1 signed *leaf* would need
  `{ mode: 'pinned', legacyDigests: true }`).

To re-verify: `openssl x509 -in riotgames.pem -noout -subject -dates -fingerprint -sha256`.

Test-only certificates live in `src/test-support/certs/` and are not related to Riot.
