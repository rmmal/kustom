import { type ResolvedRoles, type RoleProfile, resolveRoles } from '@customs/core';

/**
 * Tonight's roles for one member of the lobby, as the rack prints them (M3.6).
 *
 * A role tap writes `lobby_members.role_override`, and core turns that into the player's main
 * with their usual main demoted to backup. The rack shows the same pair the balancer will use,
 * or the page would say `top · mid` beside a row whose owner has just tapped `jungle` and whose
 * teams the bot is about to build around jungle.
 *
 * **Core decides and this is the call**, not a copy of the rule: `resolveRoles` is
 * `@customs/core`'s own function (exported for this on 2026-09-10), so an override that ever
 * came to mean something else would mean it here on the same day. `MemberView` carries exactly
 * `RoleProfile`'s three fields, so there is nothing to map.
 */
export function tonightRoles(member: RoleProfile): ResolvedRoles {
  return resolveRoles(member);
}

/** Does anybody on screen have a role at all? Decides whether the rack draws its role column. */
export function anyRoleShown(members: readonly RoleProfile[]): boolean {
  return members.some((member) => resolveRoles(member).main !== null);
}
