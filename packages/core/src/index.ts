/**
 * `packages/core` is pure TypeScript: balancer, rating, role model.
 * No network, no database, no `Date.now()` without injection. See CLAUDE.md "Hard rules".
 *
 * This file is the only public entry point; everything consumers need is re-exported from
 * here. `rating/` landed in M1.3, `balance/` in M1.4.
 */

export {
  type Assignment,
  BalanceError,
  type BalanceInput,
  type BalancePlayer,
  type BalanceResult,
  balance,
  type Duo,
  explain,
  nextSplit,
  type Split,
} from './balance/index';

export { type Config, config, type RankDivision, type RankTier } from './config';
export { displayRating, ordinal, predictWin, rateGame, seedFromRank } from './rating/index';
export { type LobbyStatus, type Rating, ROLES, type Role, type Side } from './types';
