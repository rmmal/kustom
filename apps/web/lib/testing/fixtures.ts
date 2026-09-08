import {
  type CompanionGameEogPayloadWithWinner,
  companionGamePayloadSchema,
  hasWinningTeam,
} from '@customs/db/schemas';

/**
 * Request bodies for tests. Plain JSON, exactly what the companion would put on the wire, so
 * the same fixture can be posted to a route handler and parsed for a unit test.
 */

export const ROLES_IN_ORDER = ['top', 'jungle', 'mid', 'adc', 'support'] as const;

export interface LobbyMemberOptions {
  puuid: string;
  gameName?: string | null;
  tagLine?: string | null;
  /** A JSON number is what the client reports (M2.10); a string is accepted too. */
  summonerId?: number | string | null;
  side?: 100 | 200 | null;
  isSpectator?: boolean;
}

export interface LobbyBodyOptions {
  partyId: string;
  members: readonly LobbyMemberOptions[];
  lobbyName?: string;
  lobbyPassword?: string;
}

/**
 * A `POST /api/companion/lobby` body.
 *
 * Members are written out one by one rather than generated, because the tests that use this
 * care about *which* name is attached to which PUUID: M1.7's rule is that `display_name`
 * follows `gameName` only while nobody has overridden it, and the only honest way to prove
 * that is to post a renamed member the way the companion would.
 *
 * Remember the M1.8 rule when using this: the token's own player has to be in `members`, or
 * the route answers 403 before it writes anything.
 */
export function lobbyBody(options: LobbyBodyOptions): Record<string, unknown> {
  return {
    partyId: options.partyId,
    lobbyName: options.lobbyName ?? 'customs night',
    lobbyPassword: options.lobbyPassword ?? '1234',
    members: options.members.map((member, index) => ({
      puuid: member.puuid,
      gameName: member.gameName ?? null,
      tagLine: member.tagLine ?? null,
      summonerId: member.summonerId ?? null,
      side: member.side === undefined ? (index < 5 ? 100 : 200) : member.side,
      isSpectator: member.isSpectator ?? false,
    })),
  };
}

export interface EogBodyOptions {
  gameId: number;
  puuids: readonly string[];
  partyId?: string | null;
  gameType?: string | null;
  /** `null` is the remake / `TerminatedInError` case the route refuses with a 422. */
  winningSide?: 100 | 200 | null;
  startedAt?: string;
  durationS?: number;
  /** Extra keys mixed into `raw`, for the credential-scrub assertions. */
  raw?: Record<string, unknown>;
}

/**
 * A ten-player end-of-game body: five on 100, five on 200, in the order given. Shaped the way
 * the M2.10 mapper produces it — the Riot ID pair the block carries included, `win` derived
 * from the winning side, `summonerId` as the client's number.
 */
export function eogBody(options: EogBodyOptions): Record<string, unknown> {
  const winningSide = options.winningSide === undefined ? 100 : options.winningSide;
  const participants = options.puuids.map((puuid, index) => ({
    puuid,
    side: index < 5 ? 100 : 200,
    role: ROLES_IN_ORDER[index % 5],
    championId: 100 + index,
    kills: index,
    deaths: 10 - index,
    assists: index * 2,
    gold: 10_000 + index * 100,
    damageToChamps: 20_000 + index * 250,
    cs: 150 + index,
    win: winningSide === null ? null : (index < 5 ? 100 : 200) === winningSide,
    gameName: null,
    tagLine: null,
    summonerId: 1_000_000 + index,
  }));

  return {
    phase: 'eog',
    gameId: options.gameId,
    partyId: options.partyId ?? null,
    gameType: options.gameType === undefined ? 'CUSTOM_GAME' : options.gameType,
    startedAt: options.startedAt ?? '2026-09-08T20:00:00.000Z',
    durationS: options.durationS ?? 1_920,
    winningSide,
    participants,
    raw: {
      gameId: options.gameId,
      gameType: options.gameType ?? 'CUSTOM_GAME',
      participants,
      ...options.raw,
    },
  };
}

/** The same body, parsed: what a route handler sees after zod. */
export function eogPayload(options: EogBodyOptions): CompanionGameEogPayloadWithWinner {
  const parsed = companionGamePayloadSchema.parse(eogBody(options));
  if (parsed.phase !== 'eog') throw new Error('eogPayload: expected the eog phase');
  if (!hasWinningTeam(parsed)) throw new Error('eogPayload: this block has no winning team');
  return parsed;
}

/** Ten unique PUUIDs namespaced by a run id, so reruns never collide. */
export function testPuuids(runId: string, count = 10): string[] {
  return Array.from({ length: count }, (_, index) => `it-${runId}-p${index}`);
}

/** A game id that is unique per run and stays inside `Number.MAX_SAFE_INTEGER`. */
export function testGameId(): number {
  return Date.now() * 1_000 + Math.floor(Math.random() * 1_000);
}
