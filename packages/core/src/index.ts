/**
 * `packages/core` is pure TypeScript: balancer, rating, role model.
 * No network, no database, no `Date.now()` without injection. See CLAUDE.md "Hard rules".
 *
 * M1.3 adds `rating/`, M1.4 adds `balance/`. This file is the only public entry point;
 * everything consumers need is re-exported from here.
 */

/** Team side, matching the League client's own numbering. */
export type Side = 100 | 200;

/** The five positions, in lane order. */
export type Role = 'top' | 'jungle' | 'mid' | 'adc' | 'support';

/** All roles, in lane order. Useful for iteration and for exhaustiveness tests. */
export const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'] as const satisfies readonly Role[];

/** Lobby status. Transitions are owned by the API (see docs/01-architecture.md "Lobby lifecycle"). */
export type LobbyStatus = 'open' | 'balanced' | 'in_game' | 'finished' | 'abandoned';

/** An OpenSkill rating. Balance on `mu`, rank on `ordinal`, display `round(mu * 60)`. */
export interface Rating {
  mu: number;
  sigma: number;
}
