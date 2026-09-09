import type { LobbyStatusValue } from '@customs/db';
import { supersedeLobbyCommands } from './commands/queue';
import type { ServiceClient } from './supabase';

/**
 * The lobby state machine (M2.5): which moves are legal, how "unchanged for ten seconds" is
 * measured with no timers, and the two-hour idle sweep.
 *
 * The three numbers live here and nowhere else.
 */

/** How long the roster must not change before the lobby balances. */
export const ROSTER_STABLE_MS = 10_000;

/**
 * How long a lobby may go unmentioned before the sweep gives up on it: two hours for an
 * `open` or `balanced` lobby (`abandoned`) and the same two hours for an `in_game` one
 * (`dropped`, M5.11) — no game of League runs two hours, so an `in_game` row that has not
 * moved in that long has lost its end-of-game block.
 */
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
 * | `in_game` | `dropped` | the idle sweep: two hours and no result (M5.11) |
 * | `dropped` | `finished` | an eog block that arrives days late still closes its own lobby |
 *
 * `finished` and `abandoned` are terminal. **`dropped` is terminal in every way that matters**
 * — its roster is frozen for good and it is outside the live set, so the party's next post
 * starts a clean cycle — but it keeps the one door to `finished`, because a companion whose
 * queue file drains a week later is still telling the truth about that game, and the row then
 * leaves M5.5's missed list by itself.
 *
 * **`in_game` does age out, and only into `dropped`** (M5.11). It must never become
 * `abandoned`: `abandoned` keeps the M2.9 replace semantics, so it would unfreeze the record
 * of who played, and it means "dissolved before it ever started", which is the opposite of
 * what happened. Before M5.11 `in_game` was swept nowhere at all, and because
 * `lobbies_active_party_idx` allows one live row per party and the client keeps one party id
 * all night (M2.14), one missed end-of-game block cost the group every later game of that
 * night.
 */
