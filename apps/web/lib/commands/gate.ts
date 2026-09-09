import type { CompanionCommandKind } from '@customs/db/schemas';

/**
 * The server's half of the per-kind verification gate (`04-decisions.md`, 2026-09-09 and
 * 2026-09-10; M4.1).
 *
 * A command kind whose row in `docs/03-lcu-reference.md` is still `unverified` is disabled at
 * **both** ends: the server does not queue it and the companion answers `endpoint_unverified`
 * for it (`LOBBY_WRITE_VERIFICATION` in `packages/lcu/src/writes.ts`). Two flags rather than
 * one because companion binaries keep running for months — a stale exe must never be the
 * thing that POSTs an unverified path, and a fresh exe must never be sent work by an old
 * server that has forgotten why the flag was off.
 *
 * This file is deliberately a table of booleans and nothing else. Flipping one is the same
 * edit as writing the reference row green, and it belongs in the same commit.
 *
 * As of 2026-09-10 all three rows are `unverified`: the first live `verify-commands` run got
 * `500 INVALID_LOBBY` from the create body, and neither the invite nor the side switch was
 * ever exercised because there was no lobby to exercise them in. So the whole queue writes
 * zero rows today, on purpose, and every caller below is a no-op that still typechecks and is
 * still tested with the gate overridden.
 */
export const COMMAND_KIND_ENABLED: Readonly<Record<CompanionCommandKind, boolean>> = {
  create_lobby: false,
  invite: false,
  switch_side: false,
};

/** M4.3 reads this one by name: the auto side switch is on only when the row is green. */
export const SWITCH_SIDE_ENABLED = COMMAND_KIND_ENABLED.switch_side;

/** A per-kind override. Tests pass one; nothing in production does. */
export type CommandGate = Partial<Record<CompanionCommandKind, boolean>>;

export function isCommandKindEnabled(kind: CompanionCommandKind, gate?: CommandGate): boolean {
  return gate?.[kind] ?? COMMAND_KIND_ENABLED[kind];
}
