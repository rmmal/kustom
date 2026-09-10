import { randomUUID } from 'node:crypto';
import type { Database, RoleValue } from '@customs/db';
import { companionLobbyPayloadSchema } from '@customs/db/schemas';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nightStart } from '@/lib/night';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * A role for tonight lasts the night, against the local stack (M3.6, acceptance checks 4 and 5).
 *
 * The unit half is `roleCarry.test.ts`; this is the half nobody can check by reading it — real
 * companion posts through `ingestLobby`, a real `UPDATE lobby_members SET role_override`, and
 * the party's cycles rolling over the way M2.14 rolls them:
 *
 *   1. tap a role, finish the game, let the companion open the night's next cycle → the new
 *      row carries the same override with no second tap;
 *   2. the first lobby of the **next** night carries nothing;
 *   3. a friend who drops out of the client lobby and rejoins inside one cycle gets their
 *      choice back — the delete-then-insert the reviewer found on 2026-09-10.
 *
 * Skipped, not failed, when the stack is not running (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('the role carry against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.BOOTSTRAP_ADMIN_PUUID = '';
  process.env.CUSTOMS_NIGHT_TZ = 'Africa/Cairo';

  const { ingestLobby } = await import('./lobby');
  const { ensurePlayers } = await import('./players');
  const { moveLobby } = await import('@/lib/lobbyState');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const TIME_ZONE = 'Africa/Cairo';
  const runId = randomUUID().slice(0, 8);
  /** Four is enough: nothing here balances, so the roster never has to reach ten. */
  const cast = ['a', 'b', 'c', 'd'].map((letter) => `rc-${runId}-${letter}`);
  const partyIds = new Set<string>();
  let ownerPlayerId = '';

  function party(name: string): string {
    const id = `rc-${runId}-${name}`;
    partyIds.add(id);
    return id;
  }

  function post(partyId: string, members: readonly string[], now: Date) {
    const payload = companionLobbyPayloadSchema.parse({
      partyId,
      lobbyName: 'customs night',
      members: members.map((puuid, index) => ({
        puuid,
        gameName: `Player${index}`,
        tagLine: 'EUW',
        summonerId: 3000 + index,
        side: index < 5 ? 100 : 200,
        isSpectator: false,
      })),
    });
    return ingestLobby(db, payload, ownerPlayerId, { now, timeZone: TIME_ZONE });
  }

  async function playerIdOf(puuid: string): Promise<string> {
    const ids = await ensurePlayers(db, [{ puuid }]);
    const id = ids.get(puuid);
    if (id === undefined) throw new Error(`no player for ${puuid}`);
    return id;
  }

  /** What the tonight page's control does: one row, one column. */
  async function tap(lobbyId: string, puuid: string, role: RoleValue | null): Promise<void> {
    const { error } = await db
      .from('lobby_members')
      .update({ role_override: role })
      .eq('lobby_id', lobbyId)
      .eq('player_id', await playerIdOf(puuid));
    if (error) throw new Error(error.message);
  }

  async function overrideOf(lobbyId: string, puuid: string): Promise<RoleValue | null | 'no row'> {
    const { data, error } = await db
      .from('lobby_members')
      .select('role_override')
      .eq('lobby_id', lobbyId)
      .eq('player_id', await playerIdOf(puuid))
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data === null ? 'no row' : data.role_override;
  }

  /** End the cycle the way a game does, so the party's next post opens a new row (M2.14). */
  async function finish(lobbyId: string): Promise<void> {
    await moveLobby(db, { lobbyId, from: ['open'], to: 'balanced' });
    await moveLobby(db, { lobbyId, from: ['balanced'], to: 'in_game' });
    await moveLobby(db, { lobbyId, from: ['in_game'], to: 'finished' });
  }

  beforeAll(async () => {
    await ensurePlayers(
      db,
      cast.map((puuid) => ({ puuid })),
    );
    ownerPlayerId = await playerIdOf(cast[0] ?? '');
  });

  afterAll(async () => {
    await db
      .from('lobbies')
      .delete()
      .in('lcu_party_id', [...partyIds]);
    await db.from('players').delete().in('puuid', cast);
  });

  describe('the role carry against the local Supabase stack', () => {
    it("carries the tap onto the night's next cycle, with no second tap", async () => {
      const id = party('same-night');
      const now = new Date();

      const first = await post(id, cast, now);
      await tap(first.lobbyId, cast[1] ?? '', 'jungle');
      await finish(first.lobbyId);

      // Twenty minutes later, the same party's next game.
      const second = await post(id, cast, new Date(now.getTime() + 20 * 60_000));
      expect(second.created).toBe(true);
      expect(second.lobbyId).not.toBe(first.lobbyId);

      expect(await overrideOf(second.lobbyId, cast[1] ?? '')).toBe('jungle');
      // Nobody else inherits anything, and the closed row keeps its own value as the record of
      // what the teams were built from.
      expect(await overrideOf(second.lobbyId, cast[2] ?? '')).toBeNull();
      expect(await overrideOf(first.lobbyId, cast[1] ?? '')).toBe('jungle');
    });

    it('carries nothing into the first lobby of the next night', async () => {
      const id = party('next-night');
      const now = new Date();

      const first = await post(id, cast, now);
      await tap(first.lobbyId, cast[1] ?? '', 'support');
      await finish(first.lobbyId);

      // One minute past 06:00 of the following night, in the configured zone.
      const tomorrow = new Date(nightStart(now, TIME_ZONE).getTime() + 24 * 3_600_000 + 60_000);
      const second = await post(id, cast, tomorrow);

      expect(second.created).toBe(true);
      expect(await overrideOf(second.lobbyId, cast[1] ?? '')).toBeNull();
    });

    it('gives a friend who drops out of the lobby and rejoins their role back', async () => {
      const id = party('leave-return');
      const now = new Date();
      const leaver = cast[2] ?? '';

      // A cycle of this party earlier in the night, so the night has a record of the tap.
      const first = await post(id, cast, now);
      await tap(first.lobbyId, leaver, 'mid');
      await finish(first.lobbyId);

      const second = await post(id, cast, new Date(now.getTime() + 15 * 60_000));
      expect(await overrideOf(second.lobbyId, leaver)).toBe('mid');

      // They close the client lobby for a moment: the post without them deletes the row.
      const without = cast.filter((puuid) => puuid !== leaver);
      await post(id, without, new Date(now.getTime() + 16 * 60_000));
      expect(await overrideOf(second.lobbyId, leaver)).toBe('no row');

      // And they are back. The row is re-created, and the choice with it.
      await post(id, cast, new Date(now.getTime() + 17 * 60_000));
      expect(await overrideOf(second.lobbyId, leaver)).toBe('mid');
    });

    it('never re-applies an old value over a tap that has just landed', async () => {
      const id = party('no-clobber');
      const now = new Date();

      const first = await post(id, cast, now);
      await tap(first.lobbyId, cast[1] ?? '', 'top');
      await finish(first.lobbyId);

      const second = await post(id, cast, new Date(now.getTime() + 10 * 60_000));
      expect(await overrideOf(second.lobbyId, cast[1] ?? '')).toBe('top');

      // The friend changes their mind on the page, and the companion re-posts the same lobby.
      await tap(second.lobbyId, cast[1] ?? '', 'adc');
      await post(id, cast, new Date(now.getTime() + 11 * 60_000));
      expect(await overrideOf(second.lobbyId, cast[1] ?? '')).toBe('adc');

      // And clearing it stays cleared.
      await tap(second.lobbyId, cast[1] ?? '', null);
      await post(id, cast, new Date(now.getTime() + 12 * 60_000));
      expect(await overrideOf(second.lobbyId, cast[1] ?? '')).toBeNull();
    });
  });
}
