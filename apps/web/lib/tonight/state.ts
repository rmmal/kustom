import { isNameless } from './copy';
import type { LobbyView, PlayerName, SplitChoice, TonightSnapshot, TonightState } from './types';

/**
 * Snapshot in, one primary block out (05-design.md, "The tonight page's three states — one
 * rule"). Pure, so the state table is a unit test and not a walk through the page.
 *
 * The page renders exactly one of these and the header strip. A status the page has no block
 * for — `abandoned`, which the loader already filters out — is idle.
 */
export function tonightState(snapshot: TonightSnapshot): TonightState {
  const lobby = snapshot.lobby;
  if (lobby === null) return { kind: 'idle' };

  switch (lobby.status) {
    case 'open':
      return { kind: 'filling', lobby };
    case 'balanced':
    case 'in_game':
      // Reachable only when a balanced lobby has **no split rows at all** — the split insert
      // failed, and the next companion post rebalances it (`hasChosenSplit`). The narrower
      // case, rows with none flagged `is_chosen`, is handled in `loadTeams`: it falls back to
      // the newest run's rank 1 rather than dropping the teams for the instant that
      // `balanceLobby` and `promoteSplit` spend between their two statements.
      return lobby.teams === null ? { kind: 'filling', lobby } : { kind: 'teams', lobby, teams: lobby.teams };
    case 'finished':
      if (lobby.result?.rated) {
        return { kind: 'result', lobby, result: lobby.result, teams: lobby.teams };
      }
      // A game the fold did not rate — a remake, a four-minute surrender — has no result card
      // to draw: the teams they played and the explanation stay up under the header `Final`,
      // with no deltas and no banner apologising for it (M3.4).
      if (lobby.teams !== null) return { kind: 'teams', lobby, teams: lobby.teams };
      return lobby.result === null
        ? { kind: 'filling', lobby }
        : { kind: 'result', lobby, result: lobby.result, teams: null };
    default:
      return { kind: 'idle' };
  }
}

export interface HeaderView {
  /** The word, or the count line. `count` is set only while the lobby is filling. */
  label: string;
  count: number | null;
  /** The one pulsing element on the page. It stops at `finished`. */
  live: boolean;
}

/**
 * The header strip, which is always mounted and is the only element that survives every
 * transition: a phone reopened mid-night answers "where are we" in one glance.
 */
export function tonightHeader(state: TonightState): HeaderView {
  switch (state.kind) {
    case 'idle':
      return { label: 'Nothing tonight', count: null, live: false };
    case 'filling':
      return { label: 'in the lobby', count: state.lobby.members.length, live: true };
    case 'teams':
      return state.lobby.status === 'in_game'
        ? { label: 'In game', count: null, live: true }
        : state.lobby.status === 'finished'
          ? { label: 'Final', count: null, live: false }
          : { label: 'Teams set', count: null, live: true };
    default:
      return { label: 'Final', count: null, live: false };
  }
}

/**
 * Does anything on screen read `Someone`? That is the one condition under which the page
 * re-reads the name map on a timer: `players` is service-role only and is in no Realtime
 * publication, so a name arriving is the one change that will never turn up as an event
 * (M3.4, "`Someone`, and names that arrive late").
 */
export function hasNamelessRow(state: TonightState): boolean {
  return namesOnScreen(state).some(isNameless);
}

function namesOnScreen(state: TonightState): PlayerName[] {
  switch (state.kind) {
    case 'idle':
      return [];
    case 'filling':
      return state.lobby.members.map((member) => member.name);
    case 'teams':
      return [
        ...state.teams.blue.map((seat) => seat.name),
        ...state.teams.red.map((seat) => seat.name),
        ...state.teams.sitters.map((member) => member.name),
      ];
    default:
      return [
        ...state.result.blue.map((seat) => seat.name),
        ...state.result.red.map((seat) => seat.name),
        ...(state.teams?.sitters ?? []).map((member) => member.name),
      ];
  }
}

/**
 * Which split the one `Reroll` button promotes: the next one down the list.
 *
 * `null` means the control is disabled and the strip says `No more splits. …` — the chosen
 * split is the last one the lobby stored, so the group has seen the whole list. The route
 * refuses that press for the same reason (M3.2); this is the page agreeing with it in advance
 * rather than finding out by posting.
 */
export function nextRerollSplit(splits: readonly SplitChoice[]): SplitChoice | null {
  const chosen = splits.find((split) => split.isChosen);
  if (chosen === undefined) return null;
  return splits.find((split) => split.rank === chosen.rank + 1) ?? null;
}

/** Everyone around, in join order: the ten and the sitters, for the "you" marker. */
export function isViewer(puuid: string, viewerPuuid: string | null): boolean {
  return viewerPuuid !== null && puuid === viewerPuuid;
}

/** The lobby's members, keyed by puuid, for the blocks that render seats rather than rows. */
export function membersByPuuid(lobby: LobbyView): Map<string, LobbyView['members'][number]> {
  return new Map(lobby.members.map((member) => [member.puuid, member]));
}
