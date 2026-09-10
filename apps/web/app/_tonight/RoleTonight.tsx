'use client';

import { ROLES } from '@customs/core';
import type { LobbyStatusValue, RoleValue } from '@customs/db';
import { type MouseEvent, useEffect, useState } from 'react';
import {
  LINK_OFFLINE,
  PICK_YOURSELF,
  ROLE_CONTROL_HEADING,
  ROLE_CONTROL_HINT,
  ROLE_SAVED_FOR_NEXT_GAME,
  ROLE_SIGN_IN,
  ROLE_TAP_OFFLINE,
  renderWebName,
  SIGNED_IN_NO_LOBBY,
  THATS_ME,
} from '@/lib/tonight/copy';
import type { LobbyView, MemberView } from '@/lib/tonight/types';
import type { ViewerState } from '@/lib/tonight/viewer';
import { RoleIcon } from '../_icons/RoleIcon';

/**
 * `Your role tonight` (M3.6): the one thing a friend can change on this page about themselves.
 *
 * Somebody says in voice "I'll jungle tonight", taps `jungle` under their own name, and puts
 * the phone down. The next balance treats jungle as their main and their usual main as the
 * backup. It is a **preference, not a lock** — the sentence under the control says exactly
 * that, and the page never promises more.
 *
 * Four states, and which one is drawn is decided by the session on the server, never here:
 *
 *   - **linked, and in tonight's lobby** — the five role words, the chosen one in `brand`.
 *     Tapping the chosen one clears it; that is the only way out and there is no Clear button.
 *   - **signed in with no player row** — the `That's me` list of tonight's members, which is
 *     the day-one case for everybody and resolves itself in one tap with no admin.
 *   - **signed out** — one control that starts the Discord round trip back to `/`.
 *   - **linked but not in the lobby, or no live lobby at all** — nothing. There is no row to
 *     write and a preference with no lobby is M5's problem.
 *
 * **Nothing here navigates** (M3.20): every control is a real `<form>` with a real action —
 * the no-JavaScript path, which the routes still answer with a 303 — intercepted on click when
 * JavaScript is running and posted as JSON instead. The receipt is the role word turning
 * `brand`, not a toast: `05-design.md` — realtime already changes the thing you are looking
 * at. A refusal is printed inline, beside the control, never as a banner and never in the URL.
 *
 * **It is below the rack, not inside a row.** A rack row is exactly 44px and the rack is ten
 * rows at every count (`rowHeight.test.tsx`); five 44px targets do not fit in one, and putting
 * them there would move the block under a thumb. The card is the last thing in the column, so
 * it can appear and disappear without touching a pixel of the primary block above it.
 */

const ROLE_TAP_ACTION = '/api/me/role-tonight';
const LINK_ACTION = '/api/me/link';
const SIGN_IN_ACTION = '/auth/signin';

export interface RoleTonightProps {
  /** Tonight's lobby, or `null` on the idle page. */
  lobby: LobbyView | null;
  viewer: ViewerState;
  /**
   * Re-read the page's server components. Supplied by `TonightLive`, because who the viewer is
   * comes from the session on the server: after a self-link the footer's `Your games` and this
   * card's own state both live one render away. Absent in tests and in a static render, where
   * there is nothing to refresh.
   */
  onViewerChanged?: (() => void) | undefined;
}

/** The statuses a lobby can still be tapped on. `finished` and the rest draw no control. */
function isLive(status: LobbyStatusValue): boolean {
  return status === 'open' || status === 'balanced' || status === 'in_game';
}

export function RoleTonight({ lobby, viewer, onViewerChanged }: RoleTonightProps) {
  if (viewer.kind === 'unlinked') {
    // The list is drawn from whatever lobby the page is showing, finished or not: claiming
    // yourself is not a tap on the teams, and a friend who opens the page after the game
    // should not have to wait for the next lobby to be known.
    const members = lobby?.members ?? [];
    return members.length === 0 ? (
      <p className="cn-hint">{SIGNED_IN_NO_LOBBY}</p>
    ) : (
      <PickYourself members={members} onLinked={onViewerChanged} />
    );
  }

  if (lobby === null || !isLive(lobby.status)) return null;

  if (viewer.kind === 'anonymous') return <SignIn />;

  const seat = lobby.members.find((member) => member.puuid === viewer.puuid);
  // Linked, but not in tonight's lobby: there is no row to write, so there is no control.
  if (seat === undefined) return null;

  return <RolePicker key={seat.puuid} lobbyId={lobby.id} status={lobby.status} seat={seat} />;
}

/**
 * The five role words. Each is a submit button of one form, so the no-JavaScript path posts
 * the role that was pressed and nothing else; with JavaScript the click is intercepted.
 */
