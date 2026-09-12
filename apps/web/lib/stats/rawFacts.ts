import type { SideValue } from '@customs/db';

/**
 * The extra scoreboard the companion already keeps on `games.raw` and that `/fun`
 * now reads (M5.27). Two shapes land in that column: an end-of-game block
 * (`teams[].players[].stats`) and a match-history detail (`participants` +
 * `participantIdentities` + `teams[].bans`).
 *
 * Pure. A malformed blob is empty facts, never a throw — the page still has the
 * columns `game_players` stores.
 */

const BOT_PUUID = '00000000-0000-0000-0000-000000000000';

export interface RawPlayerFacts {
  firstBloodKill: boolean;
  firstBloodAssist: boolean;
  visionScore: number | null;
  objectivesStolen: number;
  objectivesStolenAssists: number;
  baronKills: number;
  dragonKills: number;
  /** Seconds. The client's `longestTimeSpentLiving`. */
  longestLivedS: number | null;
  championName: string | null;
}

export interface RawBan {
  championId: number;
  teamId: SideValue;
}

export interface RawGameFacts {
  byPuuid: Record<string, RawPlayerFacts>;
  bans: RawBan[];
}

export function emptyRawFacts(): RawGameFacts {
  return { byPuuid: {}, bans: [] };
}

export function rawFactsFromUnknown(raw: unknown): RawGameFacts {
  if (!isRecord(raw)) return emptyRawFacts();
  if (Array.isArray(raw.participants) && Array.isArray(raw.participantIdentities)) {
    return fromMatchDetail(raw);
  }
  if (Array.isArray(raw.teams)) return fromEog(raw);
  return emptyRawFacts();
}

function fromEog(raw: Record<string, unknown>): RawGameFacts {
  const facts = emptyRawFacts();
  for (const team of raw.teams as unknown[]) {
    if (!isRecord(team) || !Array.isArray(team.players)) continue;
    const teamId = asSide(team.teamId);
    for (const player of team.players) {
      if (!isRecord(player)) continue;
      const puuid = asPuuid(player.puuid);
      if (puuid === null) continue;
      const stats = isRecord(player.stats) ? player.stats : {};
      facts.byPuuid[puuid] = extrasFromStats(stats, asText(player.championName));
    }
    if (teamId !== null) {
      pushBans(facts.bans, team.bans, teamId);
    }
  }
  return facts;
}

function fromMatchDetail(raw: Record<string, unknown>): RawGameFacts {
  const facts = emptyRawFacts();
  const identities = new Map<number, string>();
  for (const identity of raw.participantIdentities as unknown[]) {
    if (!isRecord(identity) || !isRecord(identity.player)) continue;
    const id = asInt(identity.participantId);
    const puuid = asPuuid(identity.player.puuid);
    if (id === null || puuid === null) continue;
    identities.set(id, puuid);
  }

  for (const participant of raw.participants as unknown[]) {
    if (!isRecord(participant)) continue;
    const id = asInt(participant.participantId);
    const puuid = id === null ? null : (identities.get(id) ?? null);
    if (puuid === null) continue;
    const stats = isRecord(participant.stats) ? participant.stats : {};
    facts.byPuuid[puuid] = extrasFromStats(stats, null);
  }

  if (Array.isArray(raw.teams)) {
    for (const team of raw.teams) {
      if (!isRecord(team)) continue;
      const teamId = asSide(team.teamId);
      if (teamId === null) continue;
      pushBans(facts.bans, team.bans, teamId);
    }
  }
  return facts;
}

function extrasFromStats(stats: Record<string, unknown>, championName: string | null): RawPlayerFacts {
  return {
    firstBloodKill: flag(stats.firstBloodKill),
    firstBloodAssist: flag(stats.firstBloodAssist),
    visionScore: asInt(stats.VISION_SCORE) ?? asInt(stats.visionScore),
    objectivesStolen: asInt(stats.objectivesStolen) ?? 0,
    objectivesStolenAssists: asInt(stats.objectivesStolenAssists) ?? 0,
    baronKills: asInt(stats.baronKills) ?? 0,
    dragonKills: asInt(stats.dragonKills) ?? 0,
    longestLivedS: asInt(stats.longestTimeSpentLiving),
    championName,
  };
}

function pushBans(into: RawBan[], bans: unknown, teamId: SideValue): void {
  if (!Array.isArray(bans)) return;
  for (const ban of bans) {
    if (!isRecord(ban)) continue;
    const championId = asInt(ban.championId);
    if (championId === null || championId <= 0) continue;
    into.push({ championId, teamId });
  }
}

function flag(value: unknown): boolean {
  return value === true || value === 1;
}

function asInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

function asText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function asSide(value: unknown): SideValue | null {
  return value === 100 || value === 200 ? value : null;
}

function asPuuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === BOT_PUUID) return null;
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
