import { companionLobbyPayloadSchema, companionRankPayloadSchema } from '@customs/db/schemas';
import { describe, expect, it } from 'vitest';
import { apiErrorSchema, jsonError, parseJsonBody } from './http';

/**
 * The request/response envelope. Payload validation is exercised through the schemas the
 * companion actually sends, so a change to either side shows up here.
 */

function post(body: string): Request {
  return new Request('http://localhost/api/companion/lobby', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

describe('jsonError', () => {
  it('matches the error schema and omits issues when there are none', async () => {
    const response = jsonError(401, 'missing bearer token');

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(apiErrorSchema.parse(body)).toEqual({ ok: false, error: 'missing bearer token' });
    expect(body).not.toHaveProperty('issues');
  });
});

describe('parseJsonBody', () => {
  it('accepts a well formed lobby payload', async () => {
    const result = await parseJsonBody(
      post(JSON.stringify({ partyId: 'party-1', members: [{ puuid: 'p1' }] })),
      companionLobbyPayloadSchema,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.partyId).toBe('party-1');
    // Defaults the companion may leave out.
    expect(result.data.members[0]).toMatchObject({ side: null, isSpectator: false });
    expect(result.data.lobbyName).toBeNull();
  });

  it('answers 400 when the body is not JSON at all', async () => {
    const result = await parseJsonBody(post('{not json'), companionLobbyPayloadSchema);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(400);
    expect(await result.response.json()).toEqual({ ok: false, error: 'request body is not valid JSON' });
  });

  it('answers 400 with the failing paths when the body does not match the schema', async () => {
    const result = await parseJsonBody(
      post(JSON.stringify({ partyId: '', members: [{ puuid: 'p1', side: 300 }] })),
      companionLobbyPayloadSchema,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(400);

    const body = apiErrorSchema.parse(await result.response.json());
    expect(body.error).toBe('request body failed validation');
    expect(body.issues?.map((issue) => issue.path)).toEqual(['partyId', 'members.0.side']);
  });

  it('answers 400 when a required field is missing', async () => {
    const result = await parseJsonBody(post(JSON.stringify({ tier: 'GOLD' })), companionRankPayloadSchema);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(400);
    const body = apiErrorSchema.parse(await result.response.json());
    expect(body.issues?.map((issue) => issue.path)).toEqual(['puuid']);
  });
});
