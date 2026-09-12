import { championName } from '../champs/names';
import type { HistoryGame } from '../games/types';
import { historyGameOf } from '../games/view';
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
  DEATHLESS_GAMES,
  DEATHLESS_GAMES_RULE,
  DEATHLESS_STREAK,
  DEATHLESS_STREAK_RULE,
  damageLine,
  FEAR_BAN_EMPTY,
  FEAR_BAN_INTRO,
  FEAR_BAN_TITLE,
  FIRST_BLOOD_EMPTY,
  FIRST_BLOOD_INTRO,
  FIRST_BLOOD_MOST,
  FIRST_BLOOD_MOST_RULE,
  FIRST_BLOOD_TITLE,
  FOUNTAIN,
  FOUNTAIN_RULE,
  fearBanLine,
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
  MOST_BARONS,
  MOST_BARONS_RULE,
  MOST_DAMAGE,
  MOST_DAMAGE_RULE,
  MOST_DEATHS,
  MOST_DEATHS_RULE,
  MOST_DEATHS_WINDOW,
  MOST_DEATHS_WINDOW_RULE,
  MOST_DRAGONS,
  MOST_DRAGONS_RULE,
  MOST_KILLS,
  MOST_KILLS_RULE,
  MOST_STEALS,
  MOST_STEALS_RULE,
  MOST_STEALS_WINDOW,
  MOST_STEALS_WINDOW_RULE,
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
  SHORTEST_LIFE,
  SHORTEST_LIFE_RULE,
  SHORTEST_RULE,
  WON_UGLY,
  WON_UGLY_RULE,
  ZERO_X,
  ZERO_X_RULE,
} from './funCopy';
import type { RawPlayerFacts } from './rawFacts';
import type {
  FunBloodRow,
  FunFactsView,
  FunFearBan,
  FunHolder,
  FunRecord,
  FunSection,
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
 * First blood, steals and draft bans come from {@link StatsGame.rawFacts}, parsed out of
 * `games.raw`. The killer is stored; the victim and the in-game first-death clock are not.
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
const MUSEUM_LIMIT = 25;
const FEAR_BAN_LIMIT = 5;
const DEATHLESS_STREAK_MIN = 2;

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

type BindGame = (game: StatsGame) => HistoryGame;

function holder(
  player: StatsPlayer,
  valueLabel: string,
  game: StatsGame | null = null,
  bind: BindGame | null = null,
): FunHolder {
  return {
    ...ref(player),
    valueLabel,
    detail: game === null ? null : matchDetail(game.startedAt, game.durationS),
    game: game === null || bind === null ? null : bind(game),
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
  bind: BindGame,
): FunRecord {
  return {
    id,
    title,
    rule,
    holders: play === null ? [] : [holder(play.player, valueLabel(play), play.game, bind)],
    empty: NOBODY_THIS,
  };
}

function csByRole(plays: readonly Play[], bind: BindGame): RoleCsPair[] {
  return LANE_ORDER.map((role) => {
    const atRole = plays.filter((play) => play.row.role === role);
    const highest = pickMax(atRole, (play) => play.row.cs);
    const lowest = pickMin(atRole, (play) => play.row.cs);
    const label = (play: Play) => csValue(play.row.cs, play.row.cs / minutes(play.game));
    return {
      role,
      highest: highest === null ? null : holder(highest.player, label(highest), highest.game, bind),
      lowest: lowest === null ? null : holder(lowest.player, label(lowest), lowest.game, bind),
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
  timeZone?: string,
): Omit<FunFactsView, 'window' | 'queue' | 'range' | 'capped' | 'cap'> {
  const counted = countedGames(games);
  const plays = playsOf(counted, players);
  const long = plays.filter((play) => play.game.durationS >= LONG_GAME_S);
  const rosterByPuuid = new Map(players.map((player) => [player.puuid, player]));
  const bind: BindGame = (game) => historyGameOf(game, rosterByPuuid, null, timeZone);
  const rec = (
    id: string,
    title: string,
    rule: string,
    play: Play | null,
    valueLabel: (play: Play) => string,
  ) => record(id, title, rule, play, valueLabel, bind);

  const records: FunRecord[] = [
    rec(
      'kills',
      MOST_KILLS,
      MOST_KILLS_RULE,
      pickMax(plays, (play) => play.row.kills),
      (play) => kdaLine(play.row.kills, play.row.deaths, play.row.assists),
    ),
    rec(
      'assists',
      MOST_ASSISTS,
      MOST_ASSISTS_RULE,
      pickMax(plays, (play) => play.row.assists),
      (play) => kdaLine(play.row.kills, play.row.deaths, play.row.assists),
    ),
    rec(
      'clean',
      CLEAN_KDA,
      CLEAN_KDA_RULE,
      pickMax(
        plays.filter((play) => takedowns(play.row) >= CLEAN_TAKEDOWNS),
        (play) => kda(play.row),
      ),
      (play) => kdaRatioLine(kda(play.row), play.row.kills, play.row.deaths, play.row.assists),
    ),
    rec(
      'zero-x',
      ZERO_X,
      ZERO_X_RULE,
      pickMax(
        plays.filter((play) => play.row.kills === 0 && play.row.deaths >= ZERO_X_DEATHS),
        (play) => play.row.deaths,
      ),
      (play) => kdaLine(play.row.kills, play.row.deaths, play.row.assists),
    ),
    rec(
      'damage',
      MOST_DAMAGE,
      MOST_DAMAGE_RULE,
      pickMax(plays, (play) => play.row.damageToChamps),
      (play) => damageLine(play.row.damageToChamps),
    ),
    rec(
      'paper',
      PAPER,
      PAPER_RULE,
      pickMin(
        long.filter((play) => play.row.role !== 'support'),
        (play) => play.row.damageToChamps,
      ),
      (play) => damageLine(play.row.damageToChamps),
    ),
    rec(
      'won-ugly',
      WON_UGLY,
      WON_UGLY_RULE,
      pickMin(
        plays.filter((play) => won(play.row, play.game)),
        (play) => kda(play.row),
      ),
      (play) => `${kdaLine(play.row.kills, play.row.deaths, play.row.assists)} · still a win`,
    ),
    rec(
      'lost-pretty',
      LOST_PRETTY,
      LOST_PRETTY_RULE,
      pickMax(
        plays.filter((play) => !won(play.row, play.game) && takedowns(play.row) >= PRETTY_TAKEDOWNS),
        (play) => kda(play.row),
      ),
      (play) => `${kdaLine(play.row.kills, play.row.deaths, play.row.assists)} · still a loss`,
    ),
    rec(
      'rich-wrong',
      RICH_WRONG,
      RICH_WRONG_RULE,
      pickMax(
        plays.filter((play) => !won(play.row, play.game)),
        (play) => play.row.gold,
      ),
      (play) => goldLine(play.row.gold),
    ),
    rec(
      'lost-jungle',
      LOST_JUNGLE,
      LOST_JUNGLE_RULE,
      pickMin(
        long.filter((play) => play.row.role === 'jungle'),
        (play) => play.row.cs,
      ),
      (play) => csCountLine(play.row.cs),
    ),
    rec(
      'greedy-sup',
      GREEDY_SUP,
      GREEDY_SUP_RULE,
      pickMax(
        plays.filter((play) => play.row.role === 'support'),
        (play) => play.row.cs,
      ),
      (play) => csCountLine(play.row.cs),
    ),
    rec(
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
    rec(
      'ghost',
      GHOST,
      GHOST_RULE,
      pickMin(
        plays.filter((play) => teamKills(play.game, play.row.side) >= GHOST_TEAM_KILLS),
        (play) => kp(play.row, play.game),
      ),
      (play) => kpLine(Math.round(kp(play.row, play.game) * 100)),
    ),
    rec(
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
        : [holder(longestMvp.player, minutesLine(longest.durationS), longest, bind)],
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
        : [holder(shortestSeat.player, minutesLine(shortest.durationS), shortest, bind)],
    empty: NOBODY_THIS,
  });

  records.push(attendanceRecord(plays), comfortRecord(plays));

  const museum = firstBloodMuseum(counted, plays, bind);
  const mostBlood = mostFirstBloods(plays);

  return {
    games: counted.length,
    players: new Set(plays.map((play) => play.player.playerId)).size,
    tables: [
      {
        id: 'first-blood',
        title: FIRST_BLOOD_MOST,
        intro: FIRST_BLOOD_MOST_RULE,
        rows: mostBlood,
        empty: FIRST_BLOOD_EMPTY,
      },
    ],
    museum,
    deathHall: deathHall(counted, plays, bind),
    thieves: objectiveThieves(plays, bind),
    fearBans: fearBans(plays),
    csByRole: csByRole(plays, bind),
    records,
    notes: [],
  };
}

function extrasOf(play: Play): RawPlayerFacts | null {
  return play.game.rawFacts?.byPuuid[play.row.puuid] ?? null;
}

function champOf(play: Play): string {
  const extras = extrasOf(play);
  return championName(play.row.championId, extras?.championName ?? null);
}

function firstBloodMuseum(
  counted: readonly StatsGame[],
  plays: readonly Play[],
  bind: BindGame,
): FunSection<FunBloodRow> {
  const byGame = new Map<string, Play[]>();
  for (const play of plays) {
    const list = byGame.get(play.game.id) ?? [];
    list.push(play);
    byGame.set(play.game.id, list);
  }

  const rows: FunBloodRow[] = [];
  for (const game of [...counted].reverse()) {
    const seat = (byGame.get(game.id) ?? []).find((play) => extrasOf(play)?.firstBloodKill === true);
    if (seat === undefined) continue;
    rows.push({
      gameId: game.id,
      taker: ref(seat.player),
      champion: champOf(seat),
      victim: null,
      opponent: null,
      when: matchDetail(game.startedAt, game.durationS),
      game: bind(game),
    });
    if (rows.length >= MUSEUM_LIMIT) break;
  }

  return {
    title: FIRST_BLOOD_TITLE,
    intro: FIRST_BLOOD_INTRO,
    rows,
    empty: FIRST_BLOOD_EMPTY,
  };
}

function mostFirstBloods(plays: readonly Play[]): FunHolder[] {
  const counts = new Map<string, { player: StatsPlayer; games: number }>();
  for (const play of plays) {
    if (extrasOf(play)?.firstBloodKill !== true) continue;
    const row = counts.get(play.player.playerId) ?? { player: play.player, games: 0 };
    row.games += 1;
    counts.set(play.player.playerId, row);
  }
  return [...counts.values()]
    .sort(
      (a, b) => b.games - a.games || renderWebName(a.player.name).localeCompare(renderWebName(b.player.name)),
    )
    .slice(0, 5)
    .map((row) => holder(row.player, row.games === 1 ? '1 first blood' : `${row.games} first bloods`));
}

function deathHall(counted: readonly StatsGame[], plays: readonly Play[], bind: BindGame): FunRecord[] {
  const shortest = pickMin(
    plays.filter((play) => play.row.deaths >= 1 && extrasOf(play)?.longestLivedS != null),
    (play) => extrasOf(play)?.longestLivedS ?? Number.POSITIVE_INFINITY,
  );

  const playsByGame = new Map<string, Play[]>();
  for (const play of plays) {
    const list = playsByGame.get(play.game.id) ?? [];
    list.push(play);
    playsByGame.set(play.game.id, list);
  }

  const totals = new Map<
    string,
    { player: StatsPlayer; deaths: number; deathless: number; current: number; best: number }
  >();
  for (const game of counted) {
    for (const play of playsByGame.get(game.id) ?? []) {
      const slot = totals.get(play.player.playerId) ?? {
        player: play.player,
        deaths: 0,
        deathless: 0,
        current: 0,
        best: 0,
      };
      slot.deaths += play.row.deaths;
      if (play.row.deaths === 0) {
        slot.deathless += 1;
        slot.current += 1;
        slot.best = Math.max(slot.best, slot.current);
      } else {
        slot.current = 0;
      }
      totals.set(play.player.playerId, slot);
    }
  }

  const mostDead = [...totals.values()].sort(
    (a, b) => b.deaths - a.deaths || renderWebName(a.player.name).localeCompare(renderWebName(b.player.name)),
  )[0];
  const longestClean = [...totals.values()]
    .filter((row) => row.best >= DEATHLESS_STREAK_MIN)
    .sort(
      (a, b) => b.best - a.best || renderWebName(a.player.name).localeCompare(renderWebName(b.player.name)),
    )[0];
  const mostClean = [...totals.values()]
    .filter((row) => row.deathless >= 1)
    .sort(
      (a, b) =>
        b.deathless - a.deathless || renderWebName(a.player.name).localeCompare(renderWebName(b.player.name)),
    )[0];

  return [
    record(
      'deaths',
      MOST_DEATHS,
      MOST_DEATHS_RULE,
      pickMax(plays, (play) => play.row.deaths),
      (play) => kdaLine(play.row.kills, play.row.deaths, play.row.assists),
      bind,
    ),
    {
      id: 'deaths-window',
      title: MOST_DEATHS_WINDOW,
      rule: MOST_DEATHS_WINDOW_RULE,
      holders:
        mostDead === undefined || mostDead.deaths === 0
          ? []
          : [holder(mostDead.player, `${mostDead.deaths} deaths`)],
      empty: NOBODY_THIS,
    },
    record(
      'shortest-life',
      SHORTEST_LIFE,
      SHORTEST_LIFE_RULE,
      shortest,
      (play) => minutesLine(extrasOf(play)?.longestLivedS ?? 0),
      bind,
    ),
    {
      id: 'deathless-streak',
      title: DEATHLESS_STREAK,
      rule: DEATHLESS_STREAK_RULE,
      holders: longestClean === undefined ? [] : [holder(longestClean.player, `${longestClean.best} games`)],
      empty: NOBODY_THIS,
    },
    {
      id: 'deathless-games',
      title: DEATHLESS_GAMES,
      rule: DEATHLESS_GAMES_RULE,
      holders:
        mostClean === undefined ? [] : [holder(mostClean.player, gamesCountLineFrom(mostClean.deathless))],
      empty: NOBODY_THIS,
    },
  ];
}

function objectiveThieves(plays: readonly Play[], bind: BindGame): FunRecord[] {
  const stolen = (play: Play) => extrasOf(play)?.objectivesStolen ?? 0;
  const dragons = (play: Play) => extrasOf(play)?.dragonKills ?? 0;
  const barons = (play: Play) => extrasOf(play)?.baronKills ?? 0;

  const totals = new Map<string, { player: StatsPlayer; stolen: number }>();
  for (const play of plays) {
    const row = totals.get(play.player.playerId) ?? { player: play.player, stolen: 0 };
    row.stolen += stolen(play);
    totals.set(play.player.playerId, row);
  }
  const career = [...totals.values()].sort(
    (a, b) => b.stolen - a.stolen || renderWebName(a.player.name).localeCompare(renderWebName(b.player.name)),
  )[0];

  const blocks: FunRecord[] = [
    record(
      'steals',
      MOST_STEALS,
      MOST_STEALS_RULE,
      pickMax(
        plays.filter((play) => stolen(play) > 0),
        stolen,
      ),
      (play) => (stolen(play) === 1 ? '1 steal' : `${stolen(play)} steals`),
      bind,
    ),
    {
      id: 'steals-window',
      title: MOST_STEALS_WINDOW,
      rule: MOST_STEALS_WINDOW_RULE,
      holders:
        career === undefined || career.stolen === 0
          ? []
          : [holder(career.player, career.stolen === 1 ? '1 steal' : `${career.stolen} steals`)],
      empty: NOBODY_THIS,
    },
    record(
      'dragons',
      MOST_DRAGONS,
      MOST_DRAGONS_RULE,
      pickMax(
        plays.filter((play) => dragons(play) > 0),
        dragons,
      ),
      (play) => (dragons(play) === 1 ? '1 dragon' : `${dragons(play)} dragons`),
      bind,
    ),
    record(
      'barons',
      MOST_BARONS,
      MOST_BARONS_RULE,
      pickMax(
        plays.filter((play) => barons(play) > 0),
        barons,
      ),
      (play) => (barons(play) === 1 ? '1 baron' : `${barons(play)} barons`),
      bind,
    ),
  ];
  return blocks.filter((block) => block.holders.length > 0);
}

function fearBans(plays: readonly Play[]): FunSection<FunFearBan> {
  const byPlayer = new Map<
    string,
    { player: StatsPlayer; games: number; champs: Map<number, number>; banned: Map<number, number> }
  >();

  for (const play of plays) {
    const row = byPlayer.get(play.player.playerId) ?? {
      player: play.player,
      games: 0,
      champs: new Map<number, number>(),
      banned: new Map<number, number>(),
    };
    row.games += 1;
    if (play.row.championId !== null) {
      row.champs.set(play.row.championId, (row.champs.get(play.row.championId) ?? 0) + 1);
    }
    const enemyBans = new Set(
      (play.game.rawFacts?.bans ?? [])
        .filter((ban) => ban.teamId !== play.row.side)
        .map((ban) => ban.championId),
    );
    for (const championId of enemyBans) {
      row.banned.set(championId, (row.banned.get(championId) ?? 0) + 1);
    }
    byPlayer.set(play.player.playerId, row);
  }

  const rows: FunFearBan[] = [...byPlayer.values()]
    .filter((row) => row.games >= MIN_RECORD_GAMES)
    .map((row) => {
      const [championId] = [...row.champs.entries()].sort((a, b) => b[1] - a[1])[0] ?? [0, 0];
      const banned = row.banned.get(championId) ?? 0;
      const rate = Math.round((banned / row.games) * 100);
      const champion = championName(championId);
      return {
        player: ref(row.player),
        champion,
        banned,
        available: row.games,
        rate,
        line: fearBanLine(renderWebName(row.player.name), champion, rate, banned, row.games),
      };
    })
    .filter((row) => row.banned > 0)
    .sort(
      (a, b) =>
        b.rate - a.rate ||
        b.banned - a.banned ||
        renderWebName(a.player.name).localeCompare(renderWebName(b.player.name)),
    )
    .slice(0, FEAR_BAN_LIMIT);

  return {
    title: FEAR_BAN_TITLE,
    intro: FEAR_BAN_INTRO,
    rows,
    empty: FEAR_BAN_EMPTY,
  };
}
