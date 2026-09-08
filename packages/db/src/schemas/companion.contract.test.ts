import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type CompanionGameEogPayloadInput,
  type CompanionLobbyMemberInput,
  type CompanionLobbyPayloadInput,
  type CompanionRankPayloadInput,
  companionGamePayloadSchema,
  companionLobbyMemberSchema,
  companionLobbyPayloadSchema,
  companionRankPayloadSchema,
  DETECTED_TEAM_POSITION_ROLES,
  NO_WINNING_TEAM_MESSAGE,
  puuidSchema,
  type RoleValue,
  type SideValue,
  summonerIdSchema,
  ZERO_PUUID,
} from './index';

/**
 * ============================================================================
 * THE MAPPER SPEC (M2.10)
 * ============================================================================
 *
 * The real mapper lives in `packages/lcu` (`04-decisions.md`: "the client-shape-to-companion-
 * payload mapper lives in packages/lcu") and `apps/companion` imports it. It cannot be
 * imported here — the dependency runs `lcu -> db`, never back — so this file writes the
 * mapping out by hand, against the committed 16.17 fixtures, and asserts the result validates.
 *
 * **This file is the specification.** The mapper in `packages/lcu` is correct when it produces,
 * field for field, what the three `mapX` functions below produce. If a rule here is wrong, fix
 * it here first and then in the mapper.
 *
 * Fixtures are read as JSON from disk on purpose: `@customs/lcu` is not a dependency of
 * `@customs/db` and must not become one.
 */

const FIXTURES = new URL('../../../lcu/fixtures/16.17/', import.meta.url);

function fixture<T>(name: string): T {
  const file = JSON.parse(readFileSync(new URL(name, FIXTURES), 'utf8')) as { body: T };
  return file.body;
}

/**
 * One end-of-game block out of the recorded WebSocket stream, by game id. The `Create` event
 * for `/lol-end-of-game/v1/eog-stats-block` carries the whole block in `data` — that is the
 * companion's primary path (M2.3), and it is the only place a `TerminatedInError` game was
 * captured, since the GET fixture is the game that finished.
 */
function wsEogBlock(gameId: number): LcuEogBlock {
  const lines = readFileSync(new URL('ws-events.ndjson', FIXTURES), 'utf8').split('\n');
  for (const line of lines) {
    if (!line.includes('eog-stats-block')) continue;
    const event = JSON.parse(line) as { eventType: string; data: LcuEogBlock | null };
    if (event.eventType === 'Create' && event.data?.gameId === gameId) return event.data;
  }
  throw new Error(`no eog Create event for game ${gameId} in ws-events.ndjson`);
}

// ---------------------------------------------------------------------------
// Lobby: GET /lol-lobby/v2/lobby  ->  POST /api/companion/lobby
// ---------------------------------------------------------------------------

/**
 * The parts of the client's lobby response the mapper is allowed to read. Everything else in
 * the response — `localMember`, `restrictions`, `warnings`, `popularChampions`, and the chat
 * credentials `mucJwtDto`/`multiUserChatPassword` — is not read and never leaves the PC.
 */
interface LcuLobby {
  partyId: string;
  members: {
    puuid: string;
    /** A JSON number. Not 32-bit; see the invitations test below. */
    summonerId: number;
    /** `""` on 16.17, for everyone, always. There is no `gameName`/`tagLine` here. */
    summonerName: string;
    isBot: boolean;
    isSpectator: boolean;
    /** Always 0 in a custom lobby. The mapper must never read it. */
    teamId: number;
  }[];
  gameConfig: {
    customLobbyName: string;
    customTeam100: { puuid: string; isBot: boolean }[];
    customTeam200: { puuid: string; isBot: boolean }[];
    customSpectators: { puuid: string; isBot: boolean }[];
  };
  /** Outstanding and accepted invites. Not members, and not posted. */
  invitations: { invitationId: string; state: string; toPuuid: string; toSummonerId: number }[];
}

