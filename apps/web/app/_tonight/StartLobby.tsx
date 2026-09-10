'use client';

import { type FormEvent, useState } from 'react';
import { startLobbyResponseSchema } from '@/app/api/admin/lobbies/start/schema';
import { invitedLine, START_LOBBY_BUTTON, startLobbySentence } from '@/lib/admin/lobbyStart';
import { PLAYERS_PER_GAME } from '@/lib/lobbyState';
import { START_LOBBY_OFFLINE } from '@/lib/tonight/copy';
import type { LobbyStartView } from '@/lib/tonight/lobbyStart';

/**
 * `Start a lobby` on the tonight page (M4.2's control, M4.7 (a)'s layout).
 *
 * 21:40, seven friends in voice, one of them taps this on a phone. Somebody's League client —
 * nobody had to decide whose — opens a custom with a name and a password neither of them chose,
 * and the invite popup appears for everyone who is around. **It is the one tap this product
 * has**, and everything it needs to decide is decided by the route: who hosts, the name, the
 * password, the four refusals (`lib/admin/lobbyStart.ts`).
 *
 * **Every word here is imported, not retyped.** The button's label, the pending line and the
 * invited line are product's, and they live in one file with the rules that answer with them,
 * so this page and `/admin` cannot drift apart by a character.
 *
 * **Two shapes, one block** (the designer, 2026-09-10):
 *
 *   - **`idle`, for an admin: the button**, directly under the strip's sentence and *above* the
 *     rack. Ten empty seats are 480px, so a control below them is below the fold on a 390px
 *     phone — and this is the one thing on an idle page anybody can do.
 *   - **`filling`: a readout, with no button.** A lobby row exists, so the route can only answer
 *     `There is already a lobby open.`, and a control whose only outcome is a refusal is not a
 *     control. What is left is worth saying: how many were invited, or that the create failed.
 *
 * **No card and no mark.** It is a stack of lines under the strip; the 2px `brand` inset rule
 * means "this is about you" (the rack's row, `Your role tonight`) and this is about the night.
 *
 * **Drawn for an admin only, and being drawn is not permission.** The route is admin-gated
 * until M3.6's third route class exists (`04-decisions.md`, 2026-09-10) and re-checks the
 * session server-side before it writes; a non-admin who forged the markup gets a 403. An
 * anonymous visitor is shown nothing: product's `Sign in with Discord to start a lobby.` is
 * **suspended, not deleted**, and comes back when the press widens to linked players.
 *
 * **In place, and never a toast** (M3.20). A real `<form>` with a real action, intercepted when
 * JavaScript is running and posted as JSON to the same route; the answer — the pending line or
 * the route's own refusal — is printed where the button is, the URL never changes, no document
 * loads and the focus stays on the button that was pressed. With JavaScript off the form posts
 * and the 303 brings the same sentence back in the query string.
 */

const START_ACTION = '/api/admin/lobbies/start';

export interface StartLobbyProps {
  /**
   * Tonight's newest `create_lobby`, read on the server (`lib/tonight/lobbyStart.ts`), or
   * `null` when nobody has pressed today. It is what makes the pending line survive a reload
   * and appear on the *other* admin's phone.
   */
  start: LobbyStartView | null;
  /**
   * Whether the button is drawn: `idle` only. With `false` this is the readout — the same
   * sentences, with nothing to press.
   */
  press: boolean;
  /** How many are in the lobby now: the invited line is drawn until ten are in. */
  around: number;
  /**
   * Ask the server for that row again. `TonightLive` supplies it — `companion_commands` is
   * service-role only and in no Realtime publication, so this is the one change on this page
   * that has to be polled rather than subscribed to.
   */
  onPressed?: (() => void) | undefined;
}

