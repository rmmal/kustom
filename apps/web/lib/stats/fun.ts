import { LANE_ORDER } from '../laneOrder';
import { renderWebName } from '../tonight/copy';
import { MIN_RECORD_GAMES } from './copy';
import { countedGames } from './fold';
import {
  CLEAN_KDA,
  CLEAN_KDA_RULE,
  COMFORT,
  COMFORT_RULE,
  comfortLine,
  csCountLine,
  csValue,
  damageLine,
  FIRST_BLOOD_EMPTY,
  FIRST_BLOOD_INTRO,
  FIRST_BLOOD_NOTE,
  FIRST_BLOOD_TITLE,
  FOUNTAIN,
  FOUNTAIN_RULE,
  GHOST,
  GHOST_RULE,
  GLUE,
  GLUE_RULE,
  GREEDY_SUP,
  GREEDY_SUP_RULE,
  goldLine,
  kdaLine,
  kdaRatioLine,
  kpLine,
  LONGEST,
  LONGEST_RULE,
  LOST_JUNGLE,
  LOST_JUNGLE_RULE,
  LOST_PRETTY,
  LOST_PRETTY_RULE,
  MOST_ASSISTS,
  MOST_ASSISTS_RULE,
  MOST_DAMAGE,
  MOST_DAMAGE_RULE,
  MOST_DEATHS,
  MOST_DEATHS_RULE,
  MOST_KILLS,
  MOST_KILLS_RULE,
  matchDetail,
  minutesLine,
  NEVER_MISSES,
  NEVER_MISSES_RULE,
  NOBODY_THIS,
  PAPER,
  PAPER_RULE,
  RICH_WRONG,
  RICH_WRONG_RULE,
  SHORTEST,
  SHORTEST_RULE,
  VISION_NOTE,
  WON_UGLY,
  WON_UGLY_RULE,
  ZERO_X,
  ZERO_X_RULE,
} from './funCopy';
import type {
  FunFactsView,
  FunHolder,
  FunRecord,
  PlayerRef,
  RoleCsPair,
  StatsGame,
  StatsPlayer,
  StatsRow,
} from './types';

/**
 * `/fun` (M5.24): single-game records from the scoreboard columns `/stats` does not fold.
 *
 * Pure. The universe is `countedGames` — the same `gateGame` `/stats` uses — so a remake that
 * is not a game on the board is not a record here either.
 *
 * First blood and vision are named in {@link notes} and nowhere else: the companion already
 * sees both, and we do not store them. Crowning either from a guess would be a second truth.
 */

const LONG_GAME_S = 25 * 60;
const FOUNTAIN_GAME_S = 20 * 60;
const CLEAN_TAKEDOWNS = 8;
const ZERO_X_DEATHS = 8;
const PRETTY_TAKEDOWNS = 6;
const GHOST_TEAM_KILLS = 8;
const GLUE_TEAM_KILLS = 5;
const FOUNTAIN_CS = 30;
const FOUNTAIN_TAKEDOWNS = 4;
const COMFORT_RATE = 0.35;

interface Play {
  game: StatsGame;
  row: StatsRow;
  player: StatsPlayer;
}

function minutes(game: StatsGame): number {
  return Math.max(1, game.durationS / 60);
}

function kda(row: StatsRow): number {
  return (row.kills + row.assists) / Math.max(1, row.deaths);
}

function takedowns(row: StatsRow): number {
  return row.kills + row.assists;
}

function teamKills(game: StatsGame, side: StatsRow['side']): number {
  return game.rows.filter((row) => row.side === side).reduce((sum, row) => sum + row.kills, 0);
}

function kp(row: StatsRow, game: StatsGame): number {
  return takedowns(row) / Math.max(1, teamKills(game, row.side));
}

function won(row: StatsRow, game: StatsGame): boolean {
  return row.side === game.winningSide;
}