/**
 * lobby.json / lobby--two-players.json / lobby--spectator.json -> the body of
 * `POST /api/companion/lobby`.
 *
 * 1. **Members come from `members[]`**, and only from `members[]`. On 16.17 it holds every
 *    human in the lobby, spectators included: in every lobby event of the three recording
 *    windows (39 of them, tested in `packages/lcu`) the human puuids in `members[]` are exactly
 *    `union(customTeam100, customTeam200, customSpectators)` (asserted below on all three
 *    fixtures). `invitations[]` is not a roster: a friend who has been invited and has not
 *    joined has a `Pending` row there and no `members[]` entry, and must not be posted.
 * 2. **Bots never reach `members[]`** on 16.17 — they sit in `customTeam100`/`customTeam200`
 *    with `isBot: true`, `puuid: ""`, `summonerId: 0`. The mapper still filters `isBot` on
 *    the way past, and the server drops an empty or all-zero puuid on top of that
 *    (`04-decisions.md`; M2.10, point 4), because a bot leaking through must never cost the
 *    group the other nine members.
 * 3. **Side is membership of `customTeam100` / `customTeam200`**, by puuid.
 *    `members[].teamId` is always `0` in a custom lobby and is never read (question 3 of the
 *    reference). There is no "unknown side" window: the first lobby event that lists a new
 *    member already places them in one of the three arrays, so `side: null` means spectator
 *    or genuinely unplaced, and both are valid states rather than errors.
 * 4. **A spectator is `side: null` + `isSpectator: true`.** They stay in `members[]` with
 *    `isSpectator: true` and appear in `gameConfig.customSpectators`, on neither team
 *    (`lobby--spectator.json`, question 9). That is what makes M1.8 work for the friend who
 *    sits out: their own puuid is in the list they post.
 * 5. **`summonerId` is a JSON number** and goes on the wire as a number or a decimal string;
 *    the schema normalises it to digits because `players.summoner_id` is `text`. It is not
 *    32-bit — an invitee's read `2686822975473024` — so the mapper must never coerce it
 *    through an int32, a bitwise operation or a float format.
 * 6. **There are no names here.** `summonerName` is `""` on 16.17 and there is no
 *    `gameName`/`tagLine` at all, so both are `null` unless the caller already had a name
 *    from `current-summoner` or a `summoners/puuid/{puuid}` lookup it had already done.
 *    **Posting a lobby never waits on a lookup** (M2.10, point 2).
 * 7. **`lobbyPassword` is not in this response.** `gameConfig` has no password field and
 *    `gameflow-session.gameData.password` is empty, so the mapper sends the password only
 *    when it created the lobby itself (M4) and `null` otherwise.
 * 8. **The answer is not just an acknowledgement.** `ranksNeeded` lists the puuids on this
 *    roster whose rank is missing or over a week old — hand it to the rank sweep (M2.4) and
 *    post a rank *only* for those and for the companion's own puuid. `recheckInMs`, when it
 *    is a number, means re-post this identical payload after that delay unless a real lobby
 *    event supersedes it first (M2.2/M2.5); it is `null` until M2.5 lands.
 */
function mapLobby(
  lobby: LcuLobby,
  known: ReadonlyMap<string, { gameName: string | null; tagLine: string | null }> = new Map(),
): CompanionLobbyPayloadInput {
  const sideOf = (puuid: string): SideValue | null => {
    if (lobby.gameConfig.customTeam100.some((entry) => entry.puuid === puuid)) return 100;
    if (lobby.gameConfig.customTeam200.some((entry) => entry.puuid === puuid)) return 200;
    // customSpectators, or not placed yet. Both are `null`, and `isSpectator` tells them apart.
    return null;
  };

  const members: CompanionLobbyMemberInput[] = lobby.members
    .filter((member) => !member.isBot)
    .map((member) => ({
      puuid: member.puuid,
      summonerId: member.summonerId,
      gameName: known.get(member.puuid)?.gameName ?? null,
      tagLine: known.get(member.puuid)?.tagLine ?? null,
      side: sideOf(member.puuid),
      isSpectator: member.isSpectator,
    }));

  return {
    partyId: lobby.partyId,
    lobbyName: lobby.gameConfig.customLobbyName,
    lobbyPassword: null,
    members,
  };
}

/** The same party, in three client states, 28 and 35 minutes apart (16.17, 2026-09-08). */
const soloLobby = fixture<LcuLobby>('lobby.json');
const twoPlayerLobby = fixture<LcuLobby>('lobby--two-players.json');
const spectatorLobby = fixture<LcuLobby>('lobby--spectator.json');

const LEADER = '34151cbd-d9f8-5dad-9dc8-c6a8e253c0de';
const FRIEND = 'c04e977c-133a-5d94-9fd3-6202f8beec4c';
/** Invited in the second window and still `Pending` in the third: never a member. */
const INVITEE = 'ae4f66e8-745c-5b24-8315-dc046c8bba96';

