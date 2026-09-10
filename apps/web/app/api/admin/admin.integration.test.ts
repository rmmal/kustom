import { randomUUID } from 'node:crypto';
import { type Database, SEASON_ONE_ID } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { playerLabel, shortPuuid } from '@/lib/admin/playerName';
import { ADMIN_PLAYERS_PAGE_SIZE, listAdminPlayers } from '@/lib/admin/players';
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

  const { handleAdminPlayers, ROLES_ARE_INFERRED } = await import('./players/handler');
  const { adminPlayersRequestSchema } = await import('./players/schema');
  const { handleAdminTokens } = await import('./tokens/handler');
  const { adminTokensRequestSchema } = await import('./tokens/schema');
  const { handleDiscordConfig } = await import('./discord-config/handler');
  const { discordConfigRequestSchema } = await import('./discord-config/schema');
  const { handleStartSeason } = await import('./seasons/handler');
  const { startSeasonRequestSchema } = await import('./seasons/schema');

  // The real route exports, environment and all: these are what answer an anonymous request.
  const { POST: postPlayersRoute } = await import('./players/route');
  const { POST: postTokensRoute } = await import('./tokens/route');
  const { POST: postDiscordRoute } = await import('./discord-config/route');
  const { POST: postSeasonsRoute } = await import('./seasons/route');

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
  const createdSeasonIds: string[] = [];

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
    seasons: (user: SessionUserLike | null) =>
      withAdminAuth(startSeasonRequestSchema, handleStartSeason, {
        getClient: () => db,
        authorize: authorizeAs(user),
        redirectTo: '/admin/seasons',
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
    // Season 1 goes back first, and in ONE transaction (`set_active_season`, 0002). Doing it as
    // "deactivate the ones this run made, then activate Season 1" leaves a window with no active
    // season at all, and anything inserting a game in that window fails on a null season_id.
    // Only then are the run's seasons deleted, by which time they are already inactive.
    const { error: restoreError } = await db.rpc('set_active_season', { p_id: SEASON_ONE_ID });
    if (restoreError) throw new Error(`cleanup: restoring Season 1 failed: ${restoreError.message}`);

    // Deleted by name, not by the ids the tests collected: `start_season` is committed by the
    // time the route builds its response, so a run that fails *after* the insert (a response
    // schema that rejects the row, an assertion that throws) never records the id and used to
    // leave the season behind for the next run to inherit. Every season this file creates is
    // named `it-<runId> ...`, so the pattern catches those too.
    const { error } = await db.from('seasons').delete().like('name', `it-${runId} %`);
    // Throwing here is the point: a swallowed error leaves "it-... season A" rows behind.
    if (error) throw new Error(`cleanup: deleting test seasons failed: ${error.message}`);

    const { data: strays, error: strayError } = await db
      .from('seasons')
      .select('id')
      .in('id', createdSeasonIds.length > 0 ? createdSeasonIds : [SEASON_ONE_ID])
      .neq('id', SEASON_ONE_ID);
    if (strayError) throw new Error(`cleanup: checking test seasons failed: ${strayError.message}`);
    expect(strays ?? []).toEqual([]);

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
      for (const route of [postPlayersRoute, postTokensRoute, postDiscordRoute, postSeasonsRoute]) {
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

  describe('roles are inferred, not set (M5.17)', () => {
    it('answers 410 with a sentence and writes nothing', async () => {
      // Somebody's roles, as a recompute would have left them. The route must not touch them.
      await db
        .from('players')
        .update({ main_role: 'jungle', secondary_role: 'mid', roles_counted: 12 })
        .eq('id', memberPlayerId);

      const response = await routes.players(sessionUser(adminDiscordId))(
        post({ action: 'set-roles', playerId: memberPlayerId, mainRole: 'top', secondaryRole: null }),
      );

      expect(response.status).toBe(410);
      await expect(response.json()).resolves.toEqual({ ok: false, error: ROLES_ARE_INFERRED });
      expect(await playerRow(memberPlayerId)).toMatchObject({
        main_role: 'jungle',
        secondary_role: 'mid',
      });
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

      // Searched by this run's puuid prefix, not read off page one: the stack is shared and
      // the page is fifty rows deep (M3.25).
      const { rows } = await listAdminPlayers(db, null, { search: `it-${runId}` });
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

  describe('seasons', () => {
    /** The name an admin would have to type right now. */
    async function activeSeason(): Promise<{ id: string; name: string }> {
      const { data, error } = await db.from('seasons').select('id, name').eq('is_active', true).single();
      if (error) throw new Error(error.message);
      return data;
    }

    async function seasonCount(): Promise<number> {
      const { count, error } = await db.from('seasons').select('id', { count: 'exact', head: true });
      if (error) throw new Error(error.message);
      return count ?? 0;
    }

    /**
     * M3.9. The one control in the app with no undo, so "nothing changed" is asserted on the
     * rows — the active season and the number of seasons — not on the status code alone.
     */
    it('refuses to start a season without the confirmation, and changes nothing', async () => {
      const before = await activeSeason();
      const countBefore = await seasonCount();

      const response = await routes.seasons(sessionUser(adminDiscordId))(
        post({ name: `it-${runId} season never` }),
      );

      expect(response.status).toBe(400);
      const body = (await response.json()) as { ok: false; error: string };
      expect(body.ok).toBe(false);
      // The refusal says what to type, because an admin who guesses twice will paste anything.
      expect(body.error).toContain(before.name);

      expect(await activeSeason()).toEqual(before);
      expect(await seasonCount()).toBe(countBefore);
    });

    it('refuses the wrong confirmation, including the name of the season being started', async () => {
      const before = await activeSeason();
      const countBefore = await seasonCount();
      const route = routes.seasons(sessionUser(adminDiscordId));

      for (const confirmSeasonName of [
        `it-${runId} season never`, // the new name, not the one being ended
        before.name.toLowerCase(), // close, but the check is exact
        `${before.name} `.repeat(2).trim(), // typed twice
        '',
        null,
      ]) {
        const response = await route(post({ name: `it-${runId} season never`, confirmSeasonName }));
        expect([confirmSeasonName, response.status]).toEqual([confirmSeasonName, 400]);
      }

      expect(await activeSeason()).toEqual(before);
      expect(await seasonCount()).toBe(countBefore);
    });

    it('redirects a form post back to the page with the error rather than starting anything', async () => {
      const before = await activeSeason();
      const countBefore = await seasonCount();

      const form = new Request('http://localhost/api/admin/seasons', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ name: `it-${runId} season never`, confirmSeasonName: 'nope' }),
      });
      const response = await routes.seasons(sessionUser(adminDiscordId))(form);

      expect(response.status).toBe(303);
      const location = new URL(response.headers.get('location') ?? '');
      expect(location.pathname).toBe('/admin/seasons');
      expect(location.searchParams.get('error')).toContain(before.name);
      expect(location.searchParams.get('notice')).toBeNull();

      expect(await activeSeason()).toEqual(before);
      expect(await seasonCount()).toBe(countBefore);
    });

    it('leaves exactly one active season when the confirmation is exact', async () => {
      const route = routes.seasons(sessionUser(adminDiscordId));
      const seasonOne = await activeSeason();

      const first = await route(post({ name: `it-${runId} season A`, confirmSeasonName: seasonOne.name }));
      expect(first.status).toBe(200);
      const firstBody = (await first.json()) as {
        season: { id: string; name: string };
        endedSeason: { id: string; name: string } | null;
      };
      createdSeasonIds.push(firstBody.season.id);
      // The response says what happened, not only what is new.
      expect(firstBody.endedSeason).toEqual({ id: seasonOne.id, name: seasonOne.name });

      // The confirmation moves with the active season: it is now season A that is being ended.
      const stale = await route(post({ name: `it-${runId} season B`, confirmSeasonName: seasonOne.name }));
      expect(stale.status).toBe(400);

      const second = await route(
        post({ name: `it-${runId} season B`, confirmSeasonName: `it-${runId} season A` }),
      );
      expect(second.status).toBe(200);
      const secondBody = (await second.json()) as { season: { id: string } };
      createdSeasonIds.push(secondBody.season.id);

      const { data: active, error } = await db.from('seasons').select('id, ends_at').eq('is_active', true);
      if (error) throw new Error(error.message);
      expect(active?.map((row) => row.id)).toEqual([secondBody.season.id]);

      // The season it replaced is closed, not just deactivated.
      const { data: closed } = await db
        .from('seasons')
        .select('ends_at, is_active')
        .eq('id', firstBody.season.id)
        .single();
      expect(closed?.is_active).toBe(false);
      expect(closed?.ends_at).not.toBeNull();

      // Hand the shared database back immediately rather than at the end of the file: the
      // active season is global state, and this test is the only one that moves it.
      const { error: restoreError } = await db.rpc('set_active_season', { p_id: SEASON_ONE_ID });
      if (restoreError) throw new Error(restoreError.message);
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

      const { rows } = await listAdminPlayers(db, seasonId, { search: `it-${runId}` });
      const member = rows.find((row) => row.id === memberPlayerId);

      expect(member?.rating).toEqual({ mu: 24, sigma: 6, games: 3, wins: 2 });
      expect(member?.discordId).toBe(memberDiscordId);
    });
  });

  /**
   * `/admin/players` past PostgREST's row cap (M3.25).
   *
   * The query used to have no `range` at all, so PostgREST answered with its `max_rows` (1000)
   * and no error: past a thousand players, rows simply were not there, and the page said
   * nothing about it. This seeds past that cap on purpose — the row it looks for sorts *after*
   * the thousandth — so a regression to the unranged query fails here rather than on a Tuesday
   * night when somebody cannot find a friend.
   *
   * All of it is deleted afterwards; the stack is shared.
   */
  describe('paging and search past the 1000-row cap (M3.25)', () => {
    const BULK = 1_200;
    const bulkPrefix = `it-${runId}-pg`;
    // Sorts after every seeded name, so it is well past row 1000 in the page's own order.
    const needlePuuid = `it-${runId}-needle`;
    const needleName = `zzz ${runId} needle`;
    /**
     * Two rows that differ by one character, where that character is `_`. In SQL `LIKE` an
     * unescaped `_` matches any single character, so a search for the first of these used to
     * return both — which on the real stack meant `it_` matched every `it-` player there is.
     */
    const underscorePrefix = `it-${runId}-us`;
    const underscorePuuid = `${underscorePrefix}_score`;
    const otherPuuid = `${underscorePrefix}Xscore`;

    beforeAll(async () => {
      const rows = Array.from({ length: BULK }, (_, index) => ({
        puuid: `${bulkPrefix}${String(index).padStart(4, '0')}`,
        display_name: `Bulk ${runId} ${String(index).padStart(4, '0')}`,
      }));
      rows.push({ puuid: needlePuuid, display_name: needleName });
      rows.push({ puuid: underscorePuuid, display_name: `Under_score ${runId}` });
      rows.push({ puuid: otherPuuid, display_name: `UnderXscore ${runId}` });

      for (let start = 0; start < rows.length; start += 400) {
        const { error } = await db.from('players').insert(rows.slice(start, start + 400));
        if (error) throw new Error(`seeding ${BULK} players failed: ${error.message}`);
      }
    }, 60_000);

    afterAll(async () => {
      const { error } = await db.from('players').delete().like('puuid', `${bulkPrefix}%`);
      if (error) throw new Error(`cleanup: deleting the bulk players failed: ${error.message}`);
      const { error: needleError } = await db.from('players').delete().eq('puuid', needlePuuid);
      if (needleError) throw new Error(`cleanup: deleting the needle failed: ${needleError.message}`);
      const { error: underscoreError } = await db
        .from('players')
        .delete()
        .in('puuid', [underscorePuuid, otherPuuid]);
      if (underscoreError) {
        throw new Error(`cleanup: deleting the underscore pair failed: ${underscoreError.message}`);
      }
    }, 60_000);

    it('reads fifty rows, and says how many there are in total', async () => {
      const page = await listAdminPlayers(db, null);

      expect(page.rows).toHaveLength(ADMIN_PLAYERS_PAGE_SIZE);
      expect(page.pageSize).toBe(ADMIN_PLAYERS_PAGE_SIZE);
      expect(page.page).toBe(1);
      // The seed alone is past the cap, whatever else is in the shared stack.
      expect(page.total).toBeGreaterThan(1_000);
      expect(page.pageCount).toBe(Math.ceil(page.total / ADMIN_PLAYERS_PAGE_SIZE));
      expect(page.search).toBeNull();
    });

    it('still has the row that sorts past the thousandth, on the page it belongs to', async () => {
      const first = await listAdminPlayers(db, null);
      const last = await listAdminPlayers(db, null, { page: first.pageCount });

      const seat = last.rows.findIndex((row) => row.puuid === needlePuuid);
      expect(seat).toBeGreaterThanOrEqual(0);
      // Where it sits in the whole ordered list: past 1000, which is the row the old query
      // would have stopped at.
      expect((last.page - 1) * last.pageSize + seat + 1).toBeGreaterThan(1_000);
      expect(last.page).toBe(first.pageCount);
    });

    it('finds it by display name', async () => {
      const page = await listAdminPlayers(db, null, { search: `zzz ${runId}` });

      expect(page.total).toBe(1);
      expect(page.rows.map((row) => row.puuid)).toEqual([needlePuuid]);
      expect(page.search).toBe(`zzz ${runId}`);
    });

    it('finds it by PUUID prefix, and a prefix that names the whole batch finds the batch', async () => {
      const one = await listAdminPlayers(db, null, { search: needlePuuid });
      expect(one.rows.map((row) => row.puuid)).toEqual([needlePuuid]);

      const batch = await listAdminPlayers(db, null, { search: bulkPrefix });
      expect(batch.total).toBe(BULK);
      expect(batch.rows).toHaveLength(ADMIN_PLAYERS_PAGE_SIZE);
      expect(batch.rows.every((row) => row.puuid.startsWith(bulkPrefix))).toBe(true);
    });

    it('reads an underscore as a character, not as a wildcard', async () => {
      // The PUUID prefix and the display name, because both go through the same escape.
      const byPuuid = await listAdminPlayers(db, null, { search: underscorePuuid });
      expect(byPuuid.rows.map((row) => row.puuid)).toEqual([underscorePuuid]);
      expect(byPuuid.total).toBe(1);

      const byName = await listAdminPlayers(db, null, { search: `Under_score ${runId}` });
      expect(byName.rows.map((row) => row.puuid)).toEqual([underscorePuuid]);

      // And the row it would have swept up with it is still findable on its own.
      const other = await listAdminPlayers(db, null, { search: otherPuuid });
      expect(other.rows.map((row) => row.puuid)).toEqual([otherPuuid]);
    });

    it('answers a search nobody matches with an empty page, not an error', async () => {
      const page = await listAdminPlayers(db, null, { search: `no-such-player-${runId}` });

      expect(page.rows).toEqual([]);
      expect(page.total).toBe(0);
      expect(page.pageCount).toBe(1);
    });

    it('clamps a page past the end onto the last one', async () => {
      const page = await listAdminPlayers(db, null, { search: bulkPrefix, page: 9_999 });

      expect(page.page).toBe(page.pageCount);
      expect(page.rows.length).toBeGreaterThan(0);
      expect(page.total).toBe(BULK);
    });
  });
}
