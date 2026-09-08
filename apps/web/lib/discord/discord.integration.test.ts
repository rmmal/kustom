import { randomUUID } from 'node:crypto';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mintCompanionToken } from '../companionAuth';
import { ensurePlayers } from '../ingest/players';
import { ROSTER_STABLE_MS } from '../lobbyState';
import { eogBody, testGameId } from '../testing/fixtures';
import { resolveLocalStack } from '../testing/localStack';

/**
 * M3.1 and M3.3 end to end: the companion posts a lobby through the real route, the state
 * machine balances, and one teams embed lands on a webhook that is a real HTTP server in this
 * process. Then the end-of-game block, and the result embed.
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
  const { POST: postGame } = await import('@/app/api/companion/game/route');
  const { resetWebhookWarning } = await import('./webhook');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const runId = randomUUID().slice(0, 8);
  const guildId = `it-${runId}-guild`;
  const puuids = Array.from({ length: 10 }, (_, index) => `it-${runId}-dc${String(index).padStart(2, '0')}`);
  /** Eleven of their own, so no other case's rotation or ratings can order this one. */
  const eleven = Array.from({ length: 11 }, (_, index) => `it-${runId}-el${String(index).padStart(2, '0')}`);
  const allPuuids = [...puuids, ...eleven];
  const partyIds = new Set<string>();
  const gameIds = new Set<number>();

  let token = '';
  /** A token owned by one of the eleven: a companion may only report a lobby it is in (M1.8). */
  let elevenToken = '';
  let webhookUrl = '';
  let server: Server | null = null;
  let posts: { body: Record<string, unknown> }[] = [];
  let answer: (response: ServerResponse) => void = (response) => response.writeHead(204).end();

  function party(name: string): string {
    const id = `dc-${runId}-${name}`;
    partyIds.add(id);
    return id;
  }

  function gameNumber(): number {
    const id = testGameId() + gameIds.size;
    gameIds.add(id);
    return id;
  }

  interface MemberSpec {
    puuid: string;
    isSpectator?: boolean;
  }

  function lobbyBody(partyId: string, members: readonly (string | MemberSpec)[]): Record<string, unknown> {
    return {
      partyId,
      lobbyName: 'customs-night',
      members: members.map((member, index) => {
        const spec = typeof member === 'string' ? { puuid: member } : member;
        return {
          puuid: spec.puuid,
          gameName: `Player${index}`,
          tagLine: 'EUW',
          summonerId: 3_000 + index,
          side: spec.isSpectator ? null : index < 5 ? 100 : 200,
          isSpectator: spec.isSpectator ?? false,
        };
      }),
    };
  }

  function request(json: unknown, bearer: string = token): Request {
    return new Request('http://localhost/api/companion/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
      body: JSON.stringify(json),
    });
  }

  /**
   * The stability clock is the lobby row's own `updated_at`, written by Postgres, so every
   * "ten seconds later" is measured from that column rather than from the test's wall clock.
   * Only `Date` is faked: the sockets to Supabase and to the webhook are real.
   */
  async function clockAt(lobbyId: string, offsetMs: number): Promise<number> {
    const { data, error } = await db.from('lobbies').select('updated_at').eq('id', lobbyId).single();
    if (error) throw new Error(error.message);
    return Date.parse(data.updated_at) + offsetMs;
  }

  async function lobbyIdOf(response: Response): Promise<string> {
    const body = (await response.clone().json()) as { lobbyId: string };
    return body.lobbyId;
  }

  /** The two posts a lobby needs: one to open it, one ten seconds later to balance it. */
  async function driveToBalanced(
    partyId: string,
    members: readonly (string | MemberSpec)[] = puuids,
    bearer: string = token,
  ): Promise<Response> {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const first = await postLobby(request(lobbyBody(partyId, members), bearer));
      expect(first.status).toBe(200);

      vi.setSystemTime(await clockAt(await lobbyIdOf(first), ROSTER_STABLE_MS + 1_000));
      return await postLobby(request(lobbyBody(partyId, members), bearer));
    } finally {
      vi.useRealTimers();
    }
  }

  /** The fields of the single embed of a post, by name. */
  function fieldsOf(index: number): Record<string, string> {
    const embed = ((posts[index]?.body.embeds ?? []) as Record<string, unknown>[])[0];
    const fields = (embed?.fields ?? []) as { name: string; value: string }[];
    return Object.fromEntries(fields.map((field) => [field.name, field.value]));
  }

  /** The ten lines of the two side fields, whose names carry a sum that is not the subject. */
  function teamLines(index: number): string[] {
    return Object.entries(fieldsOf(index))
      .filter(([name]) => name.startsWith('Blue · ') || name.startsWith('Red · '))
      .flatMap(([, value]) => value.split('\n'));
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
      allPuuids.map((puuid) => ({ puuid })),
    );
    async function mintFor(puuid: string): Promise<string> {
      const { data } = await db.from('players').select('id').eq('puuid', puuid).single();
      const { token: raw, tokenHash } = mintCompanionToken();
      const { error } = await db
        .from('companion_tokens')
        .insert({ player_id: data?.id ?? '', token_hash: tokenHash, label: `dc-${runId}` });
      if (error) throw new Error(error.message);
      return raw;
    }

    token = await mintFor(puuids[0] ?? '');
    elevenToken = await mintFor(eleven[5] ?? '');

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
      .from('games')
      .delete()
      .in('lcu_game_id', [...gameIds]);
    await db
      .from('lobbies')
      .delete()
      .in('lcu_party_id', [...partyIds]);
    await db.from('players').delete().in('puuid', allPuuids);
    await new Promise<void>((resolve) => {
      if (server === null) return resolve();
      server.closeAllConnections();
      server.close(() => resolve());
    });
  });

  describe('a night, from the tenth join to the result', () => {
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

    it('posts one result embed when the end-of-game block is rated, and none on a re-post', async () => {
      const id = party('night');
      const gameId = gameNumber();
      const body = eogBody({ gameId, puuids, partyId: id, winningSide: 200 });

      const first = await postGame(request(body));
      expect(first.status).toBe(200);
      expect(posts).toHaveLength(1);

      const posted = posts[0]?.body ?? {};
      const embed = (posted.embeds as Record<string, unknown>[])[0];
      expect(embed?.title).toBe('Red wins · 32:00');
      expect(normalise(posted)).toMatchSnapshot();

      // The second companion in the same game: stored, rated and posted by nobody.
      const second = await postGame(request(body));
      expect(second.status).toBe(200);
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

  describe('the cases that must not post', () => {
    it('posts nothing for nine around: no balance, no splits, and the companion still gets 200', async () => {
      const id = party('nine');
      vi.useFakeTimers({ toFake: ['Date'] });
      let lobbyId = '';
      try {
        const first = await postLobby(request(lobbyBody(id, puuids.slice(0, 9))));
        expect(first.status).toBe(200);
        lobbyId = await lobbyIdOf(first);

        vi.setSystemTime(await clockAt(lobbyId, ROSTER_STABLE_MS + 60_000));
        const later = await postLobby(request(lobbyBody(id, puuids.slice(0, 9))));
        expect(later.status).toBe(200);
        expect(await later.json()).toMatchObject({ status: 'open', memberCount: 9 });
      } finally {
        vi.useRealTimers();
      }

      expect(posts).toHaveLength(0);
      const { count } = await db
        .from('splits')
        .select('id', { count: 'exact', head: true })
        .eq('lobby_id', lobbyId);
      expect(count).toBe(0);
    });

    it('posts no result for a game the fold refused: 200 seconds, and nine on the scoreboard', async () => {
      const short = eogBody({ gameId: gameNumber(), puuids, partyId: null, durationS: 200 });
      const shortResponse = await postGame(request(short));
      expect(shortResponse.status).toBe(200);
      expect(await shortResponse.json()).toMatchObject({ created: true });
      expect(posts).toHaveLength(0);

      const nine = eogBody({ gameId: gameNumber(), puuids: puuids.slice(0, 9), partyId: null });
      const nineResponse = await postGame(request(nine));
      expect(nineResponse.status).toBe(200);
      expect(await nineResponse.json()).toMatchObject({ created: true, participants: 9 });
      expect(posts).toHaveLength(0);
    });
  });

  describe('the cases that post more than once', () => {
    it('posts a second embed when somebody leaves and the lobby rebalances', async () => {
      const id = party('rebalance');
      const balanced = await driveToBalanced(id);
      expect(await lobbyIdOf(balanced)).toBeTruthy();
      expect(posts).toHaveLength(1);

      const lobbyId = await lobbyIdOf(balanced);
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        // One leaves: the roster's identity changed, so the lobby is `open` and the clock restarts.
        const left = await postLobby(request(lobbyBody(id, puuids.slice(0, 9))));
        expect(await left.json()).toMatchObject({ status: 'open', memberCount: 9 });
        expect(posts).toHaveLength(1);

        // They come back, and ten seconds later there are teams again.
        const rejoined = await postLobby(request(lobbyBody(id, puuids)));
        expect(await rejoined.json()).toMatchObject({ status: 'open', memberCount: 10 });

        vi.setSystemTime(await clockAt(lobbyId, ROSTER_STABLE_MS + 1_000));
        const again = await postLobby(request(lobbyBody(id, puuids)));
        expect(await again.json()).toMatchObject({ status: 'balanced' });
      } finally {
        vi.useRealTimers();
      }

      // Two messages in the channel is the honest record: M3.1 edits and deletes nothing.
      expect(posts).toHaveLength(2);
      expect(fieldsOf(1)).toHaveProperty('Lobby');

      const { count } = await db
        .from('splits')
        .select('id', { count: 'exact', head: true })
        .eq('lobby_id', lobbyId);
      expect(count).toBe(6);
      const { count: chosen } = await db
        .from('splits')
        .select('id', { count: 'exact', head: true })
        .eq('lobby_id', lobbyId)
        .eq('is_chosen', true);
      expect(chosen).toBe(1);
    });
  });

  describe('eleven around', () => {
    it('names who sits and who swaps in, in M2.15 copy', async () => {
      const id = party('eleven');
      // Everyone has played the same number tonight (none), so the rotation falls through to
      // puuid order: `el00` sits. The spectator is somebody else, so they are one of the ten
      // and have to take the seat that just came free.
      const members = eleven.map((puuid, index) => ({ puuid, isSpectator: index === 10 }));
      const balanced = await driveToBalanced(id, members, elevenToken);

      expect(await balanced.json()).toMatchObject({ status: 'balanced', memberCount: 11 });
      expect(posts).toHaveLength(1);

      // The first balance of a night for these eleven: tied on games *and* nobody carrying a
      // sit-out, which is exactly the case M3.12 gave its own clause. `longest since they last
      // sat out` was true here and vacuous — the comparator had fallen through to puuid order.
      const fields = fieldsOf(0);
      expect(fields['Sitting out']).toBe(
        'Sitting out: Player0 — nobody has sat out before, so somebody had to be first.',
      );
      expect(fields.Seats).toBe('Swap: Player0 out, Player10 in.');

      // The ten in the two side fields are the other ten, and the sitter is in neither.
      const lines = teamLines(0);
      expect(lines).toHaveLength(10);
      expect(lines.some((line) => line.includes('Player0 ·'))).toBe(false);
      expect(lines.some((line) => line.includes('Player10 ·'))).toBe(true);
    });
  });
}
