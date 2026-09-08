import { randomUUID } from 'node:crypto';
import { type Database, rosterKey } from '@customs/db';
import { companionLobbyPayloadSchema } from '@customs/db/schemas';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mintCompanionToken } from '@/lib/companionAuth';
import { ingestLobby } from '@/lib/ingest/lobby';
import { ensurePlayers } from '@/lib/ingest/players';
import { ROSTER_STABLE_MS, sweepIdleLobbies } from '@/lib/lobbyState';
import { nightStart } from '@/lib/night';
import { eogBody, testGameId, testPuuids } from '@/lib/testing/fixtures';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * The lobby state machine and the rating fold (M2.5) against the Supabase CLI local stack:
 * the same ingest the route handlers call, the same service-role client, the same SQL.
 *
 * The clock is injected, so the ten-second window and the two-hour sweep are not waited out.
 * `ingestLobby` takes `now`; the sweep takes `now`; and the one case that has to prove the
 * route runs the sweep inserts a lobby row with an old `updated_at` (the `updated_at` trigger
 * is `before update`, so an insert may set it).
 *
 * Skipped, not failed, when the stack is not running (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('the lobby state machine against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.BOOTSTRAP_ADMIN_PUUID = '';
  process.env.CUSTOMS_NIGHT_TZ = 'Africa/Cairo';

  const { POST: postLobby } = await import('./lobby/route');
  const { POST: postGame } = await import('./game/route');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const TIME_ZONE = 'Africa/Cairo';
  const runId = randomUUID().slice(0, 8);
  /** Ten, plus the extras each case needs. Namespaced so reruns and other files never collide. */
  const puuids = testPuuids(runId);
  const spare = `it-${runId}-spare`;
  const watcher = `it-${runId}-watcher`;
  const allPuuids = new Set<string>([...puuids, spare, watcher]);
  const partyIds = new Set<string>();
  const gameIds = new Set<number>();

  let ownerPlayerId = '';
  let ownerToken = '';
  let secondToken = '';

  function party(name: string): string {
    const id = `st-${runId}-${name}`;
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
    side?: 100 | 200 | null;
    isSpectator?: boolean;
  }

  function body(partyId: string, members: readonly MemberSpec[]): Record<string, unknown> {
    return {
      partyId,
      lobbyName: 'customs night',
      members: members.map((member, index) => ({
        puuid: member.puuid,
        gameName: `Player${index}`,
        tagLine: 'EUW',
        summonerId: 2000 + index,
        side: member.side === undefined ? (index < 5 ? 100 : 200) : member.side,
        isSpectator: member.isSpectator ?? false,
      })),
    };
  }

  function onTeams(list: readonly string[]): MemberSpec[] {
    return list.map((puuid, index) => ({ puuid, side: index < 5 ? 100 : 200 }));
  }

  /** The ingest the route calls, with the clock the test wants. */
  function ingest(partyId: string, members: readonly MemberSpec[], now: Date) {
    const payload = companionLobbyPayloadSchema.parse(body(partyId, members));
    return ingestLobby(db, payload, ownerPlayerId, { now, timeZone: TIME_ZONE });
  }

  function request(json: unknown, token: string): Request {
    return new Request('http://localhost/api/companion/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(json),
    });
  }

  async function splitRows(lobbyId: string): Promise<Record<string, unknown>[]> {
    const { data, error } = await db
      .from('splits')
      .select('*')
      .eq('lobby_id', lobbyId)
      .order('created_at', { ascending: true })
      .order('rank', { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  /**
   * The lobby's own `updated_at`, plus an offset. The stability clock is that column, not the
   * test's wall clock, so every injected "ten seconds later" is measured from it.
   */
  async function clockAt(lobbyId: string, offsetMs: number): Promise<Date> {
    const { data, error } = await db.from('lobbies').select('updated_at').eq('id', lobbyId).single();
    if (error) throw new Error(error.message);
    return new Date(Date.parse(data.updated_at) + offsetMs);
  }

  async function lobbyStatus(lobbyId: string): Promise<string> {
    const { data, error } = await db.from('lobbies').select('status').eq('id', lobbyId).single();
    if (error) throw new Error(error.message);
    return data.status;
  }

  async function playerIdOf(puuid: string): Promise<string> {
    const ids = await ensurePlayers(db, [{ puuid }]);
    const id = ids.get(puuid);
    if (id === undefined) throw new Error(`no player for ${puuid}`);
    return id;
  }

  async function mintToken(puuid: string): Promise<string> {
    const playerId = await playerIdOf(puuid);
    const { token, tokenHash } = mintCompanionToken();
    const { error } = await db
      .from('companion_tokens')
      .insert({ player_id: playerId, token_hash: tokenHash, label: `st-${runId}` });
    if (error) throw new Error(error.message);
    return token;
  }

  /** A finished game with no lobby, purely so somebody has "games tonight". */
  async function recordGame(puuid: string, startedAt: Date): Promise<void> {
    const lcuGameId = gameNumber();
    const { data, error } = await db
      .from('games')
      .insert({
        lcu_game_id: lcuGameId,
        started_at: startedAt.toISOString(),
        duration_s: 1_800,
        winning_side: 100,
        raw: {},
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);

    const { error: playerError } = await db
      .from('game_players')
      .insert({ game_id: data.id, player_id: await playerIdOf(puuid), side: 100 });
    if (playerError) throw new Error(playerError.message);
  }

  beforeAll(async () => {
    await ensurePlayers(
      db,
      [...allPuuids].map((puuid) => ({ puuid })),
    );
    ownerPlayerId = await playerIdOf(puuids[0] ?? '');
    ownerToken = await mintToken(puuids[0] ?? '');
    secondToken = await mintToken(puuids[1] ?? '');
  });

  afterAll(async () => {
    await db
      .from('games')
      .delete()
      .in('lcu_game_id', [...gameIds]);
    await db
      .from('lobbies')
      .delete()
      .in('lcu_party_id', [...partyIds]);
    await db
      .from('players')
      .delete()
      .in('puuid', [...allPuuids]);
  });

  describe('the ten-second stability rule', () => {
    it('leaves nine people open forever, with nothing to knock about', async () => {
      const id = party('nine');
      const start = new Date();

      const first = await ingest(id, onTeams(puuids.slice(0, 9)), start);
      expect(first).toMatchObject({ status: 'open', memberCount: 9, recheckInMs: null });

      const later = await ingest(id, onTeams(puuids.slice(0, 9)), new Date(start.getTime() + 30_000));
      expect(later).toMatchObject({ status: 'open', recheckInMs: null });
      expect(await splitRows(first.lobbyId)).toHaveLength(0);
    });

    it('balances nine on teams plus one spectator: a spectator is one of the people here', async () => {
      const id = party('nine-plus-watcher');
      const start = new Date();
      const members: MemberSpec[] = [
        ...onTeams(puuids.slice(0, 9)),
        { puuid: watcher, side: null, isSpectator: true },
      ];

      const first = await ingest(id, members, start);
      expect(first).toMatchObject({ status: 'open', memberCount: 10, recheckInMs: ROSTER_STABLE_MS });

      const balanced = await ingest(id, members, await clockAt(first.lobbyId, ROSTER_STABLE_MS));
      expect(balanced).toMatchObject({ status: 'balanced', recheckInMs: null });

      const rows = await splitRows(balanced.lobbyId);
      expect(rows).toHaveLength(3);
      const chosen = rows.find((row) => row.is_chosen === true);
      const blue = chosen?.blue as { puuid: string }[];
      const red = chosen?.red as { puuid: string }[];
      expect([...blue, ...red].map((entry) => entry.puuid)).toContain(watcher);
    });

    it('counts down, then balances into exactly three splits with one chosen', async () => {
      const id = party('ten');
      const start = new Date();

      const first = await ingest(id, onTeams(puuids), start);
      expect(first).toMatchObject({ status: 'open', memberCount: 10, recheckInMs: ROSTER_STABLE_MS });
      expect(await splitRows(first.lobbyId)).toHaveLength(0);

      // Half way there: still open, and the answer says how long is left.
      const halfway = await ingest(id, onTeams(puuids), await clockAt(first.lobbyId, 4_000));
      expect(halfway.status).toBe('open');
      expect(halfway.recheckInMs).toBe(6_000);

      const balanced = await ingest(id, onTeams(puuids), await clockAt(first.lobbyId, ROSTER_STABLE_MS));
      expect(balanced).toMatchObject({ status: 'balanced', recheckInMs: null });

      const rows = await splitRows(balanced.lobbyId);
      expect(rows).toHaveLength(3);
      expect(rows.map((row) => row.rank)).toEqual([1, 2, 3]);
      expect(rows.filter((row) => row.is_chosen === true)).toHaveLength(1);
      expect(rows.find((row) => row.is_chosen === true)?.rank).toBe(1);
      expect(new Set(rows.map((row) => row.roster_key))).toEqual(new Set([rosterKey(puuids)]));
      expect(rows.every((row) => typeof row.explanation === 'string' && row.explanation.length > 0)).toBe(
        true,
      );
    });

    it('does nothing at all on a third identical post', async () => {
      const id = party('ten');
      const now = new Date(Date.now() + 60_000);
      const before = await splitRows((await ingest(id, onTeams(puuids), now)).lobbyId);

      const again = await ingest(id, onTeams(puuids), now);
      expect(again.status).toBe('balanced');

      const after = await splitRows(again.lobbyId);
      expect(after).toHaveLength(3);
      expect(after.find((row) => row.is_chosen === true)?.id).toBe(
        before.find((row) => row.is_chosen === true)?.id,
      );
    });

    it('goes back to open when someone is swapped, and rebalances into a second set of three', async () => {
      const id = party('swap');

      const first = await ingest(id, onTeams(puuids), new Date());
      const balanced = await ingest(id, onTeams(puuids), await clockAt(first.lobbyId, ROSTER_STABLE_MS));
      expect(balanced.status).toBe('balanced');

      const swapped = [...puuids.slice(0, 9), spare];
      const reopened = await ingest(id, onTeams(swapped), new Date());
      expect(reopened).toMatchObject({ status: 'open', recheckInMs: ROSTER_STABLE_MS });
      expect(await splitRows(reopened.lobbyId)).toHaveLength(3);

      const rebalanced = await ingest(
        id,
        onTeams(swapped),
        await clockAt(reopened.lobbyId, ROSTER_STABLE_MS),
      );
      expect(rebalanced.status).toBe('balanced');

      const rows = await splitRows(rebalanced.lobbyId);
      expect(rows).toHaveLength(6);
      const chosen = rows.filter((row) => row.is_chosen === true);
      expect(chosen).toHaveLength(1);
      // The flag moved to the newer set; the older three are still there as history.
      expect(chosen[0]?.roster_key).toBe(rosterKey(swapped));
    });

    it('produces one balance and three splits when two companions post at the same moment', async () => {
      const id = party('race');

      const created = await ingest(id, onTeams(puuids), new Date());
      const stable = await clockAt(created.lobbyId, ROSTER_STABLE_MS);
      const [a, b] = await Promise.all([
        ingest(id, onTeams(puuids), stable),
        ingest(id, onTeams(puuids), stable),
      ]);

      expect([a.status, b.status]).toEqual(['balanced', 'balanced']);
      const rows = await splitRows(created.lobbyId);
      expect(rows).toHaveLength(3);
      expect(rows.filter((row) => row.is_chosen === true)).toHaveLength(1);
    });
  });

  describe('choosing the ten, and who sits', () => {
    it('sits whoever has played most tonight and puts the spectator in their slot', async () => {
      const id = party('eleven');
      const busy = puuids[3] ?? '';
      await recordGame(busy, new Date(Date.now() - 60 * 60 * 1000));
      await recordGame(busy, new Date(Date.now() - 30 * 60 * 1000));

      const members: MemberSpec[] = [...onTeams(puuids), { puuid: watcher, side: null, isSpectator: true }];
      const first = await ingest(id, members, new Date());
      const balanced = await ingest(id, members, await clockAt(first.lobbyId, ROSTER_STABLE_MS));

      expect(balanced.status).toBe('balanced');
      const outcome = balanced.balanced;
      expect(outcome).not.toBeNull();
      const chosen = [...(outcome?.split.blue ?? []), ...(outcome?.split.red ?? [])].map((a) => a.puuid);

      expect(chosen).toHaveLength(10);
      expect(chosen).not.toContain(busy);
      expect(chosen).toContain(watcher);
      expect(outcome?.sitters.map((member) => member.puuid)).toEqual([busy]);
      expect(outcome?.seatMoves).toHaveLength(1);
      expect(outcome?.seatMoves[0]?.mover.puuid).toBe(watcher);
      expect(outcome?.seatMoves[0]?.sitter?.puuid).toBe(busy);
      expect(outcome?.tiedOnGames).toBe(false);

      // Nobody was removed from the lobby: sitting out is derived, never stored.
      const { count } = await db
        .from('lobby_members')
        .select('player_id', { count: 'exact', head: true })
        .eq('lobby_id', balanced.lobbyId);
      expect(count).toBe(11);
    });

    it('runs the night from 06:00 to 06:00, so a 02:00 game counts at 03:00 and not at 07:00', async () => {
      // A whole cast of its own, so no other case's history can order this one.
      const cast = Array.from({ length: 11 }, (_, index) => `it-${runId}-n${String(index).padStart(2, '0')}`);
      for (const puuid of cast) allPuuids.add(puuid);
      await ensurePlayers(
        db,
        cast.map((puuid) => ({ puuid })),
      );

      // A month out, so the injected clock is always well past the row's own `updated_at` and
      // the ten seconds are never the thing under test here.
      const hour = 60 * 60 * 1000;
      const nightA = nightStart(new Date(Date.now() + 30 * 24 * hour), TIME_ZONE);
      const at0200 = new Date(nightA.getTime() + 20 * hour);
      const at0300 = new Date(nightA.getTime() + 21 * hour);
      const nightB = nightStart(new Date(nightA.getTime() + 26 * hour), TIME_ZONE);
      const at0700 = new Date(nightB.getTime() + hour);

      // 02:00 is inside the night that started the previous morning, and outside the next one.
      expect(nightStart(at0300, TIME_ZONE).getTime()).toBe(nightA.getTime());
      expect(nightStart(at0700, TIME_ZONE).getTime()).toBe(nightB.getTime());
      expect(nightB.getTime()).toBeGreaterThan(at0200.getTime());

      // The last puuid in sort order, so with nothing counted it is the last to be sat.
      const late = cast[cast.length - 1] ?? '';
      await recordGame(late, at0200);

      const members = onTeams(cast);
      const sameNight = party('night-inside');
      await ingest(sameNight, members, at0300);
      const inside = await ingest(sameNight, members, at0300);
      expect(inside.balanced?.sitters.map((member) => member.puuid)).toEqual([late]);

      const nextNight = party('night-outside');
      await ingest(nextNight, members, at0700);
      const outside = await ingest(nextNight, members, at0700);
      expect(outside.balanced?.sitters.map((member) => member.puuid)).not.toContain(late);
      expect(outside.balanced?.tiedOnGames).toBe(true);
    });
  });

  describe('in_game and the freeze', () => {
    it('moves to in_game on the in_progress post and stops moving the roster', async () => {
      const id = party('in-progress');
      const first = await ingest(id, onTeams(puuids), new Date());
      const balanced = await ingest(id, onTeams(puuids), await clockAt(first.lobbyId, ROSTER_STABLE_MS));
      expect(balanced.status).toBe('balanced');

      const response = await postGame(
        request({ phase: 'in_progress', gameId: gameNumber(), partyId: id }, ownerToken),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, lobbyId: balanced.lobbyId });
      expect(await lobbyStatus(balanced.lobbyId)).toBe('in_game');

      // M2.9 regression: a companion that reconnects mid-game and posts three members.
      const partial = await postLobby(request(body(id, onTeams(puuids.slice(0, 3))), ownerToken));
      expect(await partial.json()).toMatchObject({
        status: 'in_game',
        rosterFrozen: true,
        memberCount: 10,
        recheckInMs: null,
      });
    });
  });

  describe('the rating fold', () => {
    it('rates a real game once, however many companions post it', async () => {
      const id = party('rated');
      const lcuGameId = gameNumber();
      const opened = await ingest(id, onTeams(puuids), new Date());
      const balanced = await ingest(id, onTeams(puuids), await clockAt(opened.lobbyId, ROSTER_STABLE_MS));
      await postGame(request({ phase: 'in_progress', gameId: lcuGameId, partyId: id }, ownerToken));

      const eog = eogBody({ gameId: lcuGameId, puuids, partyId: id, durationS: 900, winningSide: 100 });
      const first = await postGame(request(eog, ownerToken));
      expect(first.status).toBe(200);
      const gameRowId = (await first.json()).gameId as string;

      expect(await lobbyStatus(balanced.lobbyId)).toBe('finished');

      const { data: players } = await db
        .from('game_players')
        .select('player_id, side, mu_before, sigma_before, mu_after, sigma_after')
        .eq('game_id', gameRowId);
      expect(players).toHaveLength(10);
      expect(
        players?.every(
          (row) =>
            row.mu_before !== null &&
            row.sigma_before !== null &&
            row.mu_after !== null &&
            row.sigma_after !== null,
        ),
      ).toBe(true);
      // The winners went up and the losers went down.
      expect(
        players?.filter((row) => row.side === 100).every((row) => (row.mu_after ?? 0) > (row.mu_before ?? 0)),
      ).toBe(true);
      expect(
        players?.filter((row) => row.side === 200).every((row) => (row.mu_after ?? 0) < (row.mu_before ?? 0)),
      ).toBe(true);

      const { data: ratings } = await db
        .from('ratings')
        .select('player_id, mu, sigma, games, wins, updated_at')
        .in(
          'player_id',
          (players ?? []).map((row) => row.player_id),
        );
      expect(ratings).toHaveLength(10);
      expect(ratings?.every((row) => row.games === 1)).toBe(true);
      expect(ratings?.filter((row) => row.wins === 1)).toHaveLength(5);

      const before = JSON.stringify(
        [...(ratings ?? [])].sort((a, b) => (a.player_id < b.player_id ? -1 : 1)),
      );

      // A second companion in the same game posts the same block.
      const second = await postGame(request(eog, secondToken));
      expect(second.status).toBe(200);
      expect(await second.json()).toMatchObject({ created: false, participants: 10 });

      const { data: after } = await db
        .from('ratings')
        .select('player_id, mu, sigma, games, wins, updated_at')
        .in(
          'player_id',
          (players ?? []).map((row) => row.player_id),
        );
      expect(JSON.stringify([...(after ?? [])].sort((a, b) => (a.player_id < b.player_id ? -1 : 1)))).toBe(
        before,
      );

      const { count } = await db
        .from('games')
        .select('id', { count: 'exact', head: true })
        .eq('lcu_game_id', lcuGameId);
      expect(count).toBe(1);
    });

    it.each([
      ['300 seconds exactly is not a game', { durationS: 300 }, false],
      ['301 seconds is', { durationS: 301 }, true],
    ])('%s', async (_label, options, rated) => {
      const lcuGameId = gameNumber();
      const cast = Array.from({ length: 10 }, (_, i) => `it-${runId}-g${String(gameIds.size)}-${i}`);
      for (const puuid of cast) allPuuids.add(puuid);

      const response = await postGame(
        request(eogBody({ gameId: lcuGameId, puuids: cast, ...options }), ownerToken),
      );
      // The caller is not on this scoreboard, so it is posted by one of its own players.
      expect([200, 403]).toContain(response.status);
      const token = await mintToken(cast[0] ?? '');
      const posted = await postGame(request(eogBody({ gameId: lcuGameId, puuids: cast, ...options }), token));
      const gameRowId = (await posted.json()).gameId as string;

      const { data } = await db.from('game_players').select('mu_after').eq('game_id', gameRowId);
      expect(data).toHaveLength(10);
      expect(data?.every((row) => row.mu_after !== null)).toBe(rated);
    });

    it.each([
      ['nine participants', 9, [100, 100, 100, 100, 100, 200, 200, 200, 200]],
      ['six and four', 10, [100, 100, 100, 100, 100, 100, 200, 200, 200, 200]],
    ])('stores %s and does not rate them', async (_label, count, sides) => {
      const lcuGameId = gameNumber();
      const cast = Array.from({ length: count }, (_, i) => `it-${runId}-u${String(gameIds.size)}-${i}`);
      for (const puuid of cast) allPuuids.add(puuid);
      const token = await mintToken(cast[0] ?? '');

      const base = eogBody({ gameId: lcuGameId, puuids: cast, durationS: 1_200 });
      const participants = (base.participants as Record<string, unknown>[]).map((participant, index) => ({
        ...participant,
        side: sides[index],
      }));

      const response = await postGame(request({ ...base, participants }, token));
      expect(response.status).toBe(200);
      const gameRowId = (await response.json()).gameId as string;

      const { data } = await db.from('game_players').select('mu_after').eq('game_id', gameRowId);
      expect(data).toHaveLength(count);
      expect(data?.every((row) => row.mu_after === null)).toBe(true);

      const { count: ratingCount } = await db
        .from('ratings')
        .select('player_id', { count: 'exact', head: true })
        .in('player_id', await Promise.all(cast.map((puuid) => playerIdOf(puuid))));
      expect(ratingCount).toBe(0);
    });

    it('rates a game whose party id matches no lobby, with lobby_id null', async () => {
      const lcuGameId = gameNumber();
      const cast = Array.from({ length: 10 }, (_, i) => `it-${runId}-o${i}`);
      for (const puuid of cast) allPuuids.add(puuid);
      const token = await mintToken(cast[0] ?? '');

      const response = await postGame(
        request(
          eogBody({ gameId: lcuGameId, puuids: cast, partyId: `st-${runId}-never-seen`, durationS: 1_500 }),
          token,
        ),
      );
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.lobbyId).toBeNull();

      const { data } = await db
        .from('game_players')
        .select('mu_after')
        .eq('game_id', json.gameId as string);
      expect(data?.every((row) => row.mu_after !== null)).toBe(true);
    });

    it('seeds an unrated player from their rank, and writes no ratings row before the fold', async () => {
      const lcuGameId = gameNumber();
      const cast = Array.from({ length: 10 }, (_, i) => `it-${runId}-s${i}`);
      for (const puuid of cast) allPuuids.add(puuid);
      const token = await mintToken(cast[0] ?? '');

      const unranked = cast[0] ?? '';
      const platinum = cast[9] ?? '';
      await ensurePlayers(
        db,
        cast.map((puuid) => ({ puuid })),
      );
      await db
        .from('players')
        .update({ rank_tier: 'PLATINUM', rank_division: 'I', rank_updated_at: new Date().toISOString() })
        .eq('puuid', platinum);

      const response = await postGame(
        request(eogBody({ gameId: lcuGameId, puuids: cast, durationS: 1_500 }), token),
      );
      const gameRowId = (await response.json()).gameId as string;

      const { data } = await db
        .from('game_players')
        .select('mu_before, sigma_before, players!inner(puuid)')
        .eq('game_id', gameRowId);
      const seeded = new Map((data ?? []).map((row) => [row.players.puuid, row]));

      // No rank at all: mu 20.00, sigma 10.00.
      expect(seeded.get(unranked)?.mu_before).toBeCloseTo(20, 6);
      expect(seeded.get(unranked)?.sigma_before).toBeCloseTo(10, 6);
      // Platinum I: 26 + 3 * 0.75 = 28.25, sigma 8.33.
      expect(seeded.get(platinum)?.mu_before).toBeCloseTo(28.25, 6);
      expect(seeded.get(platinum)?.sigma_before).toBeCloseTo(8.33, 6);
    });
  });

  describe('the idle sweep', () => {
    it('abandons an open lobby two hours idle, keeps a fresh one, and never touches in_game', async () => {
      const now = Date.now();
      const stale = party('stale');
      const fresh = party('fresh');
      const playing = party('playing');

      // The `updated_at` trigger is `before update`, so an insert may set it.
      const { data, error } = await db
        .from('lobbies')
        .insert([
          {
            lcu_party_id: stale,
            status: 'open',
            updated_at: new Date(now - (2 * 60 * 60 * 1000 + 60_000)).toISOString(),
          },
          {
            lcu_party_id: fresh,
            status: 'balanced',
            updated_at: new Date(now - (60 * 60 * 1000 + 59 * 60_000)).toISOString(),
          },
          {
            lcu_party_id: playing,
            status: 'in_game',
            updated_at: new Date(now - 3 * 60 * 60 * 1000).toISOString(),
          },
        ])
        .select('id, lcu_party_id');
      if (error) throw new Error(error.message);
      const idOf = new Map((data ?? []).map((row) => [row.lcu_party_id, row.id]));

      // Any later companion post runs the sweep; this one is a lobby the caller is in.
      const other = party('sweeper');
      const response = await postLobby(request(body(other, onTeams(puuids.slice(0, 3))), ownerToken));
      expect(response.status).toBe(200);

      expect(await lobbyStatus(idOf.get(stale) ?? '')).toBe('abandoned');
      expect(await lobbyStatus(idOf.get(fresh) ?? '')).toBe('balanced');
      // `in_game` is deliberately never swept: its roster is frozen and must stay that way.
      expect(await lobbyStatus(idOf.get(playing) ?? '')).toBe('in_game');
    });

    it('sweeps nothing when nothing is stale', async () => {
      expect(await sweepIdleLobbies(db, new Date())).toBe(0);
    });
  });
}
