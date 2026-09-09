import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveLocalStack } from './localStack';
import {
  COMPANION_COMMAND_TTL_MS,
  companionCommandKindSchema,
  companionCommandPayloadSchemas,
  companionCommandResultSchemas,
  companionCommandStatusSchema,
} from './schemas';

/**
 * `companion_commands` after `0006_command_queue.sql`, exercised through PostgREST the way the
 * API reaches it, and **pinned to the zod enums**: every value in
 * `companionCommandKindSchema` and `companionCommandStatusSchema` is a value the column
 * accepts, and a value outside them is refused by Postgres rather than stored. That is what
 * stops the wire vocabulary and the database vocabulary drifting apart — the generated types
 * would keep typechecking either way.
 *
 * Skipped, not failed, when the local stack is not running (`pnpm db:start`), so
 * `pnpm -r test` stays green on a machine without Docker. Every row it creates is namespaced
 * with a run id and deleted afterwards.
 */

const stack = await resolveLocalStack();

interface RestResult {
  status: number;
  ok: boolean;
  body: unknown;
}

function rows(body: unknown): Record<string, unknown>[] {
  return Array.isArray(body) ? (body as Record<string, unknown>[]) : [];
}

if (stack === null) {
  describe.skip('companion_commands against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  const { url, anonKey, serviceRoleKey } = stack;

  async function rest(caller: 'service' | 'anon', path: string, init: RequestInit = {}): Promise<RestResult> {
    const key = caller === 'service' ? serviceRoleKey : anonKey;
    const response = await fetch(`${url}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return { status: response.status, ok: response.ok, body };
  }

  function insert(table: string, payload: unknown): Promise<RestResult> {
    return rest('service', table, {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload),
    });
  }

  /** One valid payload per kind, straight from the wire schemas so the two cannot drift. */
  const PAYLOADS: Record<string, unknown> = {
    create_lobby: companionCommandPayloadSchemas.create_lobby.parse({
      lobbyName: 'kustom night',
      lobbyPassword: '4821',
    }),
    invite: companionCommandPayloadSchemas.invite.parse({
      puuid: 'cmd-payload-puuid',
      summonerId: '2686822975473024',
    }),
    switch_side: companionCommandPayloadSchemas.switch_side.parse({ targetSide: 200 }),
  };

  const runId = `cmd-${crypto.randomUUID().slice(0, 8)}`;
  const puuid = `${runId}-player`;
  let playerId = '';

  beforeAll(async () => {
    const player = await insert('players', { puuid, game_name: 'Rami', tag_line: 'EUW' });
    expect(player.status).toBe(201);
    playerId = String(rows(player.body)[0]?.id ?? '');
  });

  afterAll(async () => {
    // `on delete cascade` from players takes the commands with it; be explicit anyway so a
    // failed beforeAll still leaves the shared stack clean.
    if (playerId !== '') {
      await rest('service', `companion_commands?target_player_id=eq.${playerId}`, { method: 'DELETE' });
    }
    await rest('service', `players?puuid=like.${runId}*`, { method: 'DELETE' });
  });

  describe('the kind enum is the zod enum', () => {
    it('accepts every kind the wire schema names', async () => {
      for (const kind of companionCommandKindSchema.options) {
        const created = await insert('companion_commands', {
          target_player_id: playerId,
          kind,
          payload: PAYLOADS[kind],
        });
        expect(created.status, `${kind} should be a valid companion_command_kind`).toBe(201);
        expect(rows(created.body)[0]?.kind).toBe(kind);
      }
    });

    it('refuses a kind the wire schema does not name', async () => {
      const created = await insert('companion_commands', {
        target_player_id: playerId,
        kind: 'start_champ_select',
        payload: {},
      });
      expect(created.ok).toBe(false);
      expect(companionCommandKindSchema.safeParse('start_champ_select').success).toBe(false);
    });

    it('has exactly the three kinds, in the order the enum declares them', () => {
      expect(companionCommandKindSchema.options).toEqual(['create_lobby', 'invite', 'switch_side']);
      // One TTL and one payload and one result schema per kind, so a fourth kind cannot be
      // added in one place only.
      expect(Object.keys(COMPANION_COMMAND_TTL_MS).sort()).toEqual(
        [...companionCommandKindSchema.options].sort(),
      );
      expect(Object.keys(companionCommandPayloadSchemas).sort()).toEqual(
        [...companionCommandKindSchema.options].sort(),
      );
      expect(Object.keys(companionCommandResultSchemas).sort()).toEqual(
        [...companionCommandKindSchema.options].sort(),
      );
    });
  });

  describe('the status enum is the zod enum', () => {
    let commandId = '';

    beforeAll(async () => {
      const created = await insert('companion_commands', {
        target_player_id: playerId,
        kind: 'switch_side',
        payload: PAYLOADS.switch_side,
      });
      commandId = String(rows(created.body)[0]?.id ?? '');
    });

    it('accepts every status the wire schema names', async () => {
      for (const status of companionCommandStatusSchema.options) {
        const patched = await rest('service', `companion_commands?id=eq.${commandId}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ status }),
        });
        expect(patched.ok, `${status} should be a valid companion_command_status`).toBe(true);
        expect(rows(patched.body)[0]?.status).toBe(status);
      }
    });

    it('refuses a status the wire schema does not name', async () => {
      const patched = await rest('service', `companion_commands?id=eq.${commandId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'expired' }),
      });
      expect(patched.ok).toBe(false);
      expect(companionCommandStatusSchema.safeParse('expired').success).toBe(false);
    });
  });

  describe('the columns 0006 adds', () => {
    it('defaults a new row to pending, zero attempts, nothing sent and nothing back', async () => {
      const created = await insert('companion_commands', {
        target_player_id: playerId,
        kind: 'invite',
        payload: PAYLOADS.invite,
      });
      expect(created.status).toBe(201);
      const row = rows(created.body)[0];
      expect(row?.status).toBe('pending');
      expect(row?.attempts).toBe(0);
      expect(row?.sent_at).toBeNull();
      expect(row?.acked_at).toBeNull();
      expect(row?.result).toBeNull();
      expect(row?.error).toBeNull();

      // The 5-minute backstop for a row inserted without a TTL of its own.
      const created_at = Date.parse(String(row?.created_at));
      const expires_at = Date.parse(String(row?.expires_at));
      expect(expires_at - created_at).toBeGreaterThan(4 * 60_000);
      expect(expires_at - created_at).toBeLessThan(6 * 60_000);
    });

    it('stores what the ack route writes, including a result that parses as its kind', async () => {
      const ttl = COMPANION_COMMAND_TTL_MS.create_lobby;
      const now = Date.now();
      const created = await insert('companion_commands', {
        target_player_id: playerId,
        kind: 'create_lobby',
        payload: PAYLOADS.create_lobby,
        expires_at: new Date(now + ttl).toISOString(),
      });
      const id = String(rows(created.body)[0]?.id ?? '');
      expect(Date.parse(String(rows(created.body)[0]?.expires_at)) - now).toBeLessThanOrEqual(ttl);

      const result = companionCommandResultSchemas.create_lobby.parse({
        partyId: 'party-abc',
        lobbyName: 'kustom night',
      });
      const acked = await rest('service', `companion_commands?id=eq.${id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          status: 'acked',
          acked_at: new Date().toISOString(),
          sent_at: new Date().toISOString(),
          attempts: 1,
          result,
        }),
      });
      expect(acked.ok).toBe(true);
      const row = rows(acked.body)[0];
      expect(row?.result).toEqual(result);
      expect(row?.attempts).toBe(1);
      expect(row?.sent_at).not.toBeNull();
    });

    it('stores a nack error verbatim, however long the detail is', async () => {
      const created = await insert('companion_commands', {
        target_player_id: playerId,
        kind: 'switch_side',
        payload: PAYLOADS.switch_side,
      });
      const id = String(rows(created.body)[0]?.id ?? '');
      const error = `client_rejected: ${'x'.repeat(480)}`;
      const nacked = await rest('service', `companion_commands?id=eq.${id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ status: 'failed', error, acked_at: new Date().toISOString() }),
      });
      expect(nacked.ok).toBe(true);
      expect(rows(nacked.body)[0]?.error).toBe(error);
    });
  });

  describe('row level security', () => {
    it('keeps the queue away from anon, columns included', async () => {
      const all = await rest('anon', 'companion_commands?select=*&limit=1');
      expect(all.ok).toBe(false);
      // `create_lobby.payload` carries the lobby password: asking for one column is no better.
      const one = await rest('anon', 'companion_commands?select=payload&limit=1');
      expect(one.ok).toBe(false);
      const written = await rest('anon', 'companion_commands', {
        method: 'POST',
        body: JSON.stringify({ target_player_id: playerId, kind: 'invite', payload: {} }),
      });
      expect(written.ok).toBe(false);
    });
  });
}
