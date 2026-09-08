/**
 * The M2.1 hooks: they only log. M2.2 (lobby watcher), M2.3 (game capture) and M2.4 (rank sync) replace
 * them one by one; the shape of `CompanionHooks` is the seam. Nothing here posts to the API or writes to
 * the client.
 *
 * Log fields are chosen so a line is useful and safe: party ids, puuids, member counts, game ids, phases.
 * Never a lobby password, never chat credentials (the block and the lobby both carry them).
 */

import type { CompanionHooks } from './connection.js';
import type { CompanionLogger } from './log.js';

export function loggingHooks(logger: CompanionLogger): CompanionHooks {
  const log = logger.child({ component: 'hooks' });
  return {
    onConnected(context) {
      log.info('local player', {
        puuid: context.summoner?.puuid ?? null,
        summonerId: context.summoner?.summonerId ?? null,
        phase: context.phase,
      });
    },
    onLobbyEvent(event) {
      if (event.lobby === null) {
        log.info('lobby event', { eventType: event.eventType, lobby: null });
        return;
      }
      const { lobby } = event;
      log.info('lobby event', {
        eventType: event.eventType,
        partyId: lobby.partyId,
        members: lobby.members.length,
        blue: lobby.gameConfig.customTeam100.length,
        red: lobby.gameConfig.customTeam200.length,
        spectators: lobby.gameConfig.customSpectators?.length ?? 0,
        isCustom: lobby.gameConfig.isCustom,
      });
    },
    onGameflowPhase(phase) {
      log.info('gameflow phase', { phase });
    },
    onEogBlock(event) {
      if (event.block === null) {
        log.info('end-of-game block removed', { eventType: event.eventType });
        return;
      }
      const { block } = event;
      log.info('end-of-game block', {
        eventType: event.eventType,
        gameId: block.gameId,
        gameType: block.gameType,
        gameLength: block.gameLength,
        winningTeam: block.teams.find((team) => team.isWinningTeam)?.teamId ?? null,
        players: block.teams.reduce((count, team) => count + team.players.length, 0),
      });
    },
    onDisconnected(reason) {
      log.info('disconnected from the League client', { reason });
    },
  };
}
