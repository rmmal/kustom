import type { LobbyBalancedEvent, LobbyHook } from '../ingest/hooks';
import { registerLobbyHook } from '../ingest/hooks';
import { getServiceClient } from '../supabase';
import { queueSwitchSideForBalance } from './switchSide';

/**
 * Where the command queue is plugged into ingest (M4.1), and the only file in `lib/commands`
 * that knows the lobby state machine exists.
 *
 * Same seam and same rule as `lib/ingest/discord.ts`: `lobby.ts` announces that a lobby
 * balanced and never imports a queue writer; importing *this* module is what makes anybody
 * listen. The companion lobby route does it. With this import removed, every M2.5 acceptance
 * check still passes and nothing is queued — which is the property the seam exists to protect.
 *
 * The other direction (a lobby *leaving* `balanced` supersedes what it queued) is not a hook:
 * it is in `moveLobby` itself, because there is exactly one function that moves a lobby and a
 * superseded command is part of the move, not a reaction to it.
 */
export const commandLobbyHook: LobbyHook = {
  onBalanced: async (event: LobbyBalancedEvent): Promise<void> => {
    // `getServiceClient` reads the environment when it is called, never at import, so this
    // module can be imported by a build that has no Supabase keys.
    await queueSwitchSideForBalance(getServiceClient(), event);
  },
};

/** Idempotent: `registerLobbyHook` deduplicates on the object, and there is one object. */
export function registerCommandLobbyHooks(): void {
  registerLobbyHook(commandLobbyHook);
}

registerCommandLobbyHooks();