export function StartLobby({ start, press, around, onPressed }: StartLobbyProps) {
  const [inFlight, setInFlight] = useState(false);
  /** The route's own sentence for a refused press, until the next press clears it. */
  const [refused, setRefused] = useState<string | null>(null);
  /**
   * The host this browser was told about, for the moment between the answer landing and the
   * server re-read arriving. After that the row itself names them, on every device.
   */
  const [pressedHost, setPressedHost] = useState<string | null>(null);

  const progress = start ?? (pressedHost === null ? null : { status: 'pending' as const, error: null });
  const hostName = start?.hostName ?? pressedHost ?? '';
  // A refusal is about the press that was just made and outranks the row from before it.
  const sentence = refused ?? startLobbySentence(progress, hostName);
  /**
   * While the command is live the button goes **quiet** rather than `disabled`: a disabled
   * control drops the focus to `<body>`, and M3.20 is about the focus staying where the
   * keyboard left it. `aria-disabled` says the same thing to a listener, and the submit
   * short-circuits, so the quiet button cannot queue a second command.
   */
  const quiet = progress?.status === 'pending' || progress?.status === 'sent';
  /**
   * `Invited <n> friends — waiting for them to accept.`, under the control while the lobby is
   * filling and until ten are in (product, M4.2). It is the fan-out's own count, so it appears
   * with the invites and not with the press.
   */
  const invited =
    progress?.status === 'acked' && start !== null && start.invited > 0 && around < PLAYERS_PER_GAME
      ? invitedLine(start.invited)
      : null;

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    // With JavaScript this control never navigates.
    event.preventDefault();
    // A second tap while one is in flight — or while the last one is still being run by a
    // client — is dropped here rather than by disabling the button (see `quiet`).
    if (inFlight || quiet) return;

    setInFlight(true);
    setRefused(null);
    try {
      // The body decides nothing (`start/schema.ts`): no host, no name, no password, no mode.
      const response = await fetch(START_ACTION, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        // One of the four sentences, in the route's own words: it owns the rule it refused.
        setRefused(errorOf(body));
        return;
      }
      // **The route's own response schema**, not a hand-read of two fields: one shape,
      // validated at both ends of the wire. A 200 the schema does not recognise names nobody,
      // and the server re-read a moment later fills the sentence in.
      const answer = startLobbyResponseSchema.safeParse(body);
      if (answer.success) setPressedHost(answer.data.host.name);
      // The row is service-role only, so the page asks the **server** for it again rather than
      // waiting for an event that will never come.
      onPressed?.();
    } catch {
      setRefused(START_LOBBY_OFFLINE);
    } finally {
      setInFlight(false);
    }
  }

  // The readout with nothing to say draws nothing at all, rather than an empty block with a gap
  // in it (the `filling` case for every night nobody pressed the button).
  if (!press && sentence === null && invited === null) return null;

  return (
    <div className="cn-start">
      {press ? (
        <form className="cn-start-form" method="post" action={START_ACTION} onSubmit={submit}>
          {/* Only the no-JavaScript path reads this. The route re-validates it as a path. */}
          <input type="hidden" name="redirectTo" value="/" />
          <button
            className={quiet ? 'cn-button cn-button-quiet' : 'cn-button'}
            type="submit"
            aria-disabled={quiet || undefined}
          >
            {START_LOBBY_BUTTON}
          </button>
        </form>
      ) : null}
      {/*
       * Where the button is, never as a banner and never in the URL (M3.20). One slot: the
       * pending line, a refusal, or nothing at all on success — the member list appearing *is*
       * the answer, and a toast on top of it is noise (product, M4.2).
       *
       * A refusal is 600 and `role="alert"`; a progress line is 400 and `role="status"`. Two
       * weights, because one of them is an answer to a press and the other is a state.
       */}
      {sentence === null ? null : (
        <p
          className={refused === null ? 'cn-start-note' : 'cn-start-note cn-start-note-refused'}
          role={refused === null ? 'status' : 'alert'}
        >
          {sentence}
        </p>
      )}
      {invited === null ? null : <p className="cn-hint">{invited}</p>}
    </div>
  );
}

/**
 * The API's envelope is `{ ok: false, error }`. Anything else gets the page's own sentence.
 *
 * Read by hand rather than through `apiErrorSchema`: that schema lives in `lib/http.ts` beside
 * `next/server`, and this is a client component. Two fields, one shape, every route.
 */
function errorOf(body: unknown): string {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const error = (body as { error: unknown }).error;
    if (typeof error === 'string' && error.length > 0) return error;
  }
  return START_LOBBY_OFFLINE;
}
