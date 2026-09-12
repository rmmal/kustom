import type { RoleValue } from '@customs/db';
import { MIN_RECORD_GAMES } from './copy';

/**
 * Every word `/fun` says (M5.24). The page and its tests read these strings; a component
 * does not invent a second sentence for the same fact.
 */

/** The nav tab, the heading beside the window's name, the `<title>`. */
export const FUN_LABEL = 'Fun';

export const CS_HEADING = 'CS by role';
export const RECORDS_HEADING = 'One game';
export const HABITS_HEADING = 'The habit';
/** Opens the scoreboard of the counted custom a one-game record came from. */
export const THIS_GAME = 'This game';

export const FIRST_BLOOD_TITLE = 'First Blood Museum';
export const FIRST_BLOOD_INTRO =
  'Who opened the map, on which champion, and which night. The block names the killer, not who died.';
export const FIRST_BLOOD_EMPTY = 'No first blood flag in this window.';
export const FIRST_BLOOD_MOST = 'Most first bloods';
export const FIRST_BLOOD_MOST_RULE = 'Counted games whose stored block named a killer.';

export const DEATH_HALL_TITLE = 'Death Hall of Fame';
export const SHORTEST_LIFE = 'Shortest life';
export const SHORTEST_LIFE_RULE =
  'Shortest time spent living in one counted game they died in. The in-game first-death clock is not stored.';
export const MOST_DEATHS_WINDOW = 'Most deaths';
export const MOST_DEATHS_WINDOW_RULE = 'Deaths summed over counted games in the window.';
export const DEATHLESS_STREAK = 'Longest deathless streak';
export const DEATHLESS_STREAK_RULE = 'Consecutive counted games with zero deaths.';
export const DEATHLESS_GAMES = 'Most games without dying';
export const DEATHLESS_GAMES_RULE = 'Counted games with zero deaths.';

export const THIEF_TITLE = 'Objective Thief';
export const MOST_STEALS = 'Most steals';
export const MOST_STEALS_RULE = 'Objectives stolen in one counted game.';
export const MOST_STEALS_WINDOW = 'Career thief';
export const MOST_STEALS_WINDOW_RULE = 'Objectives stolen, summed over the window.';
export const MOST_DRAGONS = 'Most dragons';
export const MOST_DRAGONS_RULE = 'Dragon kills in one counted game.';
export const MOST_BARONS = 'Most barons';
export const MOST_BARONS_RULE = 'Baron kills in one counted game.';
export const THIEF_EMPTY = 'Nobody stole an objective in this window.';

export const FEAR_BAN_TITLE = 'Fear Ban';
export const FEAR_BAN_INTRO =
  "How often the other side banned someone's champion while they were in the lobby.";
export const FEAR_BAN_EMPTY = 'No draft bans in this window. Blind customs do not ban.';
export const FEAR_BAN_RULE = `Their most-played champion, banned by the other side, in at least ${MIN_RECORD_GAMES} counted games.`;

export function fearBanLine(
  name: string,
  champion: string,
  rate: number,
  banned: number,
  available: number,
): string {
  return `${name}'s ${champion} has been banned in ${rate}% of games where they were available (${banned} of ${available}).`;
}

export function noCsAtRole(role: RoleValue): string {
  return `Nobody has a counted game on ${role} yet.`;
}

export const CS_HIGH_LABEL = 'Highest CS';
export const CS_LOW_LABEL = 'Lowest CS';

export function csValue(cs: number, perMin: number): string {
  return `${cs} CS · ${perMin.toFixed(1)}/min`;
}

export const MOST_KILLS = 'Most kills';
export const MOST_KILLS_RULE = 'One counted game.';
export const MOST_DEATHS = 'Most deaths';
export const MOST_DEATHS_RULE = 'One counted game.';
export const MOST_ASSISTS = 'Most assists';
export const MOST_ASSISTS_RULE = 'One counted game.';
export const CLEAN_KDA = 'Cleanest night';
export const CLEAN_KDA_RULE = 'At least 8 takedowns in one counted game.';
export const ZERO_X = 'The 0/X club';
export const ZERO_X_RULE = 'Zero kills and at least 8 deaths in one counted game.';
export const MOST_DAMAGE = 'Most damage';
export const MOST_DAMAGE_RULE = 'Damage to champions, one counted game.';
export const PAPER = 'Paper champion';
export const PAPER_RULE = 'Lowest damage in a game of 25 minutes or more, not on support.';
export const WON_UGLY = 'Won ugly';
export const WON_UGLY_RULE = 'A win with the worst KDA in the window.';
export const LOST_PRETTY = 'Lost pretty';
export const LOST_PRETTY_RULE = 'A loss with at least 6 takedowns and the best KDA.';
export const RICH_WRONG = 'Rich and wrong';
export const RICH_WRONG_RULE = 'Most gold in a defeat.';
export const LOST_JUNGLE = 'The lost jungle';
export const LOST_JUNGLE_RULE = 'Lowest jungle CS in a game of 25 minutes or more.';
export const GREEDY_SUP = 'Support who farmed';
export const GREEDY_SUP_RULE = 'Highest support CS in one counted game.';
export const FOUNTAIN = 'Fountain resident';
export const FOUNTAIN_RULE = 'Twenty minutes or more, under 30 CS, under 4 takedowns.';
export const GHOST = 'The ghost';
export const GHOST_RULE = 'Lowest kill participation in a lobby with at least 8 team kills.';
export const GLUE = 'Always in the play';
export const GLUE_RULE = 'Highest kill participation in a lobby with at least 5 team kills.';
export const LONGEST = 'Longest custom';
export const LONGEST_RULE = 'The counted game that refused to end.';
export const SHORTEST = 'Shortest scored game';
export const SHORTEST_RULE = 'The shortest counted game in the window.';
export const NEVER_MISSES = 'Never misses';
export const NEVER_MISSES_RULE = 'Most counted games in the window.';
export const COMFORT = 'Comfort blanket';
export const COMFORT_RULE = `Same champion in at least 35% of ${MIN_RECORD_GAMES} or more games.`;

export const NOBODY_THIS = 'Nobody qualifies.';

export function kdaLine(kills: number, deaths: number, assists: number): string {
  return `${kills}/${deaths}/${assists}`;
}

export function kdaRatioLine(ratio: number, kills: number, deaths: number, assists: number): string {
  return `${ratio.toFixed(2)} KDA · ${kills}/${deaths}/${assists}`;
}

export function damageLine(damage: number): string {
  return `${Math.round(damage).toLocaleString()} damage`;
}

export function goldLine(gold: number): string {
  return `${Math.round(gold).toLocaleString()} gold`;
}

export function csCountLine(cs: number): string {
  return `${cs} CS`;
}

export function kpLine(percent: number): string {
  return `${percent}% KP`;
}

export function minutesLine(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

export function gamesCountLine(games: number): string {
  return games === 1 ? '1 custom' : `${games} customs`;
}

export function comfortLine(gamesOnChamp: number, games: number): string {
  return `${Math.round((gamesOnChamp / games) * 100)}% of ${games} games`;
}

export function matchDetail(startedAt: string, durationS: number): string {
  const day = new Date(startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${day} · ${minutesLine(durationS)}`;
}