export const LOBBY_TRANSITIONS: Readonly<Record<LobbyStatusValue, readonly LobbyStatusValue[]>> = {
  open: ['open', 'balanced', 'in_game', 'finished', 'abandoned'],
  balanced: ['open', 'balanced', 'in_game', 'finished', 'abandoned'],
  in_game: ['finished', 'dropped'],
  dropped: ['finished'],
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

/** `finished` and `abandoned`: a row here never moves again, whoever asks. */
export function isTerminalLobbyStatus(status: LobbyStatusValue): boolean {
  return LOBBY_TRANSITIONS[status].length === 0;
}

/** The status the row holds right now, or `null` when it is gone. */
export async function readLobbyStatus(
  client: ServiceClient,
  lobbyId: string,
): Promise<LobbyStatusValue | null> {
  const { data, error } = await client.from('lobbies').select('status').eq('id', lobbyId).maybeSingle();
  if (error) throw new Error(`readLobbyStatus: ${error.message}`);
  return data?.status ?? null;
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
  if ((data ?? []).length === 0) return false;

  await expireCommandsOnLeavingBalanced(client, input);
  return true;
}

/**
 * A lobby that leaves `balanced` takes its pending `switch_side` commands with it (M4.1).
 *
 * The rows were written for the split that was on the board; once the lobby is `in_game`,
 * `finished`, `dropped`, `abandoned` — or back at `open` because somebody joined — that split
 * is not the answer any more, and a command that lands afterwards moves a friend for no
 * reason. They are `failed` with `superseded` rather than left to their three-minute TTL,
 * because three minutes is long enough to be somebody's champion select.
 *
 * It lives inside `moveLobby` rather than in a hook because there is exactly one function that
 * moves a lobby, and this is part of the move: a caller cannot forget it. A reroll is the one
 * case this never sees — it promotes another split without the lobby leaving `balanced`, so
 * `promoteSplit` (`lib/admin/reroll.ts`) supersedes and re-queues in one write of its own.
 *
 * A failure here is logged and swallowed: a stale command is a nuisance, and a lobby that
 * cannot go `in_game` because of one is a night.
 */
async function expireCommandsOnLeavingBalanced(client: ServiceClient, input: MoveLobbyInput): Promise<void> {
  if (input.to === 'balanced' || !input.from.includes('balanced')) return;
  try {
    await supersedeLobbyCommands(client, input.lobbyId, `lobby is now ${input.to}`);
  } catch (error) {
    console.error(`moveLobby: superseding commands for lobby ${input.lobbyId} failed`, error);
  }
}

/**
 * {@link moveLobby}, and when it claims nothing, one line saying why if the reason is that the
 * lobby is already terminal.
 *
 * A refused move is usually ordinary — somebody else got there first, or the lobby is already
 * where we wanted it. It is *not* ordinary when the row is `finished` or `abandoned`: a game
 * that cannot close its lobby means the record and the game disagree, and the two-hour sweep
 * abandoning a lobby out from under an arriving end-of-game block is exactly the case worth
 * seeing in a log rather than guessing at later.
 */
export async function moveLobbyLogged(
  client: ServiceClient,
  input: MoveLobbyInput,
  context: string,
): Promise<boolean> {
  if (await moveLobby(client, input)) return true;

  const status = await readLobbyStatus(client, input.lobbyId);
  if (status !== null && isTerminalLobbyStatus(status)) {
    console.warn(`${context}: lobby ${input.lobbyId} is ${status}; cannot move ${status} -> ${input.to}`);
  }
  return false;
}

/**
 * The idle sweep, run at the start of every companion lobby and game post and by
 * `GET /api/cron/sweep`: two statements, both over the partial index `lobbies_open_idx`.
 *
 * 1. `open` or `balanced` and two hours unmentioned -> `abandoned`. It never started, so its
 *    roster is not history and the replace semantics survive (M2.9).
 * 2. `in_game` and two hours unmentioned -> `dropped` (M5.11). No game runs two hours, so
 *    this row has lost its end-of-game block; the roster stays frozen and the party's next
 *    post starts the night's next cycle instead of landing on a frozen row forever.
 *
 * The clock for both is the row's own `updated_at`, which the `in_progress` post moved when
 * it set `in_game` and which any later write to that row (a renamed lobby) moves again — so a
 * companion that is still reporting the party cannot have its game dropped out from under it
 * before the two hours are up.
 *
 * Returns how many lobbies were given up on, either way, for the log and for the cron route.
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

  const abandoned = (data ?? []).length;
  if (abandoned > 0) {
    console.info(`lobby sweep: ${abandoned} lobby(ies) idle for over two hours -> abandoned`);
  }
  // The same rule as every other exit from `balanced`, for the one path that does not go
  // through `moveLobby` (M4.1). A lobby nobody has mentioned for two hours has no side left
  // worth moving anybody to.
  for (const row of data ?? []) {
    await supersedeCommandsQuietly(client, row.id, 'abandoned');
  }

  const { data: stuck, error: stuckError } = await client
    .from('lobbies')
    .update({ status: 'dropped' })
    .eq('status', 'in_game')
    .lt('updated_at', cutoff)
    .select('id');
  if (stuckError) throw new Error(`sweepIdleLobbies: dropping stuck games failed: ${stuckError.message}`);

  const dropped = (stuck ?? []).length;
  if (dropped > 0) {
    // Worth a line each: this is a night whose result nobody will ever see, and M5.5 is the
    // page that lists them.
    for (const row of stuck ?? []) {
      console.warn(`lobby sweep: lobby ${row.id} was in_game for over two hours with no result -> dropped`);
    }
  }
  for (const row of stuck ?? []) {
    await supersedeCommandsQuietly(client, row.id, 'dropped');
  }

  return abandoned + dropped;
}

/** {@link supersedeLobbyCommands}, with the sweep's own rule: one line, never a thrown error. */
async function supersedeCommandsQuietly(
  client: ServiceClient,
  lobbyId: string,
  status: LobbyStatusValue,
): Promise<void> {
  try {
    await supersedeLobbyCommands(client, lobbyId, `lobby is now ${status}`);
  } catch (error) {
    console.error(`lobby sweep: superseding commands for lobby ${lobbyId} failed`, error);
  }
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
