import { randomUUID } from 'node:crypto';
import type { Database } from '@customs/db';
import { createClient } from '@supabase/supabase-js';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveLocalStack } from '@/lib/testing/localStack';

/**
 * `/leaderboard` and `/p/[puuid]` against the Supabase CLI local stack (M3.5, M3.8, M3.10).
 *
 * What it proves that a component test cannot: both pages are assembled **with the anon key**,
 * through RLS, from real rows — the ordering is the database's rows put through
 * `provenRating`, the names come out of `players_public` for the ids being rendered, and a
 * player with a null name reaches the page as `Someone` with no puuid anywhere near it.
 *
 * Rows are namespaced by a run id and deleted afterwards; the active season is shared with
 * every other file here, so nothing asserts an absolute rank — only the order of this run's
 * own three players, which is what the rule is about.
 *
 * Skipped, not failed, without the local stack (`pnpm db:start`).
 */

const stack = await resolveLocalStack();

if (stack === null) {
  describe.skip('the board against the local Supabase stack', () => {
    it('needs the local stack: run `pnpm db:start`', () => {
      expect(true).toBe(true);
    });
  });
} else {
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = stack.anonKey;

  const { loadBoard, loadPlayerBoard } = await import('@/lib/board/load');
  const { createPublicClient } = await import('@/lib/publicClient');
  const { BoardView } = await import('./_board/BoardView');
  const { PlayerView } = await import('./_board/PlayerView');
  const { NAMELESS_HINT } = await import('@/lib/tonight/copy');

  const db = createClient<Database>(stack.url, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  /** The page's own client: the anon key and nothing else, exactly as a phone would read. */
  const anon = createPublicClient();

  const runId = randomUUID().slice(0, 8);
  const puuid = {
    zoe: `it-${runId}-lb0`,
    nameless: `it-${runId}-lb1`,
    ali: `it-${runId}-lb2`,
  };

  /**
   * The rendered page as a reader sees it: no tags, and the entities React escapes decoded.
   * The apostrophe in `someone's` comes out of `renderToStaticMarkup` as `&#x27;`, and a
   * puuid is in the href of a row's link on purpose — the page is keyed by PUUID — so "no
   * puuid on the page" is a statement about text, not about markup.
   */
  function textOf(html: string): string {
    return html
      .replace(/<[^>]*>/g, ' ')
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }

  let seasonId = '';
  const playerIds: Record<keyof typeof puuid, string> = { zoe: '', nameless: '', ali: '' };
  const gameIds: string[] = [];

  beforeAll(async () => {
    const { data: season } = await db.from('seasons').select('id').eq('is_active', true).maybeSingle();
    seasonId = season?.id ?? '';
    expect(seasonId).not.toBe('');

    const { data: players, error } = await db
      .from('players')
      .insert([
        { puuid: puuid.zoe, display_name: 'Zoe', rank_tier: 'GOLD', rank_division: 'IV' },
        // The M3.10 case: the database has never been told this player's name.
        { puuid: puuid.nameless, rank_tier: 'SILVER', rank_division: 'IV' },
        { puuid: puuid.ali, display_name: 'Ali', rank_tier: 'GOLD', rank_division: 'IV' },
      ])
      .select('id, puuid');
    expect(error).toBeNull();
    for (const row of players ?? []) {
      if (row.puuid === puuid.zoe) playerIds.zoe = row.id;
      if (row.puuid === puuid.nameless) playerIds.nameless = row.id;
      if (row.puuid === puuid.ali) playerIds.ali = row.id;
    }

    // Two of the three have a rating row; the nameless one is seeded from rank in memory, the
    // way `loadPool` seeds them, and must still appear on the board.
    await db.from('ratings').insert([
      { player_id: playerIds.zoe, season_id: seasonId, mu: 25.2, sigma: 5, games: 2, wins: 1 },
      { player_id: playerIds.ali, season_id: seasonId, mu: 22, sigma: 6, games: 2, wins: 1 },
    ]);

    const startedAt = Date.now();
    for (const [index, game] of [
      { winning_side: 100, minutesAgo: 60, zoeRole: 'top', muBefore: 25, muAfter: 25.6 },
      { winning_side: 200, minutesAgo: 20, zoeRole: 'mid', muBefore: 25.6, muAfter: 25.2 },
    ].entries()) {
      const { data: row } = await db
        .from('games')
        .insert({
          lcu_game_id: Number(`8${(startedAt % 1_000_000_00) * 10 + index}`),
          season_id: seasonId,
          started_at: new Date(startedAt - game.minutesAgo * 60_000).toISOString(),
          duration_s: 2_000,
          winning_side: game.winning_side,
          raw: {},
        })
        .select('id')
        .single();
      const gameId = row?.id ?? '';
      gameIds.push(gameId);

      await db.from('game_players').insert([
        {
          game_id: gameId,
          player_id: playerIds.zoe,
          side: 100,
          role: game.zoeRole as 'top' | 'mid',
          mu_before: game.muBefore,
          sigma_before: 5,
          mu_after: game.muAfter,
          sigma_after: 5,
        },
        {
          game_id: gameId,
          player_id: playerIds.ali,
          side: 200,
          role: 'support',
          mu_before: 22,
          sigma_before: 6,
          mu_after: 22,
          sigma_after: 6,
        },
        // On Zoe's side and never rated: the lineup still prints them, and they still have no
        // games of their own.
        { game_id: gameId, player_id: playerIds.nameless, side: 100, role: 'jungle' },
      ]);
    }
  });

  afterAll(async () => {
    if (gameIds.length > 0) await db.from('games').delete().in('id', gameIds);
    const ids = Object.values(playerIds).filter((id) => id !== '');
    if (ids.length > 0) {
      await db.from('ratings').delete().in('player_id', ids);
      await db.from('players').delete().in('id', ids);
    }
  });

  describe('the board with the anon key', () => {
    it('orders this run three by Proven, and prints the number it ordered them by', async () => {
      const board = await loadBoard(anon);
      const mine = board.rows.filter((row) => Object.values(puuid).includes(row.puuid));

      expect(mine.map((row) => row.puuid)).toEqual([puuid.zoe, puuid.ali, puuid.nameless]);
      // `mu - 2 * sigma`, times sixty: 25.2 - 10 = 15.2, 22 - 12 = 10, and the seeded silver.
      expect(mine.map((row) => row.proven)).toEqual([912, 600, 200]);
      // And the number people arrive knowing, which is `round(mu * 60)`.
      expect(mine.map((row) => row.rating)).toEqual([1_512, 1_320, 1_200]);
    });

    it('counts the games and the wins the fold recorded, and the run at the front', async () => {
      const board = await loadBoard(anon);
      const zoe = board.rows.find((row) => row.puuid === puuid.zoe);
      const ali = board.rows.find((row) => row.puuid === puuid.ali);

      expect(zoe).toMatchObject({ games: 2, wins: 1, losses: 1, settling: true });
      // Newest game first: Zoe was on the losing side of it, Ali on the winning side.
      expect(zoe?.streak).toEqual({ kind: 'L', length: 1 });
      expect(ali?.streak).toEqual({ kind: 'W', length: 1 });
    });

    it('keeps a seeded player with no games on the board, at the bottom, with `0 games`', async () => {
      const board = await loadBoard(anon);
      const seeded = board.rows.find((row) => row.puuid === puuid.nameless);

      expect(seeded).toMatchObject({ name: null, games: 0, wins: 0, streak: null, settling: true });
    });

    it('renders the nameless row as `Someone`, with the hint once and no puuid', async () => {
      const board = await loadBoard(anon);
      const html = renderToStaticMarkup(createElement(BoardView, { board, viewerPuuid: null }));

      const text = textOf(html);
      expect(text).toContain('Someone');
      // Never as text: the puuid is in the row's href, which is how the page is keyed.
      expect(text).not.toContain(puuid.nameless);
      expect(text.split(NAMELESS_HINT)).toHaveLength(2);
    });
  });

  describe('the player page with the anon key', () => {
    it('is the two numbers, the history in started_at order, and the role record', async () => {
      const player = await loadPlayerBoard(anon, puuid.zoe);

      expect(player).toMatchObject({ name: 'Zoe', rating: 1_512, proven: 912, games: 2, wins: 1 });
      // The rating carried into the first game, then out of each one: oldest first.
      expect(player?.history).toEqual([1_500, 1_536, 1_512]);
      // Lane order, from `lib/laneOrder.ts`, and only roles the scoreboard gave.
      expect(player?.roles.map((record) => record.role)).toEqual(['top', 'mid']);
      expect(player?.roles.map((record) => record.wins)).toEqual([1, 0]);
      // `seedFromRank('GOLD', 'IV')` is mu 23, so the reference line is 1380 — in the series'
      // own units, never the seed's ordinal.
      expect(player?.seed).toBe(1_380);
    });

    it('lists the recent games newest first, with the five of their own side', async () => {
      const player = await loadPlayerBoard(anon, puuid.zoe);

      expect(player?.recent).toHaveLength(2);
      expect(player?.recent[0]?.won).toBe(false);
      expect(player?.recent[1]?.won).toBe(true);
      // Zoe's side only, in lane order, names read from `players_public` by these ids.
      expect(player?.recent[0]?.team.map((seat) => seat.role)).toEqual(['jungle', 'mid']);
      expect(player?.recent[0]?.team.map((seat) => seat.name)).toEqual([null, 'Zoe']);
    });

    it('renders a nameless teammate as `Someone` and never a puuid', async () => {
      const player = await loadPlayerBoard(anon, puuid.zoe);
      const html = renderToStaticMarkup(
        createElement(PlayerView, { player: player as NonNullable<typeof player>, viewerPuuid: null }),
      );

      const text = textOf(html);
      expect(text).toContain('Someone');
      expect(text).not.toContain(puuid.nameless);
      expect(text.split(NAMELESS_HINT)).toHaveLength(2);
      // The delta is computed at render and adds up with the rating beside it: the newest
      // game took Zoe from 25.6 to 25.2, which is 1536 to 1512. One string, so a rating copied
      // off the page reads `1512 (−24)`, and a loss is `dim` at 400, never coloured by sign.
      expect(html).toContain('1512<span class="cn-delta"> (−24)</span>');
    });

    it('is nobody for a puuid the database has never met', async () => {
      expect(await loadPlayerBoard(anon, `it-${runId}-nope`)).toBeNull();
    });

    it('reads names through `players_public`, never the base table', async () => {
      const { error } = await anon.from('players').select('puuid').limit(1);

      expect(error).not.toBeNull();
    });
  });
}
