import { NAMELESS_PLAYER } from '../discord/embeds';

export function mysteryPlayerName(row: { display_name?: string | null; game_name?: string | null }): string {
  const display = row.display_name?.trim() ?? '';
  if (display.length > 0) return display;
  const game = row.game_name?.trim() ?? '';
  if (game.length > 0) return game;
  return NAMELESS_PLAYER;
}