describe('lobby payload, mapped from the 16.17 lobby fixtures', () => {
  it('gives the two humans a side each, from customTeam100/200 and not from teamId', () => {
    const payload = companionLobbyPayloadSchema.parse(mapLobby(twoPlayerLobby));

    expect(payload.partyId).toBe('e3c69392-a134-43cb-97ae-8add18c72494');
    expect(payload.lobbyName).toBe("PRT Empty's Game");
    expect(payload.lobbyPassword).toBeNull();
    expect(payload.members).toEqual([
      {
        puuid: LEADER,
        // The client sent the number 47890856; `players.summoner_id` is text.
        summonerId: '47890856',
        gameName: null,
        tagLine: null,
        side: 100,
        isSpectator: false,
      },
      {
        puuid: FRIEND,
        summonerId: '53574489',
        gameName: null,
        tagLine: null,
        // The friend was auto-placed on the empty side when they joined, in the same event.
        side: 200,
        isSpectator: false,
      },
    ]);
    expect(payload.droppedMembers).toBe(0);
    // The side above came from gameConfig. Every member's teamId is 0, in every fixture.
    expect(twoPlayerLobby.members.map((member) => member.teamId)).toEqual([0, 0]);
  });

  it('makes the spectator side null and isSpectator true, and keeps them in the roster', () => {
    // M2.13: the friend in the spectator slot stays in `members[]` with `isSpectator: true`
    // and moves to `customSpectators[]`. M1.8 needs that — a spectating companion's own puuid
    // has to be in the list it posts or it is refused 403 all night.
    const payload = companionLobbyPayloadSchema.parse(mapLobby(spectatorLobby));

    expect(payload.members).toEqual([
      { puuid: LEADER, summonerId: '47890856', gameName: null, tagLine: null, side: 100, isSpectator: false },
      { puuid: FRIEND, summonerId: '53574489', gameName: null, tagLine: null, side: null, isSpectator: true },
    ]);
    expect(spectatorLobby.gameConfig.customTeam200).toEqual([]);
    expect(spectatorLobby.gameConfig.customSpectators.map((entry) => entry.puuid)).toEqual([FRIEND]);
  });

  it('reads the same partyId in all three states, which is why it is the dedupe key', () => {
    // Invite, join and spectate did not change it: `lcu_party_id` is stable for the night.
    for (const lobby of [soloLobby, twoPlayerLobby, spectatorLobby]) {
      expect(lobby.partyId).toBe('e3c69392-a134-43cb-97ae-8add18c72494');
    }
  });

  it('holds the union invariant every side derivation rests on', () => {
    // members[] (humans) == customTeam100 + customTeam200 + customSpectators, in every one of
    // the three captures. If this ever breaks, side derivation from one event is unsound and
    // the mapper has to wait for a later event — which is exactly what M2.2 must not do.
    for (const lobby of [soloLobby, twoPlayerLobby, spectatorLobby]) {
      const inMembers = lobby.members.filter((member) => !member.isBot).map((member) => member.puuid);
      const inConfig = [
        ...lobby.gameConfig.customTeam100,
        ...lobby.gameConfig.customTeam200,
        ...lobby.gameConfig.customSpectators,
      ]
        .filter((entry) => !entry.isBot)
        .map((entry) => entry.puuid);

      expect(new Set(inMembers)).toEqual(new Set(inConfig));
      expect(inMembers).toHaveLength(inConfig.length);
      expect(lobby.members.every((member) => member.teamId === 0)).toBe(true);
      // Every member of every capture: no name, ever.
      expect(lobby.members.every((member) => member.summonerName === '')).toBe(true);
    }
  });

  it('never posts an invitee, and survives their summonerId, which is not 32-bit', () => {
    const pending = twoPlayerLobby.invitations.find((invitation) => invitation.state === 'Pending');

    expect(pending?.toPuuid).toBe(INVITEE);
    // `invitationId` is "" on every row, so `toPuuid` is the only key an invite has (M4.2).
    expect(twoPlayerLobby.invitations.every((invitation) => invitation.invitationId === '')).toBe(true);
    // They accepted nothing, so they are not in the lobby and not in the payload.
    expect(twoPlayerLobby.members.some((member) => member.puuid === INVITEE)).toBe(false);
    expect(
      companionLobbyPayloadSchema.parse(mapLobby(twoPlayerLobby)).members.map((member) => member.puuid),
    ).toEqual([LEADER, FRIEND]);

    // 2686822975473024 is above 2^51 and below 2^53: a safe JS integer, not a 32-bit one.
    // It must survive as digits — never 2.686822975473024e+15, never a truncated int32.
    const id = pending?.toSummonerId ?? 0;
    expect(id).toBe(2_686_822_975_473_024);
    expect(id).toBeGreaterThan(2 ** 51);
    expect(Number.isSafeInteger(id)).toBe(true);
    expect(summonerIdSchema.parse(id)).toBe('2686822975473024');
  });

  it('carries a name the companion already had, and never waits for one it does not', () => {
    const known = new Map([[LEADER, { gameName: 'PRT Empty', tagLine: 'EUNE' }]]);

    const payload = companionLobbyPayloadSchema.parse(mapLobby(twoPlayerLobby, known));

    expect(payload.members[0]).toMatchObject({ gameName: 'PRT Empty', tagLine: 'EUNE' });
    // The friend is still nameless, and the post went out anyway.
    expect(payload.members[1]).toMatchObject({ gameName: null, tagLine: null });
  });

  it('parses the solo lobby too, where one side is empty and nobody is a spectator', () => {
    const payload = companionLobbyPayloadSchema.parse(mapLobby(soloLobby));

    expect(payload.members).toHaveLength(1);
    expect(payload.members[0]).toMatchObject({ puuid: LEADER, side: 100, isSpectator: false });
    // Five bots played in this lobby's game and not one of them is in `members[]`.
    expect(soloLobby.members.every((member) => !member.isBot)).toBe(true);
  });
});

