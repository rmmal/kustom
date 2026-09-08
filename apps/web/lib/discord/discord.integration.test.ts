import { randomUUID } from 'node:crypto';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mintCompanionToken } from '../companionAuth';
import { ensurePlayers } from '../ingest/players';
import { ROSTER_STABLE_MS } from '../lobbyState';
import { resolveLocalStack } from '../testing/localStack';

/**
 * M3.1 end to end: the companion posts a lobby through the real route, the state machine
 * balances, and one teams embed lands on a webhook that is a real HTTP server in this process.
 *
 * What it is here to prove, beyond "a message arrives":
 *
 * - **exactly one** post per transition, whatever the companion does;
 * - a webhook that answers 500 changes neither the lobby response nor the stored state;
 * - no `discord_config` row means no post and no error.
 *
 * Skipped, not failed, without the local stack (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('the Discord webhook against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.BOOTSTRAP_ADMIN_PUUID = '';
  process.env.CUSTOMS_NIGHT_TZ = 'Africa/Cairo';

  // Importing the routes is what registers the Discord hooks (`lib/ingest/discord.ts`).
  const { POST: postLobby } = await import('@/app/api/companion/lobby/route');
  const { resetWebhookWarning } = await import('./webhook');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const runId = randomUUID().slice(0, 8);
  const guildId = `it-${runId}-guild`;
  const puuids = Array.from({ length: 10 }, (_, index) => `it-${runId}-dc${String(index).padStart(2, '0')}`);
  const partyIds = new Set<string>();

  let token = '';
  let webhookUrl = '';
  let server: Server | null = null;
  let posts: { body: Record<string, unknown> }[] = [];
  let answer: (response: ServerResponse) => void = (response) => response.writeHead(204).end();

  function party(name: string): string {
    const id = `dc-${runId}-${name}`;
    partyIds.add(id);
    return id;
  }

  function lobbyBody(partyId: string, members: readonly string[]): Record<string, unknown> {
    return {
      partyId,
      lobbyName: 'customs-night',
      members: members.map((puuid, index) => ({
        puuid,
        gameName: `Player${index}`,
        tagLine: 'EUW',
        summonerId: 3_000 + index,
        side: index < 5 ? 100 : 200,
        isSpectator: false,
      })),
    };
  }

  function request(json: unknown): Request {
    return new Request('http://localhost/api/companion/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(json),
    });
  }

  /** The two posts a lobby needs: one to open it, one ten seconds later to balance it. */
  async function driveToBalanced(partyId: string): Promise<Response> {
    const start = Date.now();
    vi.useFakeTimers({ toFake: ['Date'], now: start });
    try {
      const first = await postLobby(request(lobbyBody(partyId, puuids)));
      expect(first.status).toBe(200);

      vi.setSystemTime(start + ROSTER_STABLE_MS + 1_000);
      return await postLobby(request(lobbyBody(partyId, puuids)));
    } finally {
      vi.useRealTimers();
    }
  }

  /** Field-for-field stable: the timestamp and the season's game count are not. */
  function normalise(body: Record<string, unknown>): unknown {
    const embeds = (body.embeds as Record<string, unknown>[]).map((embed) => ({
      ...embed,
      timestamp: '<timestamp>',
      footer: { text: String((embed.footer as { text: string }).text).replace(/game \d+/, 'game <n>') },
    }));
    return { ...body, embeds };
  }

  beforeAll(async () => {
    await ensurePlayers(
      db,
      puuids.map((puuid) => ({ puuid })),
    );
    const { data } = await db
      .from('players')
      .select('id')
      .eq('puuid', puuids[0] ?? '')
      .single();
    const { token: raw, tokenHash } = mintCompanionToken();
    const { error } = await db
      .from('companion_tokens')
      .insert({ player_id: data?.id ?? '', token_hash: tokenHash, label: `dc-${runId}` });
    if (error) throw new Error(error.message);
    token = raw;

    server = createServer((incoming, response) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.on('end', () => {
        posts.push({ body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> });
        answer(response);
      });
    });
    const listening = server;
    await new Promise<void>((resolve) => listening.listen(0, '127.0.0.1', resolve));
    webhookUrl = `http://127.0.0.1:${(listening.address() as AddressInfo).port}/webhook`;

    // Leftovers from an interrupted run would win the "oldest row with a webhook" rule.
    await db.from('discord_config').delete().like('guild_id', 'it-%');
    const { count } = await db
      .from('discord_config')
      .select('guild_id', { count: 'exact', head: true })
      .not('webhook_url', 'is', null);
    if ((count ?? 0) > 0) {
      throw new Error(
        'a discord_config row with a webhook already exists; this test would not be the one used',
      );
    }

    const { error: configError } = await db
      .from('discord_config')
      .insert({ guild_id: guildId, webhook_url: webhookUrl });
    if (configError) throw new Error(configError.message);
  });

  afterEach(() => {
    posts = [];
    answer = (response) => response.writeHead(204).end();
    resetWebhookWarning();
  });

  afterAll(async () => {
    await db.from('discord_config').delete().eq('guild_id', guildId);
    await db
      .from('lobbies')
      .delete()
      .in('lcu_party_id', [...partyIds]);
    await db.from('players').delete().in('puuid', puuids);
    await new Promise<void>((resolve) => {
      if (server === null) return resolve();
      server.closeAllConnections();
      server.close(() => resolve());
    });
  });

  describe('a night, from the tenth join', () => {
    it('posts one teams embed on balanced, and nothing more when the companion posts again', async () => {
      const id = party('night');
      const balanced = await driveToBalanced(id);

      expect(balanced.status).toBe(200);
      expect(await balanced.json()).toMatchObject({ ok: true, status: 'balanced' });
      expect(posts).toHaveLength(1);
      expect(normalise(posts[0]?.body ?? {})).toMatchSnapshot();

      // The companion keeps posting the same lobby; the transition has already happened.
      const again = await postLobby(request(lobbyBody(id, puuids)));
      expect(again.status).toBe(200);
      expect(posts).toHaveLength(1);
    });
  });

  describe('when Discord is not there', () => {
    it('answers 200 and stores the splits when the webhook 500s', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      answer = (response) => response.writeHead(500).end('nope');

      const id = party('five-hundred');
      const balanced = await driveToBalanced(id);
      const payload = (await balanced.json()) as { lobbyId: string; status: string };

      expect(balanced.status).toBe(200);
      expect(payload.status).toBe('balanced');
      // Tried twice, then given up on.
      expect(posts).toHaveLength(2);

      const { data: lobby } = await db.from('lobbies').select('status').eq('id', payload.lobbyId).single();
      expect(lobby?.status).toBe('balanced');
      const { count } = await db
        .from('splits')
        .select('id', { count: 'exact', head: true })
        .eq('lobby_id', payload.lobbyId);
      expect(count).toBe(3);
      vi.restoreAllMocks();
    });

    it('posts nothing at all when no webhook is configured', async () => {
      const { error } = await db.from('discord_config').update({ webhook_url: null }).eq('guild_id', guildId);
      if (error) throw new Error(error.message);

      try {
        const id = party('no-config');
        const balanced = await driveToBalanced(id);
        const payload = (await balanced.json()) as { lobbyId: string; status: string };

        expect(payload.status).toBe('balanced');
        expect(posts).toHaveLength(0);
        const { count } = await db
          .from('splits')
          .select('id', { count: 'exact', head: true })
          .eq('lobby_id', payload.lobbyId);
        expect(count).toBe(3);
      } finally {
        await db.from('discord_config').update({ webhook_url: webhookUrl }).eq('guild_id', guildId);
      }
    });
  });
}
