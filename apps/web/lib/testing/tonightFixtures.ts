import { balance, displayRating, isOffRole, type Role, rateGame } from '@customs/core';
import type {
  LobbyView,
  MemberView,
  ResultSeatView,
  ResultView,
  SeatView,
  SplitChoice,
  TeamsView,
  TonightSnapshot,
} from '../tonight/types';
import { WORKED_ROSTER, workedBalance, workedPuuid } from './workedExample';

/**
 * The tonight page's states, built from the worked example (`docs/00-product.md`) — the same
 * ten friends the balancer tests and the Discord embeds use, so a component test here is
 * comparable line for line with the embed snapshot and with `docs/05-design.md`.
 *
 * Nothing is hand-computed: the split, the explanation and the off-role marker come from
 * `balance()` and core's `isOffRole`, the ratings from `displayRating`, and the result's after
 * ratings from `rateGame`.
 */

/** 06:00 in Africa/Cairo on 2026-09-09, which is 03:00 UTC. Any fixed instant would do. */
export const FIXTURE_NIGHT_START = '2026-09-09T03:00:00.000Z';

export function workedMembers(count = WORKED_ROSTER.length): MemberView[] {
  return WORKED_ROSTER.slice(0, count).map((player) => ({
    puuid: workedPuuid(player.name),
    name: player.name,
    mainRole: player.mainRole,
    secondaryRole: player.secondaryRole,
    roleOverride: null,
    isSpectator: false,
    rating: displayRating(player.mu),
  }));
}

/** One more person than the lobby can seat: the eleventh is in the spectator slot. */
export function extraMember(overrides: Partial<MemberView> = {}): MemberView {
  return {
    puuid: 'puuid-deniz',
    name: 'Deniz',
    mainRole: 'jungle',
    secondaryRole: 'top',
    roleOverride: null,
    isSpectator: true,
    rating: 1300,
    ...overrides,
  };
}

export interface TeamsFixtureOptions {
  /** Which of the three stored splits is promoted. 0 is the balancer's own choice. */
  chosen?: number;
  /** Everyone around who is not one of the ten. */
  sitters?: MemberView[];
  members?: MemberView[];
}

/**
 * A balanced lobby: the promoted split's seats, its stored explanation, and the lobby's three
 * splits so the reroll control has something to promote.
 */
export function workedTeams(options: TeamsFixtureOptions = {}): TeamsView {
  const chosen = options.chosen ?? 0;
  const balanced = workedBalance();
  const split = balanced.splits[chosen];
  const explanation = balanced.explanations[chosen];
  if (split === undefined || explanation === undefined) throw new Error('workedTeams: no such split');

  const members = options.members ?? workedMembers();
  const byPuuid = new Map(members.map((member) => [member.puuid, member]));
  const seats = (side: readonly { puuid: string; role: Role }[]): SeatView[] =>
    side.map((assignment) => {
      const member = byPuuid.get(assignment.puuid);
      if (member === undefined) throw new Error(`workedTeams: ${assignment.puuid} is not in the lobby`);
      return {
        puuid: assignment.puuid,
        name: member.name,
        role: assignment.role,
        rating: member.rating,
        offRole: isOffRole(member, assignment.role),
      };
    });

  const splits: SplitChoice[] = balanced.splits.map((_, index) => ({
    id: `split-${index + 1}`,
    rank: index + 1,
    isChosen: index === chosen,
  }));

  return {
    splitId: `split-${chosen + 1}`,
    explanation,
    blue: seats(split.blue),
    red: seats(split.red),
    sitters: options.sitters ?? [],
    blueWinProb: split.blueWinProb,
    splits,
  };
}

/** The worked example played out: red wins, and every after rating is `rateGame`'s. */
export function workedResult(overrides: Partial<ResultView> = {}): ResultView {
  const teams = workedTeams();
  const byPuuid = new Map(WORKED_ROSTER.map((player) => [workedPuuid(player.name), player]));
  const ratingsOf = (seats: readonly SeatView[]) =>
    seats.map((seat) => {
      const player = byPuuid.get(seat.puuid);
      if (player === undefined) throw new Error(`workedResult: ${seat.puuid} is not in the roster`);
      return { mu: player.mu, sigma: player.sigma };
    });

  const before = { blue: ratingsOf(teams.blue), red: ratingsOf(teams.red) };
  const after = rateGame(before.blue, before.red, 200);

  const seatsOf = (seats: readonly SeatView[], side: 100 | 200): ResultSeatView[] =>
    seats.map((seat, index) => ({
      puuid: seat.puuid,
      name: seat.name,
      role: seat.role,
      side,
      muBefore: (side === 100 ? before.blue : before.red)[index]?.mu ?? null,
      muAfter: (side === 100 ? after.blue : after.red)[index]?.mu ?? null,
    }));

  return {
    winningSide: 200,
    durationS: 2_052,
    blueWinProb: teams.blueWinProb,
    topDamage: { name: 'Lena', damage: 47_300 },
    blue: seatsOf(teams.blue, 100),
    red: seatsOf(teams.red, 200),
    rated: true,
    ...overrides,
  };
}

/**
 * Ten friends who all main mid. Nine of them cannot have it, so `balance()` returns a split
 * whose stored explanation carries the off-role clause and whose rows carry the marker — the
 * end-to-end case M3.7 is about, with nothing hand-written.
 */
export function offRoleFixture(): { members: MemberView[]; teams: TeamsView } {
  const members: MemberView[] = WORKED_ROSTER.map((player) => ({
    puuid: workedPuuid(player.name),
    name: player.name,
    mainRole: 'mid',
    secondaryRole: null,
    roleOverride: null,
    isSpectator: false,
    rating: displayRating(player.mu),
  }));

  const balanced = balance({
    players: WORKED_ROSTER.map((player) => ({
      puuid: workedPuuid(player.name),
      name: player.name,
      mu: player.mu,
      sigma: player.sigma,
      mainRole: 'mid' as Role,
      secondaryRole: null,
      roleOverride: null,
    })),
    duos: [],
    lastSplit: null,
  });

  const split = balanced.splits[0];
  const explanation = balanced.explanations[0];
  if (split === undefined || explanation === undefined) throw new Error('offRoleFixture: no split');

  const byPuuid = new Map(members.map((member) => [member.puuid, member]));
  const seats = (side: readonly { puuid: string; role: Role }[]): SeatView[] =>
    side.map((assignment) => {
      const member = byPuuid.get(assignment.puuid);
      if (member === undefined) throw new Error(`offRoleFixture: ${assignment.puuid} is not in the lobby`);
      return {
        puuid: assignment.puuid,
        name: member.name,
        role: assignment.role,
        rating: member.rating,
        offRole: isOffRole(member, assignment.role),
      };
    });

  return {
    members,
    teams: {
      splitId: 'split-1',
      explanation,
      blue: seats(split.blue),
      red: seats(split.red),
      sitters: [],
      blueWinProb: split.blueWinProb,
      splits: balanced.splits.map((_, index) => ({
        id: `split-${index + 1}`,
        rank: index + 1,
        isChosen: index === 0,
      })),
    },
  };
}

export function lobbyView(overrides: Partial<LobbyView> = {}): LobbyView {
  return {
    id: 'lobby-1',
    status: 'open',
    members: workedMembers(),
    teams: null,
    result: null,
    ...overrides,
  };
}

export function snapshot(lobby: LobbyView | null, overrides: Partial<TonightSnapshot> = {}): TonightSnapshot {
  return { lobby, nightStart: FIXTURE_NIGHT_START, seasonActive: true, ...overrides };
}