function playsOf(games: readonly StatsGame[], players: readonly StatsPlayer[]): Play[] {
  const roster = new Map(players.map((player) => [player.playerId, player]));
  const out: Play[] = [];
  for (const game of games) {
    for (const row of game.rows) {
      const player = roster.get(row.playerId);
      if (player === undefined) continue;
      out.push({ game, row, player });
    }
  }
  return out;
}

function ref(player: StatsPlayer): PlayerRef {
  return { puuid: player.puuid, name: player.name };
}

function holder(player: StatsPlayer, valueLabel: string, game: StatsGame | null = null): FunHolder {
  return {
    ...ref(player),
    valueLabel,
    detail: game === null ? null : matchDetail(game.startedAt, game.durationS),
  };
}

function pickMax(plays: readonly Play[], score: (play: Play) => number): Play | null {
  let best: Play | null = null;
  let bestScore = -Infinity;
  for (const play of plays) {
    const value = score(play);
    if (value > bestScore) {
      best = play;
      bestScore = value;
    }
  }
  return best;
}

function pickMin(plays: readonly Play[], score: (play: Play) => number): Play | null {
  let best: Play | null = null;
  let bestScore = Infinity;
  for (const play of plays) {
    const value = score(play);
    if (value < bestScore) {
      best = play;
      bestScore = value;
    }
  }
  return best;
}

function record(
  id: string,
  title: string,
  rule: string,
  play: Play | null,
  valueLabel: (play: Play) => string,
): FunRecord {
  return {
    id,
    title,
    rule,
    holders: play === null ? [] : [holder(play.player, valueLabel(play), play.game)],
    empty: NOBODY_THIS,
  };
}

function csByRole(plays: readonly Play[]): RoleCsPair[] {
  return LANE_ORDER.map((role) => {
    const atRole = plays.filter((play) => play.row.role === role);
    const highest = pickMax(atRole, (play) => play.row.cs);
    const lowest = pickMin(atRole, (play) => play.row.cs);
    const label = (play: Play) => csValue(play.row.cs, play.row.cs / minutes(play.game));
    return {
      role,
      highest: highest === null ? null : holder(highest.player, label(highest), highest.game),
      lowest: lowest === null ? null : holder(lowest.player, label(lowest), lowest.game),
    };
  });
}

function comfortRecord(plays: readonly Play[]): FunRecord {
  const byPlayer = new Map<string, { player: StatsPlayer; games: number; champs: Map<number, number> }>();
  for (const play of plays) {
    if (play.row.championId === null) continue;
    const row = byPlayer.get(play.player.playerId) ?? {
      player: play.player,
      games: 0,
      champs: new Map<number, number>(),
    };
    row.games += 1;
    row.champs.set(play.row.championId, (row.champs.get(play.row.championId) ?? 0) + 1);
    byPlayer.set(play.player.playerId, row);
  }

  const otp = [...byPlayer.values()]
    .filter((row) => row.games >= MIN_RECORD_GAMES)
    .map((row) => {
      const [championId, count] = [...row.champs.entries()].sort((a, b) => b[1] - a[1])[0] ?? [0, 0];
      return { ...row, championId, count, rate: count / row.games };
    })
    .sort(
      (a, b) =>
        b.rate - a.rate ||
        b.games - a.games ||
        renderWebName(a.player.name).localeCompare(renderWebName(b.player.name)),
    )[0];

  if (otp === undefined || otp.rate < COMFORT_RATE) {
    return { id: 'comfort', title: COMFORT, rule: COMFORT_RULE, holders: [], empty: NOBODY_THIS };
  }

  return {
    id: 'comfort',
    title: COMFORT,
    rule: COMFORT_RULE,
    holders: [holder(otp.player, comfortLine(otp.count, otp.games))],
    empty: NOBODY_THIS,
  };
}

