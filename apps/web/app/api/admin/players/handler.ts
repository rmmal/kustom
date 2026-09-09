import type { NextResponse } from 'next/server';
import {
  setPlayerAdmin,
  setPlayerBackfill,
  setPlayerDiscordId,
  setPlayerDisplayName,
  setPlayerRoles,
} from '@/lib/admin/players';
import type { AdminWriteResult } from '@/lib/admin/result';
import type { AdminContext } from '@/lib/adminRoute';
import { type AdminPlayersRequest, adminPlayersResponseSchema } from './schema';

/**
 * Separate from `route.ts` because a Next route file may only export HTTP verbs, and the
 * integration tests need the handler with a fake session wrapped around it (there is no way to
 * drive a real Discord OAuth flow from vitest).
 */
export async function handleAdminPlayers(
  input: AdminPlayersRequest,
  context: AdminContext,
): Promise<NextResponse> {
  const result = await runAction(input, context);
  if (!result.ok) return context.fail(result.status, result.error);

  return context.respond(
    adminPlayersResponseSchema,
    { ok: true, action: input.action, playerId: result.value },
    noticeFor(input),
  );
}

function runAction(input: AdminPlayersRequest, context: AdminContext): Promise<AdminWriteResult<string>> {
  switch (input.action) {
    case 'set-roles':
      return setPlayerRoles(context.client, {
        playerId: input.playerId,
        mainRole: input.mainRole,
        secondaryRole: input.secondaryRole,
      });
    case 'set-name':
      return setPlayerDisplayName(context.client, {
        playerId: input.playerId,
        displayName: input.displayName,
      });
    case 'set-discord':
      return setPlayerDiscordId(context.client, {
        playerId: input.playerId,
        discordId: input.discordId,
      });
    case 'set-admin':
      // The acting player comes from the session, never from the body: that is what makes the
      // "you cannot demote yourself" rule mean anything.
      return setPlayerAdmin(context.client, {
        playerId: input.playerId,
        isAdmin: input.isAdmin,
        actingPlayerId: context.admin.playerId,
      });
    case 'set-backfill':
      // No self-rule here, unlike `set-admin`: approving your own companion is the ordinary
      // case (M5.1's live check is the user approving themselves), and revoking backfill locks
      // nobody out of anything.
      return setPlayerBackfill(context.client, {
        playerId: input.playerId,
        approved: input.approved,
      });
  }
}

function noticeFor(input: AdminPlayersRequest): string {
  switch (input.action) {
    case 'set-roles':
      return `roles saved: ${input.mainRole ?? 'flexible'} / ${input.secondaryRole ?? 'none'}`;
    case 'set-name':
      // Both halves matter to the admin: what the name is now, and whether the client may
      // still move it. "back on automatic" is the only way to tell a cleared field worked.
      return input.displayName === null
        ? 'name cleared: it follows the Riot ID again'
        : `name saved: ${input.displayName}`;
    case 'set-discord':
      return input.discordId === null ? 'Discord id cleared' : 'Discord id linked';
    case 'set-admin':
      return input.isAdmin ? 'admin granted' : 'admin removed';
    case 'set-backfill':
      // The second sentence is the whole reason M5.1 and M5.2 ship together: an admin who
      // approves someone and then looks at the leaderboard must not think backfill is broken.
      return input.approved
        ? 'backfill allowed. Backfilled games are not rated until the ratings are rebuilt.'
        : 'backfill revoked';
  }
}
