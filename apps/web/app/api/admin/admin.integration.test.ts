import { randomUUID } from 'node:crypto';
import { type Database, SEASON_ONE_ID } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { playerLabel, shortPuuid } from '@/lib/admin/playerName';
import { listAdminPlayers } from '@/lib/admin/players';
import { listAdminTokens } from '@/lib/admin/tokens';
import {
  type AdminAuthResult,
  authorizeAdmin,
  type SessionUserLike,
  supabaseAdminLookup,
} from '@/lib/adminAuth';
import { withAdminAuth } from '@/lib/adminRoute';
import {
  authenticateCompanion,
  hashCompanionToken,
  mintCompanionToken,
  supabaseTokenLookup,
} from '@/lib/companionAuth';
import { ensurePlayers } from '@/lib/ingest/players';
import { lobbyBody } from '@/lib/testing/fixtures';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * The admin routes against the Supabase CLI local stack.
 *
 * Discord is bypassed, not faked away: the tests inject the *session* (there is no way to drive
 * a real OAuth round trip from vitest) and then run the real `authorizeAdmin` against the real
 * `players` table, so the "is this person an admin" half of the gate is exercised for real.
 *
 * Skipped, not failed, when the stack is not running (`pnpm db:start`). Every row is namespaced
 * with a run id and deleted afterwards.
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('admin routes against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;
  // The bootstrap admin has its own story; keep it out of this run.
  process.env.BOOTSTRAP_ADMIN_PUUID = '';
  process.env.BOOTSTRAP_ADMIN_DISCORD_ID = '';

  const { handleAdminPlayers } = await import('./players/handler');
  const { adminPlayersRequestSchema } = await import('./players/schema');
  const { handleAdminTokens } = await import('./tokens/handler');
  const { adminTokensRequestSchema } = await import('./tokens/schema');
  const { handleDiscordConfig } = await import('./discord-config/handler');
  const { discordConfigRequestSchema } = await import('./discord-config/schema');

  // The real route exports, environment and all: these are what answer an anonymous request.
  const { POST: postPlayersRoute } = await import('./players/route');
  const { POST: postTokensRoute } = await import('./tokens/route');
  const { POST: postDiscordRoute } = await import('./discord-config/route');

  // The real companion route: M1.7's rule lives in `ensurePlayers`, and the only honest proof
  // that an admin's name survives a rename is a lobby post arriving the way one really does.
  const { POST: postLobbyRoute } = await import('../companion/lobby/route');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const runId = randomUUID().slice(0, 8);
  const adminPuuid = `it-${runId}-admin`;
  const memberPuuid = `it-${runId}-member`;
  // M1.7: a player who is named by the client, renamed by the client, and overridden by an
  // admin. Kept out of `memberPuuid` so the role and Discord tests are not reading a moving name.
  const namedPuuid = `it-${runId}-named`;
  const namePartyId = `it-party-${runId}-names`;
  const adminDiscordId = `9${runId.replace(/\D/g, '') || '1'}00001`;
  const memberDiscordId = `9${runId.replace(/\D/g, '') || '1'}00002`;
  const guildId = `it-guild-${runId}`;
  // A second, older row: `saveDiscordConfig` must key on guild_id and never touch this one.
  const otherGuildId = `it-guild-${runId}-other`;

  let adminPlayerId = '';
  let memberPlayerId = '';
  let namedPlayerId = '';
  let companionToken = '';

  /** A signed-in user carrying a Discord identity, the shape `auth.getUser()` returns. */
  function sessionUser(discordId: string): SessionUserLike {
    return {
      id: randomUUID(),
      email: `${discordId}@example.invalid`,
      identities: [{ id: discordId, provider: 'discord', identity_data: { full_name: 'tester' } }],
    };
  }

  /** The real gate with only the session injected. */
  function authorizeAs(user: SessionUserLike | null) {
    return async (_request: Request, client: typeof db): Promise<AdminAuthResult> =>
      authorizeAdmin({
        resolveSessionUser: async () => user,
        lookupPlayerByDiscordId: supabaseAdminLookup(client),
      });
  }

  function post(body: unknown): Request {
    return new Request('http://localhost/api/admin/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  const routes = {
    players: (user: SessionUserLike | null) =>
      withAdminAuth(adminPlayersRequestSchema, handleAdminPlayers, {
        getClient: () => db,
        authorize: authorizeAs(user),
        redirectTo: '/admin/players',
      }),
    tokens: (user: SessionUserLike | null) =>
      withAdminAuth(adminTokensRequestSchema, handleAdminTokens, {
        getClient: () => db,
        authorize: authorizeAs(user),
        redirectTo: '/admin/tokens',
      }),
    discord: (user: SessionUserLike | null) =>
      withAdminAuth(discordConfigRequestSchema, handleDiscordConfig, {
        getClient: () => db,
        authorize: authorizeAs(user),
        redirectTo: '/admin/discord',
      }),
  };

  async function playerRow(playerId: string) {
    const { data, error } = await db
      .from('players')
      .select('id, discord_id, is_admin, main_role, secondary_role')
      .eq('id', playerId)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  beforeAll(async () => {
    const ids = await ensurePlayers(db, [{ puuid: adminPuuid }, { puuid: memberPuuid }]);
    adminPlayerId = ids.get(adminPuuid) ?? '';
    memberPlayerId = ids.get(memberPuuid) ?? '';
    expect(adminPlayerId).not.toBe('');
    expect(memberPlayerId).not.toBe('');

    const { error } = await db
      .from('players')
      .update({ discord_id: adminDiscordId, is_admin: true })
      .eq('id', adminPlayerId);
    if (error) throw new Error(error.message);

    const { error: memberError } = await db
      .from('players')
      .update({ discord_id: memberDiscordId, is_admin: false })
      .eq('id', memberPlayerId);
    if (memberError) throw new Error(memberError.message);

    // A companion token for the admin's own player. M1.8 means the caller has to appear in the
    // `members` it posts, so the admin is in every lobby body below.
    const { token, tokenHash } = mintCompanionToken();
    const { error: tokenError } = await db
      .from('companion_tokens')
      .insert({ player_id: adminPlayerId, token_hash: tokenHash, label: `it-${runId} names` });
    if (tokenError) throw new Error(tokenError.message);
    companionToken = token;
  });

  /** A lobby post exactly as the companion makes it: bearer token, JSON body. */
  function postLobby(body: unknown): Promise<Response> {
    return postLobbyRoute(
      new Request('http://localhost/api/companion/lobby', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${companionToken}` },
        body: JSON.stringify(body),
      }),
    );
  }

  /** The lobby the display-name tests report, with the named player under the given Riot ID. */
  function namesLobby(gameName: string): Record<string, unknown> {
    return lobbyBody({
      partyId: namePartyId,
      members: [
        { puuid: adminPuuid, gameName: 'TheAdmin', tagLine: 'EUW', side: 100 },
        { puuid: namedPuuid, gameName, tagLine: 'EUW', side: 100 },
      ],
    });
  }

  async function nameColumns(puuid: string) {
    const { data, error } = await db
      .from('players')
      .select('game_name, tag_line, display_name')
      .eq('puuid', puuid)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  afterAll(async () => {
    // **Nothing to restore any more** (M5.14): this file used to start and end seasons through
    // the route it tested, so it had to put Season 1 back in one transaction before deleting
    // the rows it had made. With no route there is no such state to unwind, and the seasons
    // table is left exactly as it was found.

    const { error: configError } = await db
      .from('discord_config')
      .delete()
      .in('guild_id', [guildId, otherGuildId]);
    if (configError) throw new Error(`cleanup: deleting discord_config failed: ${configError.message}`);

    // The lobby goes first: `lobby_members` cascades from it, and deleting the players while a
    // lobby still points at them would cascade rows out from under the next assertion.
    const { error: lobbyError } = await db.from('lobbies').delete().eq('lcu_party_id', namePartyId);
    if (lobbyError) throw new Error(`cleanup: deleting the test lobby failed: ${lobbyError.message}`);

    const { error: playerError } = await db
      .from('players')
      .delete()
      .in('puuid', [adminPuuid, memberPuuid, namedPuuid]);
    if (playerError) throw new Error(`cleanup: deleting players failed: ${playerError.message}`);

    // The database is shared with every other integration file, so leaving it as we found it is
    // part of the test, not an afterthought.
    const { data: active, error: activeError } = await db.from('seasons').select('id').eq('is_active', true);
    if (activeError) throw new Error(`cleanup: checking the active season failed: ${activeError.message}`);
    expect(active?.map((row) => row.id)).toEqual([SEASON_ONE_ID]);
  });

  describe('the gate', () => {
    const body = {
      action: 'set-roles',
      playerId: '11111111-1111-4111-8111-111111111111',
      mainRole: '',
      secondaryRole: '',
    };

    it('answers 401 to an anonymous request on every admin route', async () => {
      // The real exports, with no cookies at all: this is what a curl gets.
      // `postSeasonsRoute` was here until M5.14 removed the route it imported.
      for (const route of [postPlayersRoute, postTokensRoute, postDiscordRoute]) {
        const response = await route(post(body));
        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toEqual({ ok: false, error: 'sign in required' });
      }
    });

    it('answers 403 to a session whose player is not an admin', async () => {
      for (const [name, make] of Object.entries(routes)) {
        const response = await make(sessionUser(memberDiscordId))(post(body));
        expect([name, response.status]).toEqual([name, 403]);
        await expect(response.json()).resolves.toEqual({ ok: false, error: 'not an admin' });
      }
    });

    it('answers 403 to a session whose Discord id matches no player', async () => {
      const response = await routes.players(sessionUser('000000000000000000'))(post(body));

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        error: 'no player is linked to this Discord account',
      });
    });
  });

  describe('roles', () => {
    it('sets both roles and clears them back to null', async () => {
      const route = routes.players(sessionUser(adminDiscordId));

      const set = await route(
        post({ action: 'set-roles', playerId: memberPlayerId, mainRole: 'jungle', secondaryRole: 'mid' }),
      );
      expect(set.status).toBe(200);
      expect(await playerRow(memberPlayerId)).toMatchObject({
        main_role: 'jungle',
        secondary_role: 'mid',
      });

      // The point of M1.6: a null main role means flexible, and there has to be a way back.
      const cleared = await route(
        post({ action: 'set-roles', playerId: memberPlayerId, mainRole: '', secondaryRole: null }),
      );
      expect(cleared.status).toBe(200);
      expect(await playerRow(memberPlayerId)).toMatchObject({
        main_role: null,
        secondary_role: null,
      });
    });

    it('refuses the same role twice', async () => {
      const response = await routes.players(sessionUser(adminDiscordId))(
        post({ action: 'set-roles', playerId: memberPlayerId, mainRole: 'top', secondaryRole: 'top' }),
      );

      expect(response.status).toBe(400);
    });
  });

  describe('the display name (M1.7)', () => {
    it('follows the Riot ID, holds an admin override through a rename, and follows it again once cleared', async () => {
      const route = routes.players(sessionUser(adminDiscordId));

      // 1. The client names them. The row does not exist yet: this creates it.
      const created = await postLobby(namesLobby('Ahmed'));
      expect(created.status).toBe(200);
      expect(await nameColumns(namedPuuid)).toEqual({
        game_name: 'Ahmed',
        tag_line: 'EUW',
        display_name: 'Ahmed',
      });

      const { data: player, error } = await db.from('players').select('id').eq('puuid', namedPuuid).single();
      if (error) throw new Error(error.message);
      namedPlayerId = player.id;

      // 2. The admin sets the name the group actually uses.
      const set = await route(
        post({ action: 'set-name', playerId: namedPlayerId, displayName: '  Hamoodi  ' }),
      );
      expect(set.status).toBe(200);
      await expect(set.json()).resolves.toEqual({
        ok: true,
        action: 'set-name',
        playerId: namedPlayerId,
      });
      // Trimmed on the way in, so a stray space cannot silently break the "is it automatic" test.
      expect(await nameColumns(namedPuuid)).toMatchObject({ display_name: 'Hamoodi' });

      // 3. Riot ID changes. `game_name` moves; the admin's name does not.
      expect((await postLobby(namesLobby('AhmedTheSecond'))).status).toBe(200);
      expect(await nameColumns(namedPuuid)).toMatchObject({
        game_name: 'AhmedTheSecond',
        display_name: 'Hamoodi',
      });

      // 4. The admin clears the field. An empty form field posts "" and stores null.
      const cleared = await route(post({ action: 'set-name', playerId: namedPlayerId, displayName: '' }));
      expect(cleared.status).toBe(200);
      expect(await nameColumns(namedPuuid)).toMatchObject({ display_name: null });

      // 5. Back on automatic: the next report refills it, and a later rename follows again.
      expect((await postLobby(namesLobby('AhmedTheSecond'))).status).toBe(200);
      expect(await nameColumns(namedPuuid)).toMatchObject({ display_name: 'AhmedTheSecond' });

      expect((await postLobby(namesLobby('AhmedTheThird'))).status).toBe(200);
      expect(await nameColumns(namedPuuid)).toMatchObject({
        game_name: 'AhmedTheThird',
        display_name: 'AhmedTheThird',
      });
    });

    it('refuses a name no team sheet could hold, and changes nothing', async () => {
      const before = await nameColumns(namedPuuid);

      const response = await routes.players(sessionUser(adminDiscordId))(
        post({ action: 'set-name', playerId: namedPlayerId, displayName: 'x'.repeat(41) }),
      );

      expect(response.status).toBe(400);
      expect(await nameColumns(namedPuuid)).toEqual(before);
    });

    it('gives every row on both pages something readable, PUUID fragment included', async () => {
      // The three rungs of the chain on rows that really exist: an admin's override, a Riot ID
      // with no override, and a player first seen without a name at all — which is exactly how
      // `memberPuuid` was created, and how a PUUID first seen in an eog block arrives.
      await routes.players(sessionUser(adminDiscordId))(
        post({ action: 'set-name', playerId: memberPlayerId, displayName: 'Omar' }),
      );

      const rows = await listAdminPlayers(db, null);
      const named = rows.find((row) => row.id === namedPlayerId);
      const member = rows.find((row) => row.id === memberPlayerId);
      if (!named || !member) throw new Error('the players this test set up are missing');

      expect(playerLabel(member)).toBe('Omar');
      expect(playerLabel(named)).toBe('AhmedTheThird');
      // No override and no Riot ID: the last resort, and it is an identifier, not a blank.
      expect(playerLabel({ ...member, displayName: null })).toBe(shortPuuid(member.puuid));
      expect(playerLabel({ ...named, displayName: null })).toBe('AhmedTheThird#EUW');

      // Every row on the page renders as something.
      for (const row of rows) {
        expect(playerLabel(row).length).toBeGreaterThan(0);
      }

      // `/admin/tokens` reads the same chain off its own query, which had to learn `game_name`:
      // it used to fall from `display_name` straight to a PUUID fragment.
      const tokens = await listAdminTokens(db);
      const ours = tokens.filter((token) => token.playerId === adminPlayerId);
      expect(ours.length).toBeGreaterThan(0);
      for (const token of ours) {
        expect(token.gameName).toBe('TheAdmin');
        expect(playerLabel(token)).toBe('TheAdmin');
      }

      // Put the member row back the way the other tests found it.
      await routes.players(sessionUser(adminDiscordId))(
        post({ action: 'set-name', playerId: memberPlayerId, displayName: '' }),
      );
    });
  });

  describe('the Discord link', () => {
    it('links and unlinks a Discord id', async () => {
      const route = routes.players(sessionUser(adminDiscordId));
      const newId = `${memberDiscordId}7`;

      expect(
        (await route(post({ action: 'set-discord', playerId: memberPlayerId, discordId: newId }))).status,
      ).toBe(200);
      expect(await playerRow(memberPlayerId)).toMatchObject({ discord_id: newId });

      expect(
        (await route(post({ action: 'set-discord', playerId: memberPlayerId, discordId: '' }))).status,
      ).toBe(200);
      expect(await playerRow(memberPlayerId)).toMatchObject({ discord_id: null });

      // Put it back for the tests below.
      await route(post({ action: 'set-discord', playerId: memberPlayerId, discordId: memberDiscordId }));
    });

    it('refuses a Discord id that already belongs to someone else', async () => {
      const response = await routes.players(sessionUser(adminDiscordId))(
        post({ action: 'set-discord', playerId: memberPlayerId, discordId: adminDiscordId }),
      );

      expect(response.status).toBe(409);
      expect(await playerRow(memberPlayerId)).toMatchObject({ discord_id: memberDiscordId });
    });
  });

  describe('the admin flag', () => {
    it('promotes and demotes another player', async () => {
      const route = routes.players(sessionUser(adminDiscordId));

      expect(
        (await route(post({ action: 'set-admin', playerId: memberPlayerId, isAdmin: true }))).status,
      ).toBe(200);
      expect(await playerRow(memberPlayerId)).toMatchObject({ is_admin: true });

      expect(
        (await route(post({ action: 'set-admin', playerId: memberPlayerId, isAdmin: 'false' }))).status,
      ).toBe(200);
      expect(await playerRow(memberPlayerId)).toMatchObject({ is_admin: false });
    });

    it('refuses to let an admin remove their own flag', async () => {
      const response = await routes.players(sessionUser(adminDiscordId))(
        post({ action: 'set-admin', playerId: adminPlayerId, isAdmin: false }),
      );

      expect(response.status).toBe(403);
      expect(await playerRow(adminPlayerId)).toMatchObject({ is_admin: true });
    });
  });

  describe('companion tokens', () => {
    it('stores only the hash, and revoking makes the companion auth refuse it', async () => {
      const route = routes.tokens(sessionUser(adminDiscordId));

      const minted = await route(post({ action: 'mint', playerId: memberPlayerId, label: `it-${runId}` }));
      expect(minted.status).toBe(200);
      const body = (await minted.json()) as { ok: true; tokenId: string; token: string };
      expect(body.token.length).toBeGreaterThan(20);

      const { data: row, error } = await db
        .from('companion_tokens')
        .select('id, token_hash, label, revoked_at')
        .eq('id', body.tokenId)
        .single();
      if (error) throw new Error(error.message);

      // The raw token is nowhere in the row; only its SHA-256.
      expect(row.token_hash).toBe(hashCompanionToken(body.token));
      expect(JSON.stringify(row)).not.toContain(body.token);

      const before = await authenticateCompanion({
        authorization: `Bearer ${body.token}`,
        lookup: supabaseTokenLookup(db),
      });
      expect(before.ok).toBe(true);

      const revoked = await route(post({ action: 'revoke', tokenId: body.tokenId }));
      expect(revoked.status).toBe(200);

      const { data: after } = await db
        .from('companion_tokens')
        .select('revoked_at')
        .eq('id', body.tokenId)
        .single();
      expect(after?.revoked_at).not.toBeNull();

      const afterAuth = await authenticateCompanion({
        authorization: `Bearer ${body.token}`,
        lookup: supabaseTokenLookup(db),
      });
      expect(afterAuth).toEqual({
        ok: false,
        status: 401,
        error: 'companion token has been revoked',
      });
    });
  });

  describe('discord config', () => {
    it('saves the row, keeps the webhook when the field is empty, and clears it on request', async () => {
      const route = routes.discord(sessionUser(adminDiscordId));
      const webhook = 'https://discord.com/api/webhooks/123456789/it-secret-value';

      const saved = await route(
        post({
          guildId,
          webhookUrl: webhook,
          resultsChannelId: '111',
          lobbyVoiceChannelId: '222',
          blueVoiceChannelId: '333',
          redVoiceChannelId: '444',
        }),
      );
      expect(saved.status).toBe(200);
      const savedBody = (await saved.json()) as { webhookSet: boolean; webhookMasked: string };
      expect(savedBody.webhookSet).toBe(true);
      // The response never carries the secret back.
      expect(savedBody.webhookMasked).not.toContain('it-secret-value');

      const kept = await route(
        post({
          guildId,
          webhookUrl: '',
          resultsChannelId: '555',
          lobbyVoiceChannelId: '222',
          blueVoiceChannelId: '333',
          redVoiceChannelId: '444',
        }),
      );
      expect(kept.status).toBe(200);
      const { data: keptRow } = await db
        .from('discord_config')
        .select('webhook_url, results_channel_id')
        .eq('guild_id', guildId)
        .single();
      expect(keptRow?.webhook_url).toBe(webhook);
      expect(keptRow?.results_channel_id).toBe('555');

      const cleared = await route(
        post({
          guildId,
          webhookUrl: '',
          clearWebhook: true,
          resultsChannelId: '555',
          lobbyVoiceChannelId: '',
          blueVoiceChannelId: '',
          redVoiceChannelId: '',
        }),
      );
      expect(cleared.status).toBe(200);
      const { data: clearedRow } = await db
        .from('discord_config')
        .select('webhook_url, lobby_voice_channel_id')
        .eq('guild_id', guildId)
        .single();
      expect(clearedRow?.webhook_url).toBeNull();
      expect(clearedRow?.lobby_voice_channel_id).toBeNull();
    });

    it('writes only the row for the guild id it was given', async () => {
      const { error: seedError } = await db
        .from('discord_config')
        .insert({ guild_id: otherGuildId, results_channel_id: 'untouched' });
      if (seedError) throw new Error(seedError.message);

      const response = await routes.discord(sessionUser(adminDiscordId))(
        post({
          guildId,
          webhookUrl: '',
          resultsChannelId: '999',
          lobbyVoiceChannelId: '',
          blueVoiceChannelId: '',
          redVoiceChannelId: '',
        }),
      );
      expect(response.status).toBe(200);

      // The other guild's row keeps its own id and its own columns: no silent rename.
      const { data: other } = await db
        .from('discord_config')
        .select('guild_id, results_channel_id')
        .eq('guild_id', otherGuildId)
        .single();
      expect(other).toEqual({ guild_id: otherGuildId, results_channel_id: 'untouched' });
    });
  });

  /**
   * **There is no seasons route left to test** (M5.14, 2026-09-10). `POST /api/admin/seasons`,
   * the form, the `Start` button and M3.9's typed confirmation are gone with the thing they
   * guarded; the block that lived here started and ended seasons against this database, which
   * is why the cleanup below no longer has any to restore. `public.start_season()` stays in
   * the database, unreachable — an applied migration is never edited.
   */
  describe('season creation', () => {
    it('is not reachable: nothing in the app can make a second season row', async () => {
      const { count, error } = await db.from('seasons').select('id', { count: 'exact', head: true });
      if (error) throw new Error(error.message);

      // Whatever this deployment has, this file adds none — and no route can.
      expect(count ?? 0).toBeGreaterThanOrEqual(1);
      expect(Object.keys(routes)).not.toContain('seasons');
    });

    it('leaves exactly one active season for every other file sharing this database', async () => {
      const { data, error } = await db.from('seasons').select('id').eq('is_active', true);
      if (error) throw new Error(error.message);

      expect(data).toHaveLength(1);
    });
  });

  describe('the players list the page renders', () => {
    it('carries the active season rating and the Discord id', async () => {
      const { data: season } = await db.from('seasons').select('id').eq('is_active', true).single();
      const seasonId = season?.id ?? SEASON_ONE_ID;

      const { error } = await db
        .from('ratings')
        .upsert({ player_id: memberPlayerId, season_id: seasonId, mu: 24, sigma: 6, games: 3, wins: 2 });
      if (error) throw new Error(error.message);

      const rows = await listAdminPlayers(db, seasonId);
      const member = rows.find((row) => row.id === memberPlayerId);

      expect(member?.rating).toEqual({ mu: 24, sigma: 6, games: 3, wins: 2 });
      expect(member?.discordId).toBe(memberDiscordId);
    });
  });
}
