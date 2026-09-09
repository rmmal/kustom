/** Shared domain types. Kept in one leaf module so `rating/` and `balance/` never import each other. */

/** Team side, matching the League client's own numbering. */
export type Side = 100 | 200;

/** The five positions, in lane order. */
export type Role = 'top' | 'jungle' | 'mid' | 'adc' | 'support';

/** All roles, in lane order. Useful for iteration and for exhaustiveness tests. */
export const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'] as const satisfies readonly Role[];

/**
 * Lobby status, in lifecycle order. Transitions are owned by the API (see
 * docs/01-architecture.md "Lobby lifecycle").
 *
 * `dropped` (M5.11) is a lobby that reached `in_game` and never got a result: its roster
 * stays frozen, it is out of the live set so the party's next post starts a clean cycle, and
 * it is not `abandoned`, which means "dissolved before it ever started".
 */
export type LobbyStatus = 'open' | 'balanced' | 'in_game' | 'dropped' | 'finished' | 'abandoned';

/** An OpenSkill rating. Balance on `mu`, rank on `ordinal`, display `round(mu * 60)`. */
export interface Rating {
  mu: number;
  sigma: number;
}
