/**
 * M5.18: a role for a backfilled participant, from the `timeline.lane` / `timeline.role` pair of a
 * match-history participant.
 *
 * The match-history detail has no `detectedTeamPosition`. What it has is the server's lane/role guess in
 * `participants[].timeline` — the match-v4 vocabulary (`TOP`/`JUNGLE`/`MIDDLE`/`BOTTOM`/`NONE` and
 * `SOLO`/`NONE`/`CARRY`/`SUPPORT`/`DUO`/...) that Riot's public API replaced with `teamPosition` because it
 * was unreliable. A pair goes into `MATCH_TIMELINE_ROLES` only once the fixtures prove it: every game that
 * exists both as a match-history game and as a live end-of-game capture is cross-checked participant by
 * participant (`crossCheckTimelineRoles`), and a pair maps only when it never disagreed with
 * `detectedTeamPosition`. Anything else is null — an invented role is worse than a missing one, because it
 * silently moves somebody's main (M5.16). The evidence and the table are in `docs/03-lcu-reference.md`.
 *
 * Nothing in this file talks to a client. `readTimelineEvidence` reads fixture files; the rest is pure.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isPlaceholderPuuid, type RoleValue, roleFromDetectedTeamPosition } from '@customs/db/schemas';
import { FIXTURES_DIR, FixtureEnvelopeSchema } from './fixtures.js';
import {
  type EogStatsBlock,
  EogStatsBlockSchema,
  type MatchGame,
  MatchGameSchema,
  MatchHistoryListSchema,
} from './schemas.js';

/** `participants[].timeline` as far as the mapper reads it. Both keys are optional on the wire. */
export interface MatchTimeline {
  readonly lane?: string | undefined;
  readonly role?: string | undefined;
}

/** The pair as the table and the logs spell it: `LANE+ROLE`, upper-cased, a missing half left empty. */
export function matchTimelineKey(lane: string | undefined, role: string | undefined): string {
  return `${(lane ?? '').trim().toUpperCase()}+${(role ?? '').trim().toUpperCase()}`;
}

/**
 * The verified table. A row is added only when the cross-check against the fixtures shows the pair agreeing
 * with `detectedTeamPosition` on every participant of every overlapping game, and never disagreeing.
 *
 * **Empty on 16.17 (2026-09-10).** The fixtures hold exactly one overlapping game (4000965483, aborted after
 * 100 s, one participant, `NONE+SOLO` vs `MIDDLE`), which proves nothing. The one full 5v5 detail we have
 * (4000769615) argues against the obvious rows: two of its four `JUNGLE+NONE` participants took Ignite/Flash,
 * killed 1 and 4 neutral minions in 49 minutes and farmed 244 and 277 lane minions (they were the top laners),
 * and its one `TOP+SOLO` participant took Exhaust, placed 40 wards and farmed 76 (the support). See the
 * reference doc for the whole table. Add a row here only with the evidence beside it there.
 */
export const MATCH_TIMELINE_ROLES: Readonly<Record<string, RoleValue>> = {};

/** The role for a participant's `timeline`, or null for a pair the table does not know (which today is every pair). */
export function roleFromMatchTimeline(timeline: MatchTimeline | undefined): RoleValue | null {
  if (timeline === undefined) return null;
  return MATCH_TIMELINE_ROLES[matchTimelineKey(timeline.lane, timeline.role)] ?? null;
}

// ---------------------------------------------------------------------------
// Evidence: the cross-check the table is built from
// ---------------------------------------------------------------------------

export const EOG_STATS_BLOCK_URI = '/lol-end-of-game/v1/eog-stats-block';

/** One human participant seen in both a match-history game and a live end-of-game capture of the same game. */
export interface TimelineObservation {
  readonly gameId: number;
  readonly puuid: string;
  readonly pair: string;
  /** `detectedTeamPosition` as captured; `''` when the block carried none. */
  readonly position: string;
}