function RolePicker({
  lobbyId,
  status,
  seat,
}: {
  lobbyId: string;
  status: LobbyStatusValue;
  seat: MemberView;
}) {
  const [pending, setPending] = useState<RoleValue | null | undefined>(undefined);
  const [failed, setFailed] = useState<string | null>(null);
  // The optimistic answer until the write lands, then the stored one: the page is subscribed
  // to `lobby_members`, so every device shows the choice a moment later without asking.
  const chosen = pending === undefined ? seat.roleOverride : pending;

  useEffect(() => {
    // The write has come back around through Realtime — or somebody else changed the row —
    // so the optimistic value has done its job.
    if (pending !== undefined && seat.roleOverride === pending) setPending(undefined);
  }, [pending, seat.roleOverride]);

  async function submit(event: MouseEvent<HTMLButtonElement>, role: RoleValue | null): Promise<void> {
    // Cancels the browser's own submit: with JavaScript this control never navigates.
    event.preventDefault();
    const previous = chosen;
    setPending(role);
    setFailed(null);

    try {
      const response = await fetch(ROLE_TAP_ACTION, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lobbyId, role }),
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        // Back to what the row actually says, then the route's own sentence beside the word
        // that was pressed. It owns the rule it just refused.
        setPending(previous);
        setFailed(errorOf(body));
      }
    } catch {
      setPending(previous);
      setFailed(ROLE_TAP_OFFLINE);
    }
  }

  return (
    <section className="cn-card cn-role-card">
      <p className="cn-num cn-role-heading" id="cn-role-heading">
        {ROLE_CONTROL_HEADING}
      </p>
      <form
        className="cn-role-choices"
        method="post"
        action={ROLE_TAP_ACTION}
        aria-labelledby="cn-role-heading"
      >
        <input type="hidden" name="lobbyId" value={lobbyId} />
        {/* Only the no-JavaScript path reads this. The route re-validates it as a path here. */}
        <input type="hidden" name="redirectTo" value="/" />
        {ROLES.map((role) => {
          const selected = chosen === role;
          return (
            <button
              key={role}
              type="submit"
              name="role"
              // Tapping the chosen role clears it: `''` is the form's way of saying null, and
              // it is the only way out — there is no separate Clear button.
              value={selected ? '' : role}
              className={selected ? 'cn-role-choice cn-role-on' : 'cn-role-choice'}
              aria-pressed={selected}
              onClick={(event) => void submit(event, selected ? null : role)}
            >
              <RoleIcon role={role} />
              {role}
            </button>
          );
        })}
      </form>
      <p className="cn-hint">{ROLE_CONTROL_HINT}</p>
      {/* From `balanced` on: the tap is stored and the teams do not move. Said before the tap
          as well as after it, because a friend deserves to know that before they press. */}
      {status === 'open' ? null : <p className="cn-hint">{ROLE_SAVED_FOR_NEXT_GAME}</p>}
      {failed === null ? null : (
        <p className="cn-role-error" role="alert">
          {failed}
        </p>
      )}
    </section>
  );
}

/**
 * `That's me`, once (M3.6, "Picking yourself, once").
 *
 * Only tonight's members are offered — a friend cannot claim somebody who is not in the room
 * with them — and the route checks that again. A row somebody is already linked to is refused
 * with product's sentence; there is no way to tell from here which those are, and that is on
 * purpose: the page does not print who is linked to what.
 */
function PickYourself({
  members,
  onLinked,
}: {
  members: readonly MemberView[];
  onLinked?: (() => void) | undefined;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<string | null>(null);

  async function submit(event: MouseEvent<HTMLButtonElement>, puuid: string): Promise<void> {
    event.preventDefault();
    setFailed(null);
    try {
      const response = await fetch(LINK_ACTION, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ puuid }),
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        setFailed(errorOf(body));
        return;
      }
      setClaimed(puuid);
      // The session is linked from now on, and that is a fact the **server** holds: this asks
      // for the page's server components again so the rack marks the row and the footer grows
      // its `Your games` link. Not a navigation: no document load, and the focus stays.
      onLinked?.();
    } catch {
      setFailed(LINK_OFFLINE);
    }
  }

  return (
    <section className="cn-card cn-role-card">
      <p className="cn-pick-text" id="cn-pick-heading">
        {PICK_YOURSELF}
      </p>
      <ul className="cn-pick-list" aria-labelledby="cn-pick-heading">
        {members.map((member) => (
          <li key={member.puuid} className="cn-pick-row">
            <span className="cn-pick-name">{renderWebName(member.name)}</span>
            <form method="post" action={LINK_ACTION}>
              <input type="hidden" name="puuid" value={member.puuid} />
              <input type="hidden" name="redirectTo" value="/" />
              <button
                type="submit"
                className="cn-pick-button"
                onClick={(event) => void submit(event, member.puuid)}
              >
                {/* The name is in the row above the button in reading order, but a screen
                    reader moving button to button hears ten identical labels without it. */}
                {THATS_ME}
                <span className="cn-sr">{`: ${renderWebName(member.name)}`}</span>
              </button>
            </form>
          </li>
        ))}
      </ul>
      {claimed === null ? null : (
        // The list is about to be replaced by the role control on the next server render. This
        // is the one line that says the tap landed while that is in flight.
        <p className="cn-hint" role="status">
          {`You are ${renderWebName(members.find((member) => member.puuid === claimed)?.name ?? null)}.`}
        </p>
      )}
      {failed === null ? null : (
        <p className="cn-role-error" role="alert">
          {failed}
        </p>
      )}
    </section>
  );
}

/**
 * The one control an anonymous visitor sees, and the only thing on this page that navigates —
 * an OAuth round trip cannot be done in place. Reading is never gated: the rest of the page is
 * exactly what everybody else sees.
 */
function SignIn() {
  return (
    <section className="cn-card cn-role-card">
      <form method="post" action={SIGN_IN_ACTION} className="cn-signin">
        {/* Back to the tonight page, not to `/admin`, which is where a sign-in defaults. */}
        <input type="hidden" name="next" value="/" />
        <button type="submit" className="cn-button">
          {ROLE_SIGN_IN}
        </button>
      </form>
    </section>
  );
}

/** The API's envelope is `{ ok: false, error }`. Anything else gets a sentence of our own. */
function errorOf(body: unknown): string {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const error = (body as { error: unknown }).error;
    if (typeof error === 'string' && error.length > 0) return error;
  }
  return ROLE_TAP_OFFLINE;
}
