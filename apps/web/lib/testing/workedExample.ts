import { type BalancePlayer, balance, type Role } from '@customs/core';
import type { PoolMember } from '../ingest/selection';

/**
 * The worked example, as the API sees it (`docs/00-product.md`, "Worked example"; the mu and
 * sigma columns are the M1.4 table in `docs/02-milestones.md`).
 *
 * It is the pinned case for the balancer and it is the pinned case for the Discord embeds,
 * deliberately the same ten friends: a snapshot here is comparable line for line with the
 * layout in `docs/05-design.md`. Nothing is hand-computed — the split and the explanation
 * come from `balance()`, and the result fixture's deltas come from `rateGame()`.
 */

export interface WorkedPlayer {
  name: string;
  mu: number;
  sigma: number;
  mainRole: Role;
  secondaryRole: Role;
}

export const WORKED_ROSTER: readonly WorkedPlayer[] = [
  { name: 'Bilal', mu: 28.55, sigma: 4.8, mainRole: 'adc', secondaryRole: 'mid' },
  { name: 'Hana', mu: 23.9, sigma: 4.6, mainRole: 'top', secondaryRole: 'mid' },
  { name: 'Iris', mu: 26.3, sigma: 4.9, mainRole: 'jungle', secondaryRole: 'top' },
  { name: 'Karim', mu: 25.85, sigma: 4.7, mainRole: 'mid', secondaryRole: 'adc' },
  { name: 'Lena', mu: 34.8, sigma: 4.5, mainRole: 'adc', secondaryRole: 'jungle' },
  { name: 'Nadia', mu: 21.1, sigma: 5.1, mainRole: 'mid', secondaryRole: 'support' },
  { name: 'Omar', mu: 24.49, sigma: 4.6, mainRole: 'top', secondaryRole: 'support' },
  { name: 'Rami', mu: 27.3, sigma: 4.8, mainRole: 'jungle', secondaryRole: 'mid' },
  { name: 'Theo', mu: 23.65, sigma: 4.9, mainRole: 'support', secondaryRole: 'adc' },
  { name: 'Yuki', mu: 18.9, sigma: 5.0, mainRole: 'support', secondaryRole: 'top' },
];

/** `puuid-bilal`. The same ids core's own test uses, so the sort order is alphabetical. */
export function workedPuuid(name: string): string {
  return `puuid-${name.toLowerCase()}`;
}

export function workedBalancePlayers(): BalancePlayer[] {
  return WORKED_ROSTER.map((player) => ({
    puuid: workedPuuid(player.name),
    name: player.name,
    mu: player.mu,
    sigma: player.sigma,
    mainRole: player.mainRole,
    secondaryRole: player.secondaryRole,
    roleOverride: null,
  }));
}

/** The ten as `lobby_members` rows would arrive, ready for `buildTeamsInput`. */
export function workedPool(overrides: Partial<PoolMember> = {}): PoolMember[] {
  return WORKED_ROSTER.map((player, index) => ({
    playerId: `player-${index}`,
    puuid: workedPuuid(player.name),
    name: player.name,
    side: index < 5 ? 100 : 200,
    isSpectator: false,
    mainRole: player.mainRole,
    secondaryRole: player.secondaryRole,
    roleOverride: null,
    mu: player.mu,
    sigma: player.sigma,
    gamesTonight: 0,
    lastSitOutAt: null,
    ...overrides,
  }));
}

/** puuid to display name, the way `loadNames` returns it. */
export function workedNames(): Map<string, string | null> {
  return new Map(WORKED_ROSTER.map((player) => [workedPuuid(player.name), player.name]));
}

/** `balance()` on the ten, with no previous split. Splits 1, 2, 3 and their sentences. */
export function workedBalance(): ReturnType<typeof balance> {
  return balance({ players: workedBalancePlayers(), duos: [], lastSplit: null });
}
