/**
 * Role inference (M5.16): a player's main and backup, read off their own games instead of a
 * form. Spec: the M5.16 brief in docs/02-milestones.md and docs/01-architecture.md "Role
 * inference".
 *
 * Pure and total. No clock: `startedAt` is data the caller stored, and an ISO-8601 string is
 * parsed with `Date.parse`, which is deterministic for that format. Same games in any order
 * give the same answer, because the function orders them by `startedAt` itself.
 */

import { config } from '../config';
import { ROLES, type Role } from '../types';

/** One of the player's games, as `game_players` stores it. */
export interface RoleGame {
  /** The position the client detected. `null` (a backfilled game before M5.18) is skipped. */
  role: Role | null;
  /** `games.started_at`: epoch milliseconds, or the ISO-8601 string the database hands over. */
  startedAt: string | number;
  /**
   * The feedback-loop guard, written at fold time (M5.17): `true` when the balancer put the
   * player on their then-main or backup, or when we did not balance the game at all
   * (backfill). A game where they were filled is a thing that happened *to* them and never
   * changes who they are.
   */
  countsForInference: boolean;
}

/** The answer the balancer reads as `mainRole` / `secondaryRole`, plus what it rests on. */
export interface InferredRoles {
  /** `null` is flexible: fewer than `config.roles.minGames` counted games. */
  main: Role | null;
  /** `null` when there is no second role in the window. Never invented. */
  secondary: Role | null;
  /** How many games the answer rests on, so the admin page can print it. */
  counted: number;
}

/**
 * Main = the most frequent role over the player's last `window` games that count
 * (`countsForInference` and a non-null `role`), backup = the second most frequent. A tie
 * goes to the role whose most recent game is later; two roles whose newest games share a
 * timestamp fall to lane order. Under `config.roles.minGames` counted games the player is
 * flexible: `{ main: null, secondary: null }`, with `counted` still reported.
 */
export function inferRoles(
  games: readonly RoleGame[],
  window: number = config.roles.inferenceWindow,
): InferredRoles {
  const size = Number.isFinite(window) && window > 0 ? Math.floor(window) : 0;

  const counted = games
    .filter((game): game is RoleGame & { role: Role } => game.countsForInference && game.role !== null)
    .map((game, index) => ({ role: game.role, at: toMillis(game.startedAt), index }))
    // Newest first. Equal instants keep the caller's order; the tie-break below never reads it.
    .sort((a, b) => b.at - a.at || a.index - b.index)
    .slice(0, size);

  if (counted.length < config.roles.minGames) {
    return { main: null, secondary: null, counted: counted.length };
  }

  const tally = new Map<Role, { count: number; newest: number }>();
  for (const { role, at } of counted) {
    const entry = tally.get(role);
    if (entry) {
      entry.count += 1;
      // `counted` is newest first, so the first sighting is the newest; nothing to update.
    } else {
      tally.set(role, { count: 1, newest: at });
    }
  }

  const ranked = [...tally.entries()].sort(
    ([roleA, a], [roleB, b]) =>
      b.count - a.count || b.newest - a.newest || ROLES.indexOf(roleA) - ROLES.indexOf(roleB),
  );

  return {
    main: ranked[0]?.[0] ?? null,
    secondary: ranked[1]?.[0] ?? null,
    counted: counted.length,
  };
}

/** An unparseable string sorts as the oldest thing there is, so bad data can never claim "now". */
function toMillis(startedAt: string | number): number {
  const millis = typeof startedAt === 'number' ? startedAt : Date.parse(startedAt);
  return Number.isNaN(millis) ? Number.NEGATIVE_INFINITY : millis;
}
