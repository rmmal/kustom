import { windowRangeLabel } from '../board/window';
import { countedGames } from './fold';
import { funFactsView } from './fun';
import type { FunFactsView } from './types';
import type { StatsInput } from './view';

/**
 * The whole of `/fun`, assembled from the same window read `/stats` makes (M5.24).
 *
 * Pure. `loadFunFacts` reads the rows and calls this; the page renders what comes back.
 */

export function assembleFunFacts(input: StatsInput): FunFactsView {
  const counted = countedGames(input.games);
  const first = counted[0];
  const body = funFactsView(input.games, input.players);

  return {
    window: input.window,
    range:
      counted.length === 0
        ? null
        : windowRangeLabel(
            input.window,
            input.range,
            first === undefined ? null : new Date(first.startedAt),
            input.timeZone,
          ),
    capped: input.capped,
    cap: input.cap,
    ...body,
  };
}
