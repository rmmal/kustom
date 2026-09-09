import type { RoleValue, SideValue } from '@customs/db';
import type { PlayerName } from '../tonight/types';
import type { Streak } from './streak';

/**
 * What `/leaderboard` and `/p/[puuid]` know (M3.5). Loaded on the server with the anon key and
 * rendered there; nothing on either page is a client component and nothing here crosses the
 * wire to a browser.
 *
 * **Numbers are display numbers, deltas are not.** `proven` and `rating` are what the shared
 * helpers in `lib/ratingDisplay.ts` computed, because the board must print the same integers
 * the embeds print. A rating *change* is carried as the two mu values it comes from and turned
 * into a delta where it is rendered: `-0` is a real value and does not survive `JSON.stringify`
 * (`05-design.md`, "Rating delta").
 */

export interface SeasonView {
  id: string;
  name: string;
}

/** One row of the board. `05-design.md`, "Leaderboard row", is the layout for exactly this. */
export interface BoardRow {
  puuid: string;
  /** `null` for a player the database has no name for yet: rendered `Someone` (M3.10). */
  name: PlayerName;
  /** `round(ordinal * 60)`, floored at zero. The primary number a reader sees. */
  proven: number;
  /**
   * The raw `ordinal` (`mu - 2σ`) this row is ordered by. **Never printed.**
   *
   * `proven` is floored at zero, so everybody the board has not seen play yet displays `0`;
   * ordering on the displayed number would drop those rows onto the name tie-break and shuffle
   * them. The floor is monotonic, so ordering on this keeps the displayed column
   * non-increasing anyway.
   */
  sortKey: number;
  /** `round(mu * 60)`. The number the embeds print beside a name. */
  rating: number;
  games: number;
  wins: number;
  losses: number;
  /** `null` for a player with no rated games this season. */
  streak: Streak | null;
  /** Fewer than 30 recorded games (M3.8). */
  settling: boolean;
}

export interface BoardView {
  /** `null` when no season is active: the page says so and lists nobody. */
  season: SeasonView | null;
  /** Ordered by `proven` descending. Reading the primary column top to bottom never goes up. */
  rows: BoardRow[];
}

/** One of the player's own five in a recent game, in lane order. */
export interface RecentTeammate {
  puuid: string;
  name: PlayerName;
  role: RoleValue | null;
}

export interface RecentGame {
  gameId: string;
  /** ISO 8601. The list is newest first; nothing on the page draws a date axis. */
  startedAt: string;
  durationS: number;
  won: boolean;
  side: SideValue;
  /** The player's own role in this game, from the scoreboard. */
  role: RoleValue | null;
  /** The two mu values the delta is computed from, at render. Never a formatted delta. */
  muBefore: number | null;
  muAfter: number | null;
  /** The five on the player's own side, lane order, this player among them. */
  team: RecentTeammate[];
}

export interface RoleRecord {
  role: RoleValue;
  games: number;
  wins: number;
  losses: number;
}

/**
 * `/p/[puuid]` has **two shapes, not one shape with zeros in it** (M3.5 review, 2026-09-09).
 *
 * Ratings are per season. With no active season there is no rating, no Proven, no history and
 * no games — not `0` of any of them — and the first cut of this type said `rating: number` and
 * filled it with zeros, so the page printed `Rating 0 · Proven 0 · settling` above a sentence
 * saying there was no board. Zero is a number the model never produced.
 *
 * So the shape is a discriminated union and the numbers live only on the arm that has a season.
 * The view cannot print a rating for a player who has none, because there is no field to print.
 */
export type PlayerBoardView = PlayerSeasonView | PlayerNoSeasonView;

/** Who the page is about. Both arms carry it, and it is all the no-season arm carries. */
interface PlayerIdentity {
  puuid: string;
  name: PlayerName;
}

/** A season is active: the two numbers, the `Rating` history, the record, the last few games. */
export interface PlayerSeasonView extends PlayerIdentity {
  kind: 'season';
  season: SeasonView;
  /** `round(mu * 60)`, the number the chart plots and line 2 of the board names. */
  rating: number;
  /** `round(ordinal * 60)`, beside it, under the same label the board uses. */
  proven: number;
  games: number;
  wins: number;
  losses: number;
  settling: boolean;
  /** `round(seedMu * 60)`: the chart's reference line, in the series' own units. */
  seed: number;
  /** The `Rating` series in `started_at` order, oldest first. Empty for no games. */
  history: number[];
  /** Lane order, and only roles the scoreboard actually gave them. */
  roles: RoleRecord[];
  recent: RecentGame[];
}

/**
 * No season is active. The page is the player's name and one sentence, and nothing else
 * (product, 2026-09-09): no numbers, no chip, no chart, no record, no games.
 */
export interface PlayerNoSeasonView extends PlayerIdentity {
  kind: 'no-season';
}