export interface TimelineConfusionRow {
  readonly pair: string;
  /** How many overlapping participants carried this pair, by the position the live capture recorded. */
  readonly positions: Readonly<Record<string, number>>;
  readonly total: number;
  /** What `MATCH_TIMELINE_ROLES` says today. */
  readonly mapped: RoleValue | null;
  /** Participants whose live position maps (through `detectedTeamPosition`) to `mapped`. 0 when unmapped. */
  readonly agreed: number;
  /** Participants whose live position maps to something else, or to nothing. 0 when unmapped. */
  readonly disagreed: number;
}

export interface TimelineCrossCheck {
  readonly observations: readonly TimelineObservation[];
  readonly rows: readonly TimelineConfusionRow[];
  /** Game ids present in both inputs. */
  readonly overlappingGameIds: readonly number[];
  /** Every pair in `games` (overlapping or not), with how often it was seen. */
  readonly pairsSeen: Readonly<Record<string, number>>;
}

/** Every human `(gameId, puuid) -> detectedTeamPosition` a set of end-of-game blocks recorded. First block per game wins. */
function livePositions(blocks: readonly EogStatsBlock[]): Map<number, Map<string, string>> {
  const byGame = new Map<number, Map<string, string>>();
  for (const block of blocks) {
    if (byGame.has(block.gameId)) continue;
    const players = new Map<string, string>();
    for (const team of block.teams) {
      for (const player of team.players) {
        if (player.botPlayer || isPlaceholderPuuid(player.puuid)) continue;
        players.set(player.puuid, player.detectedTeamPosition ?? '');
      }
    }
    byGame.set(block.gameId, players);
  }
  return byGame;
}