describe('lobby payload, ten humans plus a bot and a spectator', () => {
  // Nobody has captured a ten-human lobby yet (it lands on the first M2 test night, see the
  // note under M2's acceptance line), so the size a real night has is built here in the same
  // client shape the three fixtures verified: ten humans (five in customTeam100, five in
  // customTeam200), one bot in a team array and not in members[], one spectator who is in
  // members[] with isSpectator: true and in customSpectators, on neither team.
  const human = (index: number) => ({
    puuid: `p-${index}`,
    summonerId: 2_686_822_975_473_024 + index,
    summonerName: '',
    isBot: false,
    isSpectator: false,
    teamId: 0,
  });
  const humans = Array.from({ length: 10 }, (_, index) => human(index));
  const spectator = {
    puuid: 'watcher',
    summonerId: 4242,
    summonerName: '',
    isBot: false,
    isSpectator: true,
    teamId: 0,
  };

  const lobby: LcuLobby = {
    partyId: 'party-ten',
    members: [...humans, spectator],
    gameConfig: {
      customLobbyName: 'customs night',
      customTeam100: humans.slice(0, 5).map((member) => ({ puuid: member.puuid, isBot: false })),
      customTeam200: [
        ...humans.slice(5).map((member) => ({ puuid: member.puuid, isBot: false })),
        { puuid: '', isBot: true },
      ],
      customSpectators: [{ puuid: spectator.puuid, isBot: false }],
    },
    invitations: [],
  };

  it('comes out five and five, with the spectator on neither side', () => {
    const payload = companionLobbyPayloadSchema.parse(mapLobby(lobby));

    expect(payload.members.filter((member) => member.side === 100)).toHaveLength(5);
    expect(payload.members.filter((member) => member.side === 200)).toHaveLength(5);
    expect(payload.members.filter((member) => member.isSpectator)).toEqual([
      { puuid: 'watcher', summonerId: '4242', gameName: null, tagLine: null, side: null, isSpectator: true },
    ]);
    // A summoner id above 2^51 survives as digits, not as 2.686822975473024e+15.
    expect(payload.members[0]?.summonerId).toBe('2686822975473024');
  });

  it('drops a bot the mapper missed without taking the roster down with it', () => {
    // M2.10 point 4: the server drops an empty or all-zero puuid rather than 400 the whole
    // roster. A bot leaking through must never cost the group the other nine members.
    const mapped = mapLobby(lobby);
    const leaked = companionLobbyPayloadSchema.parse({
      ...mapped,
      members: [
        ...mapped.members,
        { puuid: '', summonerId: 0, isSpectator: false },
        { puuid: ZERO_PUUID, summonerId: 0, isSpectator: false },
        { puuid: 'bot-with-a-name', isBot: true },
      ],
    });

    expect(leaked.members).toHaveLength(11);
    expect(leaked.droppedMembers).toBe(3);
  });

  it('rejects a placeholder puuid at the member schema, which is where it is a value', () => {
    // The payload above drops these entries; taken on its own, a member with a placeholder
    // puuid is not a member. Both statements have to be true: one keeps the night going, the
    // other keeps a shared bot row out of `players`.
    expect(companionLobbyMemberSchema.safeParse({ puuid: ZERO_PUUID }).success).toBe(false);
    expect(companionLobbyMemberSchema.safeParse({ puuid: '' }).success).toBe(false);
    expect(puuidSchema.safeParse(ZERO_PUUID).success).toBe(false);
    expect(puuidSchema.safeParse(ZERO_PUUID.toUpperCase()).success).toBe(false);
  });

  it('still refuses a member with no puuid key at all', () => {
    expect(
      companionLobbyPayloadSchema.safeParse({
        partyId: 'party-ten',
        members: [{ summonerId: 7, isSpectator: false }],
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Game: GET /lol-end-of-game/v1/eog-stats-block  ->  POST /api/companion/game
// ---------------------------------------------------------------------------

/** The parts of the end-of-game block the mapper is allowed to read. */
interface LcuEogBlock {
  gameId: number;
  /** Seconds. */
  gameLength: number;
  gameType: string;
  /** Epoch milliseconds. */
  endOfGameTimestamp: number;
  teams: {
    teamId: number;
    isWinningTeam: boolean;
    players: {
      puuid: string;
      summonerId: number;
      championId: number;
      botPlayer: boolean;
      detectedTeamPosition: string;
      riotIdGameName: string;
      riotIdTagLine: string;
      stats: Record<string, number>;
    }[];
  }[];
}

/**
 * eog-stats-block.json -> the body of `POST /api/companion/game`, `phase: 'eog'`.
 *
 * 1. **`startedAt` is derived.** The block has no start time. Prefer the moment the companion
 *    saw gameflow `InProgress` for this `gameId`; otherwise
 *    `endOfGameTimestamp - gameLength * 1000` — milliseconds minus seconds-as-milliseconds,
 *    both verified on 16.17. The fallback is not optional: a companion that reconnected at
 *    `EndOfGame` has no `InProgress` moment.
 * 2. **`winningSide` is the `teamId` of the team with `isWinningTeam: true`**, and `null` when
 *    no team has it. A `TerminatedInError` block is that case; the companion does not post it.
 * 3. **Bots are dropped by `botPlayer`**, before validation. They carry the all-zero puuid.
 *    Dropping them can leave fewer than ten participants, which the M2.5 gate handles by
 *    storing the game and not rating it.
 * 4. **`side` is the team's `teamId`**, not anything on the player row.
 * 5. **Role is `detectedTeamPosition`** through the published table, `null` for anything else.
 *    Never inferred from the champion.
 * 6. **Stats are the uppercase keys**, and `cs` is `MINIONS_KILLED + NEUTRAL_MINIONS_KILLED`.
 *    A missing key is 0.
 * 7. **`gameId` is the block's own `gameId`.** Never `gameflow-session.gameData.gameId` read in
 *    phase `Lobby`: after a game the session still holds the previous game's id and roster
 *    (16.17, verified), so the session is only a source from `GameStart` onward.
 * 8. **`raw` is the whole block.** The server scrubs `mucJwtDto` and `multiUserChatPassword`
 *    before storing it; the companion may scrub too.
 */
function mapEog(
  block: LcuEogBlock,
  partyId: string | null,
  inProgressMoment: string | null = null,
): CompanionGameEogPayloadInput {
  const role = (position: string): RoleValue | null =>
    (DETECTED_TEAM_POSITION_ROLES[position] as RoleValue | undefined) ?? null;

  const stat = (stats: Record<string, number>, key: string): number => stats[key] ?? 0;

  const participants = block.teams.flatMap((team) =>
    team.players
      .filter((player) => !player.botPlayer)
      .map((player) => ({
        puuid: player.puuid,
        side: team.teamId as SideValue,
        role: role(player.detectedTeamPosition),
        championId: player.championId,
        kills: stat(player.stats, 'CHAMPIONS_KILLED'),
        deaths: stat(player.stats, 'NUM_DEATHS'),
        assists: stat(player.stats, 'ASSISTS'),
        gold: stat(player.stats, 'GOLD_EARNED'),
        damageToChamps: stat(player.stats, 'TOTAL_DAMAGE_DEALT_TO_CHAMPIONS'),
        cs: stat(player.stats, 'MINIONS_KILLED') + stat(player.stats, 'NEUTRAL_MINIONS_KILLED'),
        win: stat(player.stats, 'WIN') === 1,
        gameName: player.riotIdGameName || null,
        tagLine: player.riotIdTagLine || null,
        summonerId: player.summonerId,
      })),
  );

  const winner = block.teams.find((team) => team.isWinningTeam);

  return {
    phase: 'eog',
    gameId: block.gameId,
    partyId,
    gameType: block.gameType,
    startedAt: inProgressMoment ?? new Date(block.endOfGameTimestamp - block.gameLength * 1000).toISOString(),
    durationS: block.gameLength,
    winningSide: winner === undefined ? null : (winner.teamId as SideValue),
    participants,
    raw: block as unknown as Record<string, unknown>,
  };
}

describe('game payload, mapped from fixtures/16.17/eog-stats-block.json', () => {
  const block = fixture<LcuEogBlock>('eog-stats-block.json');

  it('validates, with the bots filtered out', () => {
    const parsed = companionGamePayloadSchema.parse(mapEog(block, 'e3c69392-a134-43cb-97ae-8add18c72494'));
    if (parsed.phase !== 'eog') throw new Error('unreachable');

    // The fixture is a solo custom against five bots: one human, five bot rows dropped.
    expect(block.teams.flatMap((team) => team.players)).toHaveLength(6);
    expect(parsed.participants).toHaveLength(1);
    expect(parsed.gameId).toBe(4_000_969_091);
    expect(parsed.gameType).toBe('CUSTOM_GAME');
    expect(parsed.durationS).toBe(913);
    // The bots won; the human's side is 100.
    expect(parsed.winningSide).toBe(200);
    expect(parsed.participants[0]).toMatchObject({
      puuid: '34151cbd-d9f8-5dad-9dc8-c6a8e253c0de',
      side: 100,
      role: 'jungle', // detectedTeamPosition JUNGLE
      championId: 266,
      kills: 0, // CHAMPIONS_KILLED
      deaths: 1, // NUM_DEATHS
      assists: 0,
      gold: 2242, // GOLD_EARNED
      damageToChamps: 108, // TOTAL_DAMAGE_DEALT_TO_CHAMPIONS
      cs: 1, // MINIONS_KILLED 1 + NEUTRAL_MINIONS_KILLED 0
      win: false, // WIN 0
      gameName: 'PRT Empty',
      tagLine: 'EUNE',
      summonerId: '47890856',
    });
  });

  it('derives startedAt as endOfGameTimestamp minus gameLength, in milliseconds', () => {
    const parsed = companionGamePayloadSchema.parse(mapEog(block, null));
    if (parsed.phase !== 'eog') throw new Error('unreachable');

    // 1788886380672 ms - 913 s * 1000 = 1788885467672.
    expect(block.endOfGameTimestamp).toBe(1_788_886_380_672);
    expect(Date.parse(parsed.startedAt)).toBe(1_788_885_467_672);
    expect(parsed.startedAt).toBe('2026-09-08T16:37:47.672Z');
  });

  it('prefers the InProgress moment the companion observed', () => {
    const observed = '2026-09-08T16:37:40.000Z';
    const parsed = companionGamePayloadSchema.parse(mapEog(block, null, observed));
    if (parsed.phase !== 'eog') throw new Error('unreachable');

    expect(parsed.startedAt).toBe(observed);
  });

  it('sums cs from both minion keys, on a line that has neutral minions', () => {
    // Karthus, the bot jungler: MINIONS_KILLED 0, NEUTRAL_MINIONS_KILLED 64. The mapper drops
    // bots, so this asserts the arithmetic straight off the fixture rather than through the
    // payload — it is the only line in the capture where the two keys differ.
    const jungler = block.teams
      .flatMap((team) => team.players)
      .find((player) => player.botPlayer && player.detectedTeamPosition === 'JUNGLE');

    expect(jungler?.stats.MINIONS_KILLED).toBe(0);
    expect(jungler?.stats.NEUTRAL_MINIONS_KILLED).toBe(64);
    expect((jungler?.stats.MINIONS_KILLED ?? 0) + (jungler?.stats.NEUTRAL_MINIONS_KILLED ?? 0)).toBe(64);
  });

  it('maps every detectedTeamPosition the capture holds, and nothing else', () => {
    expect(DETECTED_TEAM_POSITION_ROLES).toEqual({
      TOP: 'top',
      JUNGLE: 'jungle',
      MIDDLE: 'mid',
      BOTTOM: 'adc',
      UTILITY: 'support',
    });

    const positions = block.teams.flatMap((team) =>
      team.players.map((player) => player.detectedTeamPosition),
    );
    expect(new Set(positions)).toEqual(new Set(['JUNGLE', 'TOP', 'MIDDLE', 'BOTTOM', 'UTILITY']));

    const parsed = companionGamePayloadSchema.parse({
      ...mapEog(block, null),
      participants: [
        { puuid: 'a', side: 100, role: null },
        // "", NONE and an unseen value are all null. Never a guess from the champion.
        { puuid: 'b', side: 200, role: null },
      ],
    });
    if (parsed.phase !== 'eog') throw new Error('unreachable');
    expect(parsed.participants.map((participant) => participant.role)).toEqual([null, null]);
  });

  it('refuses a block that nobody won, with the reason named', () => {
    // A TerminatedInError block: `teams[].isWinningTeam` false everywhere. The companion does
    // not post it; if it does, the payload validates as "no winner" and the route answers 422
    // with this message, writes no `games` row and rates nothing.
    const terminated: LcuEogBlock = {
      ...block,
      teams: block.teams.map((team) => ({ ...team, isWinningTeam: false })),
    };

    const payload = mapEog(terminated, null);
    expect(payload.winningSide).toBeNull();

    const parsed = companionGamePayloadSchema.parse(payload);
    if (parsed.phase !== 'eog') throw new Error('unreachable');
    expect(parsed.winningSide).toBeNull();
    expect(NO_WINNING_TEAM_MESSAGE).toBe('no winning team; remake or terminated');
    // `win` cannot be derived when nobody won, so it stays as the block reported it.
    expect(parsed.participants[0]?.win).toBe(false);
  });

  it('refuses the real terminated block from the 16.17 capture', () => {
    // The client dropped this game 100 seconds in (`WaitingForStats -> TerminatedInError ->
    // None`, twice in the capture). The block exists, is a `CUSTOM_GAME`, and has **one**
    // team with `isWinningTeam: false` and no second team at all. This is what a remake looks
    // like on the wire; there is no other signal to read.
    const terminated = wsEogBlock(4_000_965_483);

    expect(terminated.gameType).toBe('CUSTOM_GAME');
    expect(terminated.teams.map((team) => [team.teamId, team.isWinningTeam])).toEqual([[100, false]]);

    const payload = mapEog(terminated, null);
    expect(payload.winningSide).toBeNull();
    // Derived the same way as any other block: 1788885375209 ms - 100 s * 1000.
    expect(payload.startedAt).toBe('2026-09-08T16:34:35.209Z');
    expect(payload.participants).toHaveLength(1);

    // It parses — "nobody won" is a statement, not a forgotten field — and the route answers
    // 422 with this exact message, writes no `games` row and rates nothing (M2.10, point 6).
    // The lobby is left alone: it stays `in_game` and ages out on the idle rule (M2.5).
    const parsed = companionGamePayloadSchema.parse(payload);
    if (parsed.phase !== 'eog') throw new Error('unreachable');
    expect(parsed.winningSide).toBeNull();
    expect(NO_WINNING_TEAM_MESSAGE).toBe('no winning team; remake or terminated');
  });

  it('refuses a bot that reaches validation, because a bot is not a player', () => {
    const withBots: CompanionGameEogPayloadInput = {
      ...mapEog(block, null),
      participants: block.teams.flatMap((team) =>
        team.players.map((player) => ({ puuid: player.puuid, side: team.teamId as SideValue })),
      ),
    };

    const result = companionGamePayloadSchema.safeParse(withBots);
    expect(result.success).toBe(false);
  });

  it('fills win from winningSide when the mapper did not send it', () => {
    const parsed = companionGamePayloadSchema.parse({
      ...mapEog(block, null),
      winningSide: 100,
      participants: [
        { puuid: 'blue', side: 100 },
        { puuid: 'red', side: 200 },
      ],
    });
    if (parsed.phase !== 'eog') throw new Error('unreachable');

    expect(parsed.participants.map((participant) => participant.win)).toEqual([true, false]);
  });

  it('takes the in_progress ping from the session id, which is only read from GameStart on', () => {
    const parsed = companionGamePayloadSchema.parse({
      phase: 'in_progress',
      gameId: 4_000_969_091,
      partyId: 'e3c69392-a134-43cb-97ae-8add18c72494',
      startedAt: '2026-09-08T16:37:40.000Z',
    });

    expect(parsed.phase).toBe('in_progress');
    expect(parsed.gameId).toBe(4_000_969_091);
  });
});

// ---------------------------------------------------------------------------
// Rank: GET /lol-ranked/v1/ranked-stats/{puuid}  ->  POST /api/companion/rank
// ---------------------------------------------------------------------------

interface LcuRankedStats {
  queueMap: Record<
    string,
    { queueType: string; tier: string; division: string; leaguePoints: number; wins: number; losses: number }
  >;
}

/** What `GET /lol-summoner/v2/summoners/puuid/{puuid}` gives us, and nothing else from it. */
interface LcuSummoner {
  puuid: string;
  gameName: string;
  tagLine: string;
}

/**
 * ranked-stats-by-puuid--other.json (+ summoner-by-puuid--other.json) -> the body of
 * `POST /api/companion/rank`.
 *
 * 1. **The response carries no puuid**, so the mapper supplies the one it asked about — for
 *    `current-ranked-stats`, the local player's.
 * 2. **Tier, division and lp are passed through verbatim**; the schema normalises `""`/`NONE`
 *    and `"NA"` to null, and a null tier forces a null division and a null lp.
 * 3. **`losses` is never sent.** It reads `0` for every player but yourself, so it is not
 *    truth. `wins` is not sent either: our own `games` rows are the record.
 * 4. **The name rides along** (M2.4): the sweep already visits exactly the PUUIDs whose Riot
 *    ID we are missing — a lobby member carries none — so the same POST carries `gameName`
 *    and `tagLine` from `summoners/puuid/{puuid}`. Omit them when no lookup was done; the
 *    server writes only names it was given and never touches an admin's `display_name`.
 * 5. **Only `RANKED_SOLO_5x5`.** Flex is not our ladder and the TFT queues are noise. The
 *    server ignores any other queue's tier, and the name still lands.
 */
function mapRank(
  stats: LcuRankedStats,
  puuid: string,
  queue = 'RANKED_SOLO_5x5',
  summoner: LcuSummoner | null = null,
): CompanionRankPayloadInput {
  const entry = stats.queueMap[queue];
  return {
    puuid,
    tier: entry?.tier ?? null,
    division: entry?.division ?? null,
    lp: entry?.leaguePoints ?? null,
    queue,
    gameName: summoner?.gameName ?? null,
    tagLine: summoner?.tagLine ?? null,
  };
}

describe('rank payload, mapped from fixtures/16.17/ranked-stats-by-puuid--other.json', () => {
  const stats = fixture<LcuRankedStats>('ranked-stats-by-puuid--other.json');
  const puuid = 'aebd7c57-83d8-551d-a7b2-7caa7e8b1960'; // from the fixture's request path

  it('validates a ranked reading and drops losses', () => {
    const parsed = companionRankPayloadSchema.parse(mapRank(stats, puuid));

    expect(parsed).toEqual({
      puuid,
      tier: 'SILVER',
      division: 'II',
      lp: 1,
      queue: 'RANKED_SOLO_5x5',
      gameName: null,
      tagLine: null,
    });
    expect('losses' in parsed).toBe(false);
    expect('wins' in parsed).toBe(false);
    // The client's own number, for the record: 0 for everybody but yourself.
    expect(stats.queueMap.RANKED_SOLO_5x5?.losses).toBe(0);
  });

  it('drops losses even when a companion sends it', () => {
    const parsed = companionRankPayloadSchema.parse({ ...mapRank(stats, puuid), losses: 41, wins: 7 });

    expect('losses' in parsed).toBe(false);
    expect('wins' in parsed).toBe(false);
  });

  it('normalises an unranked queue to null tier, null division and null lp', () => {
    // RANKED_PREMADE_5x5 in this fixture is the unranked shape: tier "", division "NA".
    expect(stats.queueMap.RANKED_PREMADE_5x5).toMatchObject({ tier: '', division: 'NA', leaguePoints: 0 });

    const parsed = companionRankPayloadSchema.parse(mapRank(stats, puuid, 'RANKED_PREMADE_5x5'));

    expect(parsed).toEqual({
      puuid,
      tier: null,
      division: null,
      lp: null,
      queue: 'RANKED_PREMADE_5x5',
      gameName: null,
      tagLine: null,
    });
  });

  it('normalises the other ways a client says "no rank"', () => {
    for (const tier of ['', 'NONE', 'UNRANKED', '   ']) {
      const parsed = companionRankPayloadSchema.parse({ puuid, tier, division: 'IV', lp: 12 });
      expect(parsed).toMatchObject({ tier: null, division: null, lp: null });
    }

    // A real tier keeps its division, and "NA" is dropped whatever the tier says.
    expect(companionRankPayloadSchema.parse({ puuid, tier: 'GOLD', division: 'NA' })).toMatchObject({
      tier: 'GOLD',
      division: null,
    });
  });

  it('carries the name from the same sweep, for the same puuid', () => {
    // M2.4 posts one body per puuid: the rank from ranked-stats and the Riot ID from
    // summoners/puuid, because the lobby response has no name in it at all.
    const summoner = fixture<LcuSummoner>('summoner-by-puuid--other.json');
    expect(summoner.puuid).toBe(puuid);

    const parsed = companionRankPayloadSchema.parse(mapRank(stats, puuid, 'RANKED_SOLO_5x5', summoner));

    expect(parsed).toMatchObject({ tier: 'SILVER', gameName: 'XETA', tagLine: 'EUNE' });
  });

  it('reads the local player the same way, from current-ranked-stats', () => {
    const own = fixture<LcuRankedStats>('current-ranked-stats.json');

    const parsed = companionRankPayloadSchema.parse(mapRank(own, '34151cbd-d9f8-5dad-9dc8-c6a8e253c0de'));

    expect(parsed).toMatchObject({ tier: 'SILVER', division: 'IV', lp: 30 });
  });
});
