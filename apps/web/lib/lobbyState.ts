import type { LobbyStatusValue } from '@customs/db';
import type { ServiceClient } from './supabase';

/**
 * The lobby state machine (M2.5): which moves are legal, how "unchanged for ten seconds" is
 * measured with no timers, and the two-hour idle sweep.
 *
 * The three numbers live here and nowhere else.
 */

/** How long the roster must not change before the lobby balances. */
export const ROSTER_STABLE_MS = 10_000;

/** An `open` or `balanced` lobby nobody has posted about for this long is `abandoned`. */
export const IDLE_ABANDON_MS = 7_200_000;

/** A game shorter than this is a remake or a four-minute surrender, and is never rated. */
export const MIN_RATED_DURATION_S = 300;

/** The floor on `recheckInMs`: never ask a companion to knock again in under a second. */
export const MIN_RECHECK_MS = 1_000;

/** Ten play; everyone else around sits out (M2.5, "Choosing the ten"). */
export const PLAYERS_PER_GAME = 10;

/**
 * Every legal move, and nothing else.
 *
 * | From | To | Signal |
 * |---|---|---|
 * | — | `open` | the first lobby post for a party with no live row (M2.14) |
 * | `open` | `open` | a post whose roster differs: members replaced, the clock restarts |
 * | `open` | `balanced` | a post with an identical roster, ten or more around, ten seconds on the clock |
 * | `balanced` | `open` | a post whose roster differs |
 * | `balanced` | `balanced` | a post with an identical roster: nothing at all, unless the splits went missing |
 * | `open`/`balanced` | `in_game` | a game post with `phase: 'in_progress'` for this lobby |
 * | `in_game` | `finished` | the `eog` post for this lobby |
 * | `open`/`balanced` | `finished` | the same eog, when the `in_progress` post never arrived |
 * | `open`/`balanced` | `abandoned` | the idle sweep |
 *
 * `finished` and `abandoned` are terminal, and **`in_game` never ages out**: `abandoned`
 * keeps the M2.9 replace semantics, so sweeping a lobby whose game was dropped would unfreeze
 * the record of who played. M5.5 is the surface that lists it.
 */
export const LOBBY_TRANSITIONS: Readonly<Record<LobbyStatusValue, readonly LobbyStatusValue[]>> = {
  open: ['open', 'balanced', 'in_game', 'finished', 'abandoned'],
  balanced: ['open', 'balanced', 'in_game', 'finished', 'abandoned'],
  in_game: ['finished'],
  finished: [],
  abandoned: [],
};

/** Thrown when code asks for a move the table does not have. Never answered to a companion. */
export class IllegalLobbyTransitionError extends Error {
  override name = 'IllegalLobbyTransitionError';

  constructor(
    readonly from: LobbyStatusValue,
    readonly to: LobbyStatusValue,
  ) {
    super(`lobby cannot go from ${from} to ${to}`);
  }
}

export function isLegalTransition(from: LobbyStatusValue, to: LobbyStatusValue): boolean {
  return LOBBY_TRANSITIONS[from].includes(to);
}

export function assertLegalTransition(from: LobbyStatusValue, to: LobbyStatusValue): void {
  if (!isLegalTransition(from, to)) throw new IllegalLobbyTransitionError(from, to);
}

export interface MoveLobbyInput {
  lobbyId: string;
  /** The statuses this move is allowed to start from. Every one is checked against the table. */
  from: readonly LobbyStatusValue[];
  to: LobbyStatusValue;
}

/**
 * Move one lobby, if it is still where the caller thinks it is.
 *
 * This is a compare-and-set — `update lobbies set status = ? where id = ? and status in (?)` —
 * and it is how two companions posting the same lobby in the same second produce one
 * transition: only the request whose update returns a row owns what follows (M2.5, point 4).
 *
 * `false` means somebody else got there first, or the lobby has already moved on. That is a
 * normal answer, not an error: the caller writes nothing and answers 200.
 */
export async function moveLobby(client: ServiceClient, input: MoveLobbyInput): Promise<boolean> {
  for (const from of input.from) assertLegalTransition(from, input.to);

  const { data, error } = await client
    .from('lobbies')
    .update({ status: input.to })
    .eq('id', input.lobbyId)
    .in('status', input.from)
    .select('id');
  if (error) throw new Error(`moveLobby: ${input.to} failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * The idle sweep, run at the start of every companion lobby and game post: one statement over
 * the partial index `lobbies_open_idx`.
 *
 * `in_game` is deliberately not swept (see the table above). Returns how many lobbies were
 * given up on, for the log.
 */
export async function sweepIdleLobbies(client: ServiceClient, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - IDLE_ABANDON_MS).toISOString();

  const { data, error } = await client
    .from('lobbies')
    .update({ status: 'abandoned' })
    .in('status', ['open', 'balanced'])
    .lt('updated_at', cutoff)
    .select('id');
  if (error) throw new Error(`sweepIdleLobbies: ${error.message}`);

  const swept = (data ?? []).length;
  if (swept > 0) console.info(`lobby sweep: ${swept} lobby(ies) idle for over two hours -> abandoned`);
  return swept;
}

export interface RecheckInput {
  /** The lobby's status after this post has been processed. */
  status: LobbyStatusValue;
  /** Everyone around: every non-bot member, spectators included. */
  around: number;
  /** Milliseconds since the roster last changed, measured on the lobby's `updated_at`. */
  elapsedMs: number;
  /** True when this very post changed the roster, so the clock started over just now. */
  rosterChanged: boolean;
}

/**
 * **Knock again in this many milliseconds** — how the ten-second rule is measured on a server
 * with no timers (M2.5, point 3).
 *
 * The number is only ever sent while the lobby is `open` with ten or more people around: that
 * is the one state where doing nothing would leave a full lobby unbalanced forever. Anything
 * else is `null`, which means the companion does nothing until a real lobby event arrives.
 */
export function recheckInMs({ status, around, elapsedMs, rosterChanged }: RecheckInput): number | null {
  if (status !== 'open' || around < PLAYERS_PER_GAME) return null;
  // The full window when the clock just restarted, so the answer does not depend on how many
  // milliseconds the write itself took.
  if (rosterChanged) return ROSTER_STABLE_MS;
  const remaining = ROSTER_STABLE_MS - elapsedMs;
  return Math.max(MIN_RECHECK_MS, Math.min(ROSTER_STABLE_MS, Math.ceil(remaining)));
}

/** Has the roster been still long enough to balance? */
export function isRosterStable(elapsedMs: number): boolean {
  return elapsedMs >= ROSTER_STABLE_MS;
}
