import type { WindowKind } from '../night';

/**
 * `/games` opens on the running week: last night is the question the page exists to answer,
 * and `All time` is one tap away. Same default as the leaderboard, not `/stats`' month.
 */
export const GAMES_WINDOW: WindowKind = 'this-week';
