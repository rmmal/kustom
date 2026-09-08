/**
 * The role rules, in one place, so the scorer and the explanation cannot disagree about who
 * is off-role. Spec: M1.4 brief, "Role edge cases".
 */

import type { Role } from '../types';
import type { BalancePlayer } from './types';

export type RoleTier = 'main' | 'secondary' | 'fill';

/**
 * Tonight's main and backup for a player:
 * - `roleOverride` becomes the main; the usual main becomes the secondary; the declared
 *   secondary drops to fill. An override equal to the usual main is a no-op.
 * - A `null` main (after the override rule) is flexible: every role is a main.
 */
export function resolveRoles(player: Pick<BalancePlayer, 'mainRole' | 'secondaryRole' | 'roleOverride'>): {
  main: Role | null;
  secondary: Role | null;
} {
  const override = player.roleOverride ?? null;
  if (override !== null && override !== player.mainRole) {
    return { main: override, secondary: player.mainRole };
  }
  return { main: player.mainRole, secondary: player.secondaryRole };
}

/** Which multiplier a role earns for a player. `main` is never off-role; the others are. */
export function roleTier(
  player: Pick<BalancePlayer, 'mainRole' | 'secondaryRole' | 'roleOverride'>,
  role: Role,
): RoleTier {
  const { main, secondary } = resolveRoles(player);
  if (main === null || role === main) return 'main';
  if (role === secondary) return 'secondary';
  return 'fill';
}

export function isOffRole(
  player: Pick<BalancePlayer, 'mainRole' | 'secondaryRole' | 'roleOverride'>,
  role: Role,
): boolean {
  return roleTier(player, role) !== 'main';
}
