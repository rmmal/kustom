import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ROSTER_STABLE_MS } from '@/lib/lobbyState';
import { eogBody, lobbyBody } from '@/lib/testing/fixtures';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * The tonight page against the Supabase CLI local stack (M3.4).
 *
 * What it proves that a component test cannot: the page's first paint is assembled **with the
 * anon key**, through RLS, from rows a real companion post wrote — and that it follows the
 * lobby from filling to teams to the result without a second definition of any of it. The
 * Realtime subscription itself is exercised by hand against `pnpm --filter web dev`; what is
 * automated here is the state every event re-reads.
 *
 * Skipped, not failed, without the local stack (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('the tonight page against the local Supabase stack', () => {
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

  const { mintCompanionToken } = await import('@/lib/companionAuth');
  const { ensurePlayers } = await import('@/lib/ingest/players');
  const { promoteSplit } = await import('@/lib/admin/reroll');
  const { loadTonight } = await import('@/lib/tonight/load');
  const { tonightStart } = await import('@/lib/tonight/night');
  const { createPublicClient } = await import('@/lib/publicClient');
  const { TonightView } = await import('./_tonight/TonightView');
  const { POST: postLobby } = await import('./api/companion/lobby/route');
  const { POST: postGame } = await import('./api/companion/game/route');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  /** The page's own client: the anon key and nothing else, exactly as a phone would read. */
  const anon = createPublicClient();

  const runId = randomUUID().slice(0, 8);
  const ten = Array.from({ length: 10 }, (_, index) => `it-${runId}-tn${String(index).padStart(2, '0')}`);
  const partyId = `tn-${runId}`;
  const gameId = Number(`9${Date.now() % 1_000_000_000}`);

  let token = '';
  let lobbyId = '';
  /** The three who joined first, in the order the page put them in. */
  let firstThree: string[] = [];

  function companionRequest(path: string, json: unknown): Request {
    return new Request(`http://localhost/api/companion/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(json),
    });
  }

  function members(count: number) {
    return ten.slice(0, count).map((puuid, index) => ({
      puuid,
      gameName: `Player${index}`,
      tagLine: 'EUW',
      summonerId: 7_000 + index,
      side: (index < 5 ? 100 : 200) as 100 | 200,
    }));
  }

  /** What the page renders on the server for this snapshot: the first paint, as HTML. */
  async function firstPaint(): Promise<string> {
    const snapshot = await loadTonight(anon, { nightStart: tonightStart() });
    return renderToStaticMarkup(createElement(TonightView, { snapshot, viewerPuuid: null, isAdmin: false }));
  }

  beforeAll(async () => {
    const ids = await ensurePlayers(
      db,
      ten.map((puuid) => ({ puuid })),
    );
    const { token: raw, tokenHash } = mintCompanionToken();
    const { error } = await db
      .from('companion_tokens')
      .insert({ player_id: ids.get(ten[0] ?? '') ?? '', token_hash: tokenHash, label: `tn-${runId}` });
    if (error) throw new Error(error.message);
    token = raw;
  });

  describe('the tonight page, read with the anon key', () => {
    it('shows the lobby filling up, in join order, with a rating beside every name', async () => {
      const response = await postLobby(
        companionRequest('lobby', lobbyBody({ partyId, members: members(3) })),
      );
      expect(response.status).toBe(200);
      lobbyId = ((await response.json()) as { lobbyId: string }).lobbyId;

      const snapshot = await loadTonight(anon, { nightStart: tonightStart() });
      expect(snapshot.lobby?.id).toBe(lobbyId);
      expect(snapshot.lobby?.status).toBe('open');
      expect([...(snapshot.lobby?.members ?? [])].map((member) => member.name).sort()).toEqual([
        'Player0',
        'Player1',
        'Player2',
      ]);
      for (const member of snapshot.lobby?.members ?? []) {
        expect(member.rating).toBeGreaterThan(0);
      }

      // The order is stable between reads, which is the rule the design cares about: a list
      // that reorders under a thumb is worse than a list you scroll. Three members who first
      // appeared in the same post share a `created_at` to the microsecond, so the tie is
      // broken on `player_id` — arbitrary, but the same arbitrary answer every time.
      const again = await loadTonight(anon, { nightStart: tonightStart() });
      expect(again.lobby?.members.map((member) => member.puuid)).toEqual(
        snapshot.lobby?.members.map((member) => member.puuid),
      );
      firstThree = snapshot.lobby?.members.map((member) => member.puuid) ?? [];

      // The first paint carries content, not a loading state.
      const html = await firstPaint();
      expect(html).toContain('3');
      expect(html).toContain('Player0');
      expect(html).not.toContain('Loading');
    });

    it('follows the lobby to teams and carries the promoted split verbatim', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        const first = await postLobby(
          companionRequest('lobby', lobbyBody({ partyId, members: members(10) })),
        );
        expect(first.status).toBe(200);
        const { data } = await db.from('lobbies').select('updated_at').eq('id', lobbyId).single();
        vi.setSystemTime(Date.parse(data?.updated_at ?? '') + ROSTER_STABLE_MS + 1_000);
        const second = await postLobby(
          companionRequest('lobby', lobbyBody({ partyId, members: members(10) })),
        );
        expect(await second.json()).toMatchObject({ status: 'balanced' });
      } finally {
        vi.useRealTimers();
      }

      const filled = await loadTonight(anon, { nightStart: tonightStart() });
      // Nothing above the newest row moved: the seven who joined later are appended.
      expect(filled.lobby?.members.slice(0, 3).map((member) => member.puuid)).toEqual(firstThree);

      const snapshot = filled;
      expect(snapshot.lobby?.status).toBe('balanced');
      expect(snapshot.lobby?.teams?.blue).toHaveLength(5);
      expect(snapshot.lobby?.teams?.red).toHaveLength(5);
      // The chosen split's own balance run, and only that run: three splits, ranked.
      expect(snapshot.lobby?.teams?.splits.map((split) => split.rank)).toEqual([1, 2, 3]);
      expect(snapshot.lobby?.teams?.splits.filter((split) => split.isChosen)).toHaveLength(1);

      const { data: stored } = await db
        .from('splits')
        .select('explanation')
        .eq('lobby_id', lobbyId)
        .eq('is_chosen', true)
        .single();
      // Verbatim: the page prints the stored sentence and never recomposes it.
      expect(snapshot.lobby?.teams?.explanation).toBe(stored?.explanation);
      expect(await firstPaint()).toContain(escapeHtml(stored?.explanation ?? ''));
    });

    it('follows a reroll: the page becomes the promoted split, sentence and seats (M3.7)', async () => {
      const before = await loadTonight(anon, { nightStart: tonightStart() });
      const second = before.lobby?.teams?.splits.find((split) => split.rank === 2);
      expect(second).toBeDefined();

      const promoted = await promoteSplit(db, { lobbyId, splitId: second?.id ?? '' });
      expect(promoted.ok).toBe(true);

      const after = await loadTonight(anon, { nightStart: tonightStart() });
      const { data: stored } = await db
        .from('splits')
        .select('explanation, blue')
        .eq('id', second?.id ?? '')
        .single();

      expect(after.lobby?.teams?.splitId).toBe(second?.id);
      expect(after.lobby?.teams?.explanation).toBe(stored?.explanation);
      expect(after.lobby?.teams?.explanation).not.toBe(before.lobby?.teams?.explanation);
      // The seats are that split's, not the old one's.
      const blue = (stored?.blue ?? []) as { puuid: string; role: string }[];
      expect(after.lobby?.teams?.blue.map((seat) => `${seat.puuid}:${seat.role}`)).toEqual(
        blue.map((seat) => `${seat.puuid}:${seat.role}`),
      );
    });

    it('becomes the result when the game ends, with both mu values for the delta', async () => {
      const response = await postGame(
        companionRequest('game', eogBody({ gameId, puuids: ten, partyId, durationS: 2_052 })),
      );
      expect(response.status).toBe(200);

      const snapshot = await loadTonight(anon, { nightStart: tonightStart() });
      expect(snapshot.lobby?.status).toBe('finished');
      expect(snapshot.lobby?.result?.rated).toBe(true);
      expect(snapshot.lobby?.result?.blue).toHaveLength(5);
      for (const seat of snapshot.lobby?.result?.blue ?? []) {
        expect(typeof seat.muBefore).toBe('number');
        expect(typeof seat.muAfter).toBe('number');
      }

      const html = await firstPaint();
      expect(html).toMatch(/(Blue|Red) wins/);
      // The delta is rendered, and it is signed.
      expect(html).toMatch(/\((\+|−)\d+\)/);
    });

    it('never puts a Discord id on the wire, and the anon key cannot ask for one', async () => {
      expect(await firstPaint()).not.toContain('discord');

      const { error } = await anon.from('players').select('discord_id').limit(1);
      expect(error).not.toBeNull();
    });
  });
}

/** React escapes what it renders; the assertions compare against the same escaping. */
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
