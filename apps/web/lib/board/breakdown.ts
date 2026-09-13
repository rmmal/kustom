import type { SideValue } from '@customs/db';
import { formatDayMonth } from '../night';
import type { BoardGame } from './types';

/**
 * One rated game as the board's expand needs it, before the date is formatted.
 *
 * The two mu values travel unrounded: the row turns them into `1512 (+43)` at render, the same
 * way every other delta in this product does (`-0` does not survive a `JSON.stringify`).
 */
export interface BoardGameInput {
  gameId: string;
  startedAt: string;
  durationS: number;
  won: boolean;
  side: SideValue;
  muBefore: number;
  muAfter: number;
}

/**
 * The window's rated games, newest first, with the date the page will print.
 *
 * Newest first because that is how `/p/[puuid]`'s recent list and `/games` already read: the
 * last thing that moved the number is the first thing a friend looks for. The date is formatted
 * here, on the server, so `BoardRow` can render on the tonight rail without reading the zone.
 */
export function boardBreakdown(games: readonly BoardGameInput[], timeZone: string): BoardGame[] {
  return [...games]
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .map((game) => ({
      gameId: game.gameId,
      startedLabel: formatDayMonth(new Date(game.startedAt), timeZone),
      durationS: game.durationS,
      won: game.won,
      side: game.side,
      muBefore: game.muBefore,
      muAfter: game.muAfter,
    }));
}
