import type { Role } from '@customs/core';

/**
 * Lane order, in one place: `top, jungle, mid, adc, support`.
 *
 * Every list of five is printed in it — the teams embed, the result embed, the tonight page's
 * team cards and its result card — so "my row" is in the same place in all four. A player the
 * scoreboard has no role for is printed without one and sorts **after** the five who have one,
 * so the known rows never move to make room.
 *
 * It lives here rather than in `lib/discord/embeds.ts` because it is not Discord's: the page
 * needs the same order for the same reason, and a second copy is how two surfaces end up
 * disagreeing about where the jungler goes.
 */
export const LANE_ORDER: readonly Role[] = ['top', 'jungle', 'mid', 'adc', 'support'];

export function inLaneOrder<T extends { role: Role | null; puuid: string }>(players: readonly T[]): T[] {
  return [...players].sort((a, b) => {
    const rankA = a.role === null ? LANE_ORDER.length : LANE_ORDER.indexOf(a.role);
    const rankB = b.role === null ? LANE_ORDER.length : LANE_ORDER.indexOf(b.role);
    if (rankA !== rankB) return rankA - rankB;
    // Two rows the order cannot separate keep a stable answer rather than the query's.
    return a.puuid < b.puuid ? -1 : a.puuid > b.puuid ? 1 : 0;
  });
}