function attendanceRecord(plays: readonly Play[]): FunRecord {
  const counts = new Map<string, { player: StatsPlayer; games: number }>();
  for (const play of plays) {
    const row = counts.get(play.player.playerId) ?? { player: play.player, games: 0 };
    row.games += 1;
    counts.set(play.player.playerId, row);
  }
  const top = [...counts.values()].sort(
    (a, b) => b.games - a.games || renderWebName(a.player.name).localeCompare(renderWebName(b.player.name)),
  )[0];
  if (top === undefined) {
    return {
      id: 'attendance',
      title: NEVER_MISSES,
      rule: NEVER_MISSES_RULE,
      holders: [],
      empty: NOBODY_THIS,
    };
  }
  return {
    id: 'attendance',
    title: NEVER_MISSES,
    rule: NEVER_MISSES_RULE,
    holders: [holder(top.player, gamesCountLineFrom(top.games))],
    empty: NOBODY_THIS,
  };
}

function gamesCountLineFrom(games: number): string {
  return games === 1 ? '1 custom' : `${games} customs`;
}

/**
 * The page's answer, over counted games only.
 *
 * `games` is already the window's list; this applies the gate once and reads that list.
 */
export function funFactsView(
  games: readonly StatsGame[],
  players: readonly StatsPlayer[],
): Omit<FunFactsView, 'window' | 'range' | 'capped' | 'cap'> {
  const counted = countedGames(games);
  const plays = playsOf(counted, players);
  const long = plays.filter((play) => play.game.durationS >= LONG_GAME_S);

  const records: FunRecord[] = [
    record(
      'kills',
      MOST_KILLS,
      MOST_KILLS_RULE,
      pickMax(plays, (play) => play.row.kills),
      (play) => kdaLine(play.row.kills, play.row.deaths, play.row.assists),
    ),
    record(
      'deaths',
      MOST_DEATHS,
      MOST_DEATHS_RULE,
      pickMax(plays, (play) => play.row.deaths),
      (play) => kdaLine(play.row.kills, play.row.deaths, play.row.assists),
    ),
    record(
      'assists',
      MOST_ASSISTS,
      MOST_ASSISTS_RULE,
      pickMax(plays, (play) => play.row.assists),
      (play) => kdaLine(play.row.kills, play.row.deaths, play.row.assists),
    ),
    record(
      'clean',
      CLEAN_KDA,
      CLEAN_KDA_RULE,
      pickMax(
        plays.filter((play) => takedowns(play.row) >= CLEAN_TAKEDOWNS),
        (play) => kda(play.row),
      ),
      (play) => kdaRatioLine(kda(play.row), play.row.kills, play.row.deaths, play.row.assists),
    ),
    record(
      'zero-x',
      ZERO_X,
      ZERO_X_RULE,
      pickMax(
        plays.filter((play) => play.row.kills === 0 && play.row.deaths >= ZERO_X_DEATHS),
        (play) => play.row.deaths,
      ),
      (play) => kdaLine(play.row.kills, play.row.deaths, play.row.assists),
    ),
    record(
      'damage',
      MOST_DAMAGE,
      MOST_DAMAGE_RULE,
      pickMax(plays, (play) => play.row.damageToChamps),
      (play) => damageLine(play.row.damageToChamps),
    ),
    record(
      'paper',
      PAPER,
      PAPER_RULE,
      pickMin(
        long.filter((play) => play.row.role !== 'support'),
        (play) => play.row.damageToChamps,
      ),
      (play) => damageLine(play.row.damageToChamps),
    ),
    record(
      'won-ugly',
      WON_UGLY,
      WON_UGLY_RULE,
      pickMin(
        plays.filter((play) => won(play.row, play.game)),
        (play) => kda(play.row),
      ),
      (play) => `${kdaLine(play.row.kills, play.row.deaths, play.row.assists)} · still a win`,
    ),
    record(
      'lost-pretty',
      LOST_PRETTY,
      LOST_PRETTY_RULE,
      pickMax(
        plays.filter((play) => !won(play.row, play.game) && takedowns(play.row) >= PRETTY_TAKEDOWNS),
        (play) => kda(play.row),
      ),
      (play) => `${kdaLine(play.row.kills, play.row.deaths, play.row.assists)} · still a loss`,
    ),
    record(
      'rich-wrong',
      RICH_WRONG,
      RICH_WRONG_RULE,
      pickMax(
        plays.filter((play) => !won(play.row, play.game)),
        (play) => play.row.gold,
      ),
      (play) => goldLine(play.row.gold),
    ),
    record(
      'lost-jungle',
      LOST_JUNGLE,
      LOST_JUNGLE_RULE,
      pickMin(
        long.filter((play) => play.row.role === 'jungle'),
        (play) => play.row.cs,
      ),
      (play) => csCountLine(play.row.cs),
    ),
    record(
      'greedy-sup',
      GREEDY_SUP,
      GREEDY_SUP_RULE,
      pickMax(
        plays.filter((play) => play.row.role === 'support'),
        (play) => play.row.cs,
      ),
      (play) => csCountLine(play.row.cs),
    ),
    record(
      'fountain',
      FOUNTAIN,
      FOUNTAIN_RULE,
      pickMin(
        plays.filter(
          (play) =>
            play.game.durationS >= FOUNTAIN_GAME_S &&
            play.row.cs < FOUNTAIN_CS &&
            takedowns(play.row) < FOUNTAIN_TAKEDOWNS,
        ),
        (play) => play.row.cs,
      ),
      (play) => `${play.row.cs} CS · ${kdaLine(play.row.kills, play.row.deaths, play.row.assists)}`,
    ),
    record(
      'ghost',
      GHOST,
      GHOST_RULE,
      pickMin(
        plays.filter((play) => teamKills(play.game, play.row.side) >= GHOST_TEAM_KILLS),
        (play) => kp(play.row, play.game),
      ),
      (play) => kpLine(Math.round(kp(play.row, play.game) * 100)),
    ),
    record(
      'glue',
      GLUE,
      GLUE_RULE,
      pickMax(
        plays.filter((play) => teamKills(play.game, play.row.side) >= GLUE_TEAM_KILLS),
        (play) => kp(play.row, play.game),
      ),
      (play) => kpLine(Math.round(kp(play.row, play.game) * 100)),
    ),
  ];

  const longest = [...counted].sort((a, b) => b.durationS - a.durationS)[0];
  const longestMvp =
    longest === undefined
      ? null
      : pickMax(
          plays.filter((play) => play.game.id === longest.id),
          (play) => takedowns(play.row),
        );
  records.push({
    id: 'longest',
    title: LONGEST,
    rule: LONGEST_RULE,
    holders:
      longest === undefined || longestMvp === null
        ? []
        : [holder(longestMvp.player, minutesLine(longest.durationS), longest)],
    empty: NOBODY_THIS,
  });

  const shortest = [...counted].sort((a, b) => a.durationS - b.durationS)[0];
  const shortestSeat =
    shortest === undefined ? null : (plays.find((play) => play.game.id === shortest.id) ?? null);
  records.push({
    id: 'shortest',
    title: SHORTEST,
    rule: SHORTEST_RULE,
    holders:
      shortest === undefined || shortestSeat === null
        ? []
        : [holder(shortestSeat.player, minutesLine(shortest.durationS), shortest)],
    empty: NOBODY_THIS,
  });

  records.push(attendanceRecord(plays), comfortRecord(plays));

  return {
    games: counted.length,
    players: new Set(plays.map((play) => play.player.playerId)).size,
    tables: [
      {
        id: 'first-blood',
        title: FIRST_BLOOD_TITLE,
        intro: FIRST_BLOOD_INTRO,
        rows: [],
        empty: FIRST_BLOOD_EMPTY,
      },
    ],
    csByRole: csByRole(plays),
    records,
    notes: [FIRST_BLOOD_NOTE, VISION_NOTE],
  };
}