/** Every pair a set of games carries, counted once per participant row. */
export function timelinePairsSeen(games: readonly MatchGame[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const game of games) {
    for (const participant of game.participants) {
      const key = matchTimelineKey(participant.timeline?.lane, participant.timeline?.role);
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * The confusion table: for every participant that exists in a match-history game **and** in a live end-of-game
 * block of the same `gameId`, the detail's pair against the block's `detectedTeamPosition`. A participant seen
 * in several games records (the list and the detail of the same game) counts once.
 */
export function crossCheckTimelineRoles(
  games: readonly MatchGame[],
  blocks: readonly EogStatsBlock[],
): TimelineCrossCheck {
  const live = livePositions(blocks);
  const seen = new Set<string>();
  const observations: TimelineObservation[] = [];
  const overlapping = new Set<number>();

  for (const game of games) {
    const players = live.get(game.gameId);
    if (players === undefined) continue;
    const identities = new Map(
      game.participantIdentities.map((identity) => [identity.participantId, identity.player.puuid] as const),
    );
    for (const participant of game.participants) {
      const puuid = identities.get(participant.participantId);
      if (puuid === undefined || isPlaceholderPuuid(puuid)) continue;
      const position = players.get(puuid);
      if (position === undefined) continue;
      const dedupe = `${game.gameId}:${puuid}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      overlapping.add(game.gameId);
      observations.push({
        gameId: game.gameId,
        puuid,
        pair: matchTimelineKey(participant.timeline?.lane, participant.timeline?.role),
        position,
      });
    }
  }

  const byPair = new Map<string, TimelineObservation[]>();
  for (const observation of observations) {
    const list = byPair.get(observation.pair) ?? [];
    list.push(observation);
    byPair.set(observation.pair, list);
  }
  const rows: TimelineConfusionRow[] = [...byPair.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([pair, list]) => {
      const positions: Record<string, number> = {};
      for (const observation of list) {
        positions[observation.position] = (positions[observation.position] ?? 0) + 1;
      }
      const mapped = MATCH_TIMELINE_ROLES[pair] ?? null;
      let agreed = 0;
      let disagreed = 0;
      if (mapped !== null) {
        for (const observation of list) {
          if (roleFromDetectedTeamPosition(observation.position) === mapped) agreed += 1;
          else disagreed += 1;
        }
      }
      return { pair, positions, total: list.length, mapped, agreed, disagreed };
    });

  return {
    observations,
    rows,
    overlappingGameIds: [...overlapping].sort((a, b) => a - b),
    pairsSeen: timelinePairsSeen(games),
  };
}

/** The confusion table as Markdown, the way `docs/03-lcu-reference.md` carries it. */
export function formatTimelineConfusion(rows: readonly TimelineConfusionRow[]): string {
  const lines = [
    '| pair | live `detectedTeamPosition` (count) | mapped to | agreed | disagreed |',
    '|---|---|---|---|---|',
  ];
  for (const row of rows) {
    const positions = Object.entries(row.positions)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([position, count]) => `${position === '' ? '(empty)' : position} ${count}`)
      .join(', ');
    lines.push(
      `| \`${row.pair}\` | ${positions} | ${row.mapped ?? 'null'} | ${row.mapped === null ? '-' : row.agreed} | ${row.mapped === null ? '-' : row.disagreed} |`,
    );
  }
  return lines.join('\n');
}

export interface TimelineEvidence {
  readonly games: readonly MatchGame[];
  readonly blocks: readonly EogStatsBlock[];
  /** The fixture files that contributed, relative to the patch directory. */
  readonly files: readonly string[];
}

interface RecordedLine {
  uri?: string;
  eventType?: string;
  data?: unknown;
  dropped?: boolean;
}

/**
 * Everything under `fixtures/<patch>/` that can take part in the cross-check: `match-detail*.json` and
 * `match-history*.json` (each list game carries the local player's own timeline) on one side,
 * `eog-stats-block*.json` and the eog `Create`/`Update` events in `ws-events*.ndjson` on the other. A file
 * that does not parse is skipped, never thrown on.
 */
export function readTimelineEvidence(patch: string, root: string = FIXTURES_DIR): TimelineEvidence {
  const dir = join(root, patch);
  const games: MatchGame[] = [];
  const blocks: EogStatsBlock[] = [];
  const files: string[] = [];
  let names: string[];
  try {
    names = readdirSync(dir).sort();
  } catch {
    return { games, blocks, files };
  }

  const envelopeBody = (name: string): unknown => {
    try {
      const parsed = FixtureEnvelopeSchema.safeParse(JSON.parse(readFileSync(join(dir, name), 'utf8')));
      return parsed.success && parsed.data.status === 200 ? parsed.data.body : undefined;
    } catch {
      return undefined;
    }
  };

  for (const name of names) {
    if (name.startsWith('match-detail') && name.endsWith('.json')) {
      const game = MatchGameSchema.safeParse(envelopeBody(name));
      if (game.success) {
        games.push(game.data);
        files.push(name);
      }
    } else if (name.startsWith('match-history') && name.endsWith('.json')) {
      const list = MatchHistoryListSchema.safeParse(envelopeBody(name));
      if (list.success) {
        games.push(...list.data.games.games);
        files.push(name);
      }
    } else if (name.startsWith('eog-stats-block') && name.endsWith('.json')) {
      const block = EogStatsBlockSchema.safeParse(envelopeBody(name));
      if (block.success) {
        blocks.push(block.data);
        files.push(name);
      }
    } else if (name.startsWith('ws-events') && name.endsWith('.ndjson')) {
      let text: string;
      try {
        text = readFileSync(join(dir, name), 'utf8');
      } catch {
        continue;
      }
      let found = 0;
      for (const line of text.split('\n')) {
        if (line.length === 0) continue;
        let event: RecordedLine;
        try {
          event = JSON.parse(line) as RecordedLine;
        } catch {
          continue;
        }
        if (event.dropped === true || event.uri !== EOG_STATS_BLOCK_URI) continue;
        if (event.eventType !== 'Create' && event.eventType !== 'Update') continue;
        const block = EogStatsBlockSchema.safeParse(event.data);
        if (block.success) {
          blocks.push(block.data);
          found += 1;
        }
      }
      if (found > 0) files.push(name);
    }
  }
  return { games, blocks, files };
}
