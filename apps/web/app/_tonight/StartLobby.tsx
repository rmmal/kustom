'use client';

import { type FormEvent, useState } from 'react';
import { invitedLine, START_LOBBY_BUTTON, startLobbySentence } from '@/lib/admin/lobbyStart';
import { PLAYERS_PER_GAME } from '@/lib/lobbyState';
import { START_LOBBY_OFFLINE } from '@/lib/tonight/copy';
import type { LobbyStartView } from '@/lib/tonight/lobbyStart';

/**
 * `Start a lobby` on the tonight page (M4.2's control, M4.7's placement).
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
 * **Drawn for an admin only, and being drawn is not permission.** The route is admin-gated
 * until M3.6's third route class exists (`04-decisions.md`, 2026-09-10) and re-checks the
 * session server-side before it writes anything; a non-admin who forged the markup gets a 403.
 * An anonymous visitor is shown **nothing at all** — product's `Sign in with Discord to start a
 * lobby.` belongs to the widened route and would be a promise this deployment cannot keep, and
 * `Your role tonight` already carries the one sign-in this page has.
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
  /** How many are in the lobby now: the invited line is drawn until ten are in. */
  around: number;
  /**
   * Ask the server for that row again. `TonightLive` supplies it — `companion_commands` is
   * service-role only and in no Realtime publication, so this is the one change on this page
   * that has to be polled rather than subscribed to.
   */
  onPressed?: (() => void) | undefined;
}

export function StartLobby({ start, around, onPressed }: StartLobbyProps) {
  const [pending, setPending] = useState(false);
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
    // A second tap while one is in flight is dropped here rather than by disabling the button:
    // a control that disables itself loses focus, and M3.20 is about the focus staying put.
    if (pending) return;

    setPending(true);
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
      const host = hostNameOf(body);
      // An answer with no name is a 200 in a shape the schema does not allow; the server
      // re-read a moment later names the host, and until it does the page says nothing rather
      // than `Opening a lobby on 's PC…`.
      if (host !== null) setPressedHost(host);
      // The row is service-role only, so the page asks the **server** for it again rather than
      // waiting for an event that will never come.
      onPressed?.();
    } catch {
      setRefused(START_LOBBY_OFFLINE);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="cn-card cn-start">
      <form className="cn-start-form" method="post" action={START_ACTION} onSubmit={submit}>
        {/* Only the no-JavaScript path reads this. The route re-validates it as a path. */}
        <input type="hidden" name="redirectTo" value="/" />
        <button className="cn-button" type="submit">
          {START_LOBBY_BUTTON}
        </button>
      </form>
      {/*
       * Where the button is, never as a banner and never in the URL (M3.20). One slot: the
       * pending line, a refusal, or nothing at all on success — the member list appearing *is*
       * the answer, and a toast on top of it is noise (product, M4.2).
       */}
      {sentence === null ? null : (
        <p className="cn-start-note" role={refused === null ? 'status' : 'alert'}>
          {sentence}
        </p>
      )}
      {invited === null ? null : <p className="cn-hint">{invited}</p>}
    </section>
  );
}

/** The API's envelope is `{ ok: false, error }`. Anything else gets the page's own sentence. */
function errorOf(body: unknown): string {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const error = (body as { error: unknown }).error;
    if (typeof error === 'string' && error.length > 0) return error;
  }
  return START_LOBBY_OFFLINE;
}

/** `host.name` from the route's answer: already through the admin name chain (M4.2). */
function hostNameOf(body: unknown): string | null {
  if (typeof body === 'object' && body !== null && 'host' in body) {
    const host = (body as { host: unknown }).host;
    if (typeof host === 'object' && host !== null && 'name' in host) {
      const name = (host as { name: unknown }).name;
      if (typeof name === 'string' && name.length > 0) return name;
    }
  }
  return null;
}
