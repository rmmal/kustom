import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  LOBBY_ALREADY_OPEN,
  LOBBY_ALREADY_OPENING,
  LOBBY_WRITES_UNVERIFIED,
  NO_COMPANION_AROUND,
} from '@/lib/admin/lobbyStart';
import {
  type AdminAuthResult,
  authorizeAdmin,
  type SessionUserLike,
  supabaseAdminLookup,
} from '@/lib/adminAuth';
import {
  clearCommandHooks,
  enqueueCommands,
  fanOutInvites,
  inviteFanOutHook,
  registerCommandHook,
} from '@/lib/commands';
import { mintCompanionToken } from '@/lib/companionAuth';
import { ensurePlayers } from '@/lib/ingest/players';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * Start a lobby, against the Supabase CLI local stack (M4.2): the real admin route, the real
 * queue, the real ack route, and the invite fan-out driven by an ack that came back through it.
 *
 * **The clock is 2019 on purpose.** Every read the press makes is bounded by `now` at both ends
 * — the night's 06:00 and `now` itself — so a run at a fixed instant six years ago sees exactly
 * the rows this file seeded and none of the shared stack's leftovers, however many other agents
 * are using it. Nothing here sleeps and nothing here can see another run's lobby.
 *
 * Skipped, not failed, without the local stack (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('start a lobby against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;
  process.env.BOOTSTRAP_ADMIN_PUUID = '';
  process.env.BOOTSTRAP_ADMIN_DISCORD_ID = '';

  const { startLobbyRoute } = await import('./start/handler');
  // The real export, environment and all: this is what answers an anonymous request.
  const { POST: startRouteExport } = await import('./start/route');
  const { POST: ackCommandRoute } = await import('../../companion/commands/[id]/ack/route');
  const { POST: nackCommandRoute } = await import('../../companion/commands/[id]/nack/route');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  /** 22:00 Cairo, a Sunday in 2019. The night started at 04:00Z. */
  const NOW = new Date('2019-06-09T20:00:00.000Z');
  const minutesBefore = (minutes: number): string => new Date(NOW.getTime() - minutes * 60_000).toISOString();
  const nightsBefore = (nights: number): string =>
    new Date(NOW.getTime() - nights * 24 * 60 * 60 * 1000).toISOString();

  /** Season 1, seeded by `0001_init.sql` with a fixed id: never the *active* season of a run. */
  const SEASON_ONE = '00000000-0000-0000-0000-000000000001';
  /** Both kinds green. Production has them off, and one test below proves what that costs. */
  const ON = { create_lobby: true, invite: true, switch_side: false } as const;

  const runId = randomUUID().slice(0, 8);
  const puuidOf = (name: string): string => `sl-${runId}-${name}`;
  const adminDiscordId = `9${runId.replace(/\D/g, '') || '1'}00001`;
  const memberDiscordId = `9${runId.replace(/\D/g, '') || '1'}00002`;

  const NAMES = ['admin', 'host', 'fresh', 'stale', 'recent', 'old', 'inlobby'] as const;
  type Name = (typeof NAMES)[number];
  const ids = new Map<Name, string>();
  const id = (name: Name): string => {
    const value = ids.get(name);
    if (value === undefined) throw new Error(`no player for ${name}`);
    return value;
  };

  const partyId = `sl-${runId}`;
  const gameIds = [9_100_000_000_000 + Math.floor(Math.random() * 1_000_000), 0];
  gameIds[1] = (gameIds[0] ?? 0) + 1;

  let hostToken = '';
  let lobbyId = '';
  let commandId = '';

  function sessionUser(discordId: string): SessionUserLike {
    return {
      id: randomUUID(),
      email: `${discordId}@example.invalid`,
      identities: [{ id: discordId, provider: 'discord', identity_data: { full_name: 'tester' } }],
    };
  }

  /** The real gate with only the session injected: `players.is_admin` is still read for real. */
  function authorizeAs(user: SessionUserLike | null) {
    return async (_request: Request, client: typeof db): Promise<AdminAuthResult> =>
      authorizeAdmin({
        resolveSessionUser: async () => user,
        lookupPlayerByDiscordId: supabaseAdminLookup(client),
      });
  }

  function press(options: { user?: SessionUserLike | null; gate?: typeof ON | undefined } = {}) {
    return startLobbyRoute({
      getClient: () => db,
      authorize: authorizeAs(options.user === undefined ? sessionUser(adminDiscordId) : options.user),
      // `exactOptionalPropertyTypes`: the gate is present or absent, never `undefined`.
      start: { now: NOW, password: () => '4821', ...(options.gate ? { gate: options.gate } : {}) },
    });
  }

  function postStart(body: unknown = {}): Request {
    return new Request('http://localhost/api/admin/lobbies/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  function companionPost(path: string, body: unknown): Request {
    return new Request(`http://localhost/api/companion/commands/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${hostToken}` },
      body: JSON.stringify(body),
    });
  }

  async function commandsOf(kind: 'create_lobby' | 'invite') {
    const { data, error } = await db
      .from('companion_commands')
      .select('id, kind, status, payload, target_player_id, expires_at, created_at')
      .in('target_player_id', [...ids.values()])
      .eq('kind', kind)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async function seedGame(index: number, playerId: string, startedAt: string): Promise<void> {
    const lcuGameId = gameIds[index] ?? 0;
    const { data, error } = await db
      .from('games')
      .insert({
        lcu_game_id: lcuGameId,
        // Explicit, never the active season: another file's run may have made its own active.
        season_id: SEASON_ONE,
        started_at: startedAt,
        duration_s: 1_800,
        winning_side: 100,
        raw: {},
      })
      .select('id')
      .single();
    if (error) throw new Error(`seedGame: ${error.message}`);

    const { error: playerError } = await db
      .from('game_players')
      .insert({ game_id: data.id, player_id: playerId, side: 100, role: 'mid' });
    if (playerError) throw new Error(`seedGame: ${playerError.message}`);
  }

  beforeAll(async () => {
    const created = await ensurePlayers(
      db,
      NAMES.map((name) => ({ puuid: puuidOf(name) })),
    );
    for (const name of NAMES) {
      const playerId = created.get(puuidOf(name));
      if (playerId === undefined) throw new Error(`ensurePlayers missed ${name}`);
      ids.set(name, playerId);
    }

    const admin = await db
      .from('players')
      .update({ discord_id: adminDiscordId, is_admin: true })
      .eq('id', id('admin'));
    if (admin.error) throw new Error(admin.error.message);

    // Somebody signed in who is not an admin. The route must refuse them too.
    const member = await db
      .from('players')
      .update({ discord_id: memberDiscordId, is_admin: false })
      .eq('id', id('fresh'));
    if (member.error) throw new Error(member.error.message);

    // A summoner id on one invitee only: the payload carries it when we have it and null when
    // we do not, and the companion picks the body the verification pass found.
    const summoner = await db.from('players').update({ summoner_id: '4242' }).eq('id', id('fresh'));
    if (summoner.error) throw new Error(summoner.error.message);

    async function mint(name: Name, lastSeenAt: string): Promise<string> {
      const { token, tokenHash } = mintCompanionToken();
      const { error } = await db.from('companion_tokens').insert({
        player_id: id(name),
        token_hash: tokenHash,
        label: `start ${runId} ${name}`,
        last_seen_at: lastSeenAt,
      });
      if (error) throw new Error(`mint: ${error.message}`);
      return token;
    }

    // The host: a client that was up a minute ago. `fresh` is inside the hour but outside the
    // ten-minute host window; `stale` is outside both.
    hostToken = await mint('host', minutesBefore(1));
    await mint('fresh', minutesBefore(59));
    await mint('stale', minutesBefore(61));
    // Around by every clause, and never invited anyway: they are in the lobby already.
    await mint('inlobby', minutesBefore(5));

    // Clause (b): a custom six nights ago is around, one eight nights ago is not.
    await seedGame(0, id('recent'), nightsBefore(6));
    await seedGame(1, id('old'), nightsBefore(8));
  });

  afterAll(async () => {
    clearCommandHooks();
    await db.from('lobbies').delete().eq('lcu_party_id', partyId);
    await db.from('games').delete().in('lcu_game_id', gameIds);
    // `companion_commands`, `companion_tokens` and `game_players` all cascade from here.
    await db
      .from('players')
      .delete()
      .in(
        'puuid',
        NAMES.map((name) => puuidOf(name)),
      );
  });

  describe('who may press', () => {
    it('refuses an anonymous caller with 401 and writes nothing', async () => {
      const response = await startRouteExport(postStart());

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ ok: false, error: 'sign in required' });
      expect(await commandsOf('create_lobby')).toHaveLength(0);
    });

    it('refuses a signed-in visitor who is not an admin', async () => {
      const response = await press({ user: sessionUser(memberDiscordId), gate: ON })(postStart());

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ ok: false, error: 'not an admin' });
      expect(await commandsOf('create_lobby')).toHaveLength(0);
    });
  });

  describe('the refusals', () => {
    it('says the writes are not verified while the gate is off, and reads nothing', async () => {
      // No `gate` override: this is the production table in `lib/commands/gate.ts`, all off.
      const response = await press()(postStart());

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({ ok: false, error: LOBBY_WRITES_UNVERIFIED });
      expect(await commandsOf('create_lobby')).toHaveLength(0);
      expect(await commandsOf('invite')).toHaveLength(0);
    });

    it('refuses when no companion has been up for ten minutes, and writes nothing anywhere', async () => {
      const { error } = await db
        .from('companion_tokens')
        .update({ last_seen_at: minutesBefore(11) })
        .in('player_id', [id('host'), id('inlobby')]);
      if (error) throw new Error(error.message);

      try {
        const response = await press({ gate: ON })(postStart());

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({ ok: false, error: NO_COMPANION_AROUND });
        expect(await commandsOf('create_lobby')).toHaveLength(0);
      } finally {
        await db
          .from('companion_tokens')
          .update({ last_seen_at: minutesBefore(1) })
          .eq('player_id', id('host'));
        await db
          .from('companion_tokens')
          .update({ last_seen_at: minutesBefore(5) })
          .eq('player_id', id('inlobby'));
      }
    });
  });

  describe('the press', () => {
    it('queues exactly one create_lobby on the host, with a generated name and password', async () => {
      const response = await press({ gate: ON })(postStart());

      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        ok: true,
        host: { playerId: id('host'), puuid: puuidOf('host') },
        lobbyName: 'Customs 09 Jun #1',
        lobbyPassword: '4821',
        cycle: 1,
        expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
      });
      expect(body.lobbyName).toMatch(/^Customs \d\d [A-Z][a-z]{2} #\d+$/);
      expect(body.lobbyPassword).toMatch(/^\d{4}$/);

      const rows = await commandsOf('create_lobby');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        target_player_id: id('host'),
        status: 'pending',
        payload: { lobbyName: 'Customs 09 Jun #1', lobbyPassword: '4821' },
        // The kind's own TTL: a minute is how long somebody stares at a button.
        expires_at: new Date(NOW.getTime() + 60_000).toISOString().replace('.000Z', '+00:00'),
      });

      commandId = rows[0]?.id ?? '';
      expect(commandId).toBeTruthy();
    });

    it('is a no-op on the second tap: one sentence, and no second row', async () => {
      const response = await press({ gate: ON })(postStart());

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({ ok: false, error: LOBBY_ALREADY_OPENING });
      expect(await commandsOf('create_lobby')).toHaveLength(1);
    });

    it('sends a browser form back to the page it was pressed on, with the sentence', async () => {
      const form = new Request('http://localhost/api/admin/lobbies/start', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ redirectTo: '/' }).toString(),
      });

      const response = await press({ gate: ON })(form);

      expect(response.status).toBe(303);
      const location = new URL(response.headers.get('location') ?? '');
      expect(location.pathname).toBe('/');
      expect(location.searchParams.get('error')).toBe(LOBBY_ALREADY_OPENING);
      expect(await commandsOf('create_lobby')).toHaveLength(1);
    });

    it('refuses while a lobby of tonight is live, before it looks at the pending row', async () => {
      // The lobby the host's client just opened, posted back by their companion.
      const { data, error } = await db
        .from('lobbies')
        .insert({
          lcu_party_id: partyId,
          status: 'open',
          lobby_name: 'Customs 09 Jun #1',
          created_at: minutesBefore(1),
          updated_at: minutesBefore(1),
        })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      lobbyId = data.id;

      const members = await db.from('lobby_members').insert([
        { lobby_id: lobbyId, player_id: id('host'), side: 100 },
        { lobby_id: lobbyId, player_id: id('inlobby'), side: 100 },
      ]);
      if (members.error) throw new Error(members.error.message);

      const response = await press({ gate: ON })(postStart());

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({ ok: false, error: LOBBY_ALREADY_OPEN });
      expect(await commandsOf('create_lobby')).toHaveLength(1);
    });
  });

  describe('the fan-out, off the ack', () => {
    it('queues one invite per person around, on the host, most recently active first', async () => {
      // The production hook with the clock, the gate and the client injected: the same object
      // `register.ts` builds, and the same path the ack route drives it through.
      clearCommandHooks();
      registerCommandHook(inviteFanOutHook({ now: NOW, gate: ON, getClient: () => db }));

      const response = await ackCommandRoute(
        companionPost(`${commandId}/ack`, { result: { partyId, lobbyName: 'Customs 09 Jun #1' } }),
        { params: Promise.resolve({ id: commandId }) },
      );
      expect(response.status).toBe(200);

      const invites = await commandsOf('invite');
      // Exactly the around set: `fresh` by their token, `recent` by a custom six nights ago.
      // Never the host, never `inlobby` who is already in it, never `stale` (a token last seen
      // 61 minutes ago), never `old` (whose last custom was eight nights back), never `admin`
      // who pressed the button from a phone with no companion anywhere.
      expect(invites).toHaveLength(2);
      expect(invites.map((row) => row.target_player_id)).toEqual([id('host'), id('host')]);
      expect(new Set(invites.map((row) => (row.payload as { puuid: string }).puuid))).toEqual(
        new Set([puuidOf('fresh'), puuidOf('recent')]),
      );
      // The invitee's summoner id when we have one, null when we do not, so M4.1's executor can
      // use whichever body the verification pass found.
      const summonerIds = new Map(
        invites.map((row) => {
          const payload = row.payload as { puuid: string; summonerId: string | null };
          return [payload.puuid, payload.summonerId];
        }),
      );
      expect(summonerIds.get(puuidOf('fresh'))).toBe('4242');
      expect(summonerIds.get(puuidOf('recent'))).toBeNull();
    });

    it('writes them most recently active first', async () => {
      // The rows of one insert share `created_at` to the microsecond, so the order lives in the
      // write and not in a column: this asserts the writer's own answer.
      const { error } = await db
        .from('companion_commands')
        .delete()
        .eq('target_player_id', id('host'))
        .eq('kind', 'invite');
      if (error) throw new Error(error.message);

      const result = await fanOutInvites(db, { hostPlayerId: id('host') }, { now: NOW, gate: ON });

      expect(result.invited).toEqual([id('fresh'), id('recent')]);
      expect(await commandsOf('invite')).toHaveLength(2);
    });

    it('writes no second invite when the same ack arrives twice', async () => {
      const response = await ackCommandRoute(
        companionPost(`${commandId}/ack`, { result: { partyId, lobbyName: 'Customs 09 Jun #1' } }),
        { params: Promise.resolve({ id: commandId }) },
      );

      // The row is already settled: the second ack changes nothing and no hook runs.
      expect(response.status).toBe(409);
      expect(await commandsOf('invite')).toHaveLength(2);
    });

    it('skips anybody already holding a live invite when it runs again', async () => {
      const result = await fanOutInvites(db, { hostPlayerId: id('host') }, { now: NOW, gate: ON });

      expect(result).toMatchObject({ invited: [], alreadyQueued: 2, gated: false });
      expect(await commandsOf('invite')).toHaveLength(2);
    });

    it('queues nothing at all while the invite kind is gated off', async () => {
      // The production gate, on a host with nobody yet invited: no read, no write, no rows.
      const result = await fanOutInvites(db, { hostPlayerId: id('fresh') }, { now: NOW });

      expect(result).toMatchObject({ invited: [], gated: true });
      expect(await commandsOf('invite')).toHaveLength(2);
    });

    it('queues zero invites for a create_lobby that was nacked', async () => {
      const { queued } = await enqueueCommands(
        db,
        [
          {
            targetPlayerId: id('host'),
            kind: 'create_lobby',
            payload: { lobbyName: 'Customs 09 Jun #2', lobbyPassword: '1234' },
          },
        ],
        { now: NOW, gate: ON },
      );
      const second = queued[0] ?? '';

      const response = await nackCommandRoute(
        companionPost(`${second}/nack`, {
          error: 'already_in_lobby: partyId=abc',
          retryable: false,
        }),
        { params: Promise.resolve({ id: second }) },
      );

      expect(response.status).toBe(200);
      // No lobby, no invites, no half state: the failed create queues nothing.
      expect(await commandsOf('invite')).toHaveLength(2);
    });
  });
}
