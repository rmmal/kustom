import { isOffRole, ROLES } from '@customs/core';
import type { RoleValue } from '@customs/db';

/**
 * Tonight's roles for one member of the lobby, as the rack prints them (M3.6).
 *
 * A role tap writes `lobby_members.role_override`, and core turns that into the player's main
 * with their usual main demoted to backup (`resolveRoles`). The rack has to show the same
 * thing, or the page would say `top · mid` beside a row whose owner has just tapped `jungle`
 * and whose teams the bot is about to build around jungle.
 *
 * **Core decides, this file only asks.** `resolveRoles` is not exported from `@customs/core`
 * (its public surface is `balance`, `explain`, `isOffRole`, `nextSplit` and the rating
 * helpers), so the resolved main is read out of the one predicate that is: the main is the
 * single role core does not call off-role. That is a question about core's rule rather than a
 * copy of it, and it cannot drift — if core ever changed what an override means, this answer
 * would change with it.
 *
 * The backup is not asked for, because it cannot be: `isOffRole` is true for a secondary and
 * for a fill alike. A row with an override therefore prints **the override alone**, which is
 * also the honest thing to show — it is what the player chose and what the bot will try first.
 * Exporting `resolveRoles` would let the row print `jungle · top`; that is a change to
 * `packages/core` and is left to the lead (M3.6, reported under OPEN).
 */
export function tonightRoles(member: {
  mainRole: RoleValue | null;
  secondaryRole: RoleValue | null;
  roleOverride: RoleValue | null;
}): { main: RoleValue | null; secondary: RoleValue | null } {
  // No override, or one that names the role they already main — core treats that as a no-op —
  // and the row is the profile's own pair.
  if (member.roleOverride === null || member.roleOverride === member.mainRole) {
    return { main: member.mainRole, secondary: member.secondaryRole };
  }

  return { main: ROLES.find((role) => !isOffRole(member, role)) ?? null, secondary: null };
}

/** Does anybody on screen have a role at all? Decides whether the rack draws its role column. */
export function anyRoleShown(
  members: readonly {
    mainRole: RoleValue | null;
    secondaryRole: RoleValue | null;
    roleOverride: RoleValue | null;
  }[],
): boolean {
  return members.some((member) => tonightRoles(member).main !== null);
}
