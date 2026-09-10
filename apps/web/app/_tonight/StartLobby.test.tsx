import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  alreadyHasALobbyLine,
  invitedLine,
  LOBBY_ALREADY_OPEN,
  LOBBY_WRITES_UNVERIFIED,
  NO_CLIENT_ANSWERED,
  NO_COMPANION_AROUND,
  openingOnPcLine,
  START_LOBBY_BUTTON,
} from '@/lib/admin/lobbyStart';
import { START_LOBBY_OFFLINE } from '@/lib/tonight/copy';
import type { LobbyStartView } from '@/lib/tonight/lobbyStart';
import { StartLobby } from './StartLobby';

/**
 * `Start a lobby` (M4.2's control, M4.7's placement).
 *
 * The checks a night cannot be run to re-check: the press posts JSON **in place** and never
 * navigates (M3.20), a refusal is printed in the route's own words where the button is, the
 * pending line names the host that was picked, and a lobby that opened says nothing at all —
 * the member list appearing is the answer.
 *
 * **Today the gate is off in production**, so the honest first assertion is that the refusal
 * this deployment actually gets — `Opening lobbies isn't verified on this patch yet.` — renders
 * cleanly and is the route's own sentence, not one of ours.
 */

const HOST = 'Hamoodi';

function progress(overrides: Partial<LobbyStartView> = {}): LobbyStartView {
  return {
    status: 'pending',
    error: null,
    hostName: HOST,
    lobbyName: 'Customs 10 Sep #1',
    lobbyPassword: '4821',
    invited: 0,
    ...overrides,
  };
}

function draw(start: LobbyStartView | null = null, around = 0, onPressed?: () => void) {
  return render(<StartLobby start={start} around={around} onPressed={onPressed} />);
}

/** The route answered. `ok: false` carries the envelope every route in this app uses. */
function answers(body: unknown, ok = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response),
  );
}

function press(): void {
  fireEvent.click(screen.getByRole('button', { name: START_LOBBY_BUTTON }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('idle: nobody has pressed it', () => {
  it("is one button, labelled in product's words, with nothing under it", () => {
    const { container } = draw();

    expect(screen.getByRole('button', { name: START_LOBBY_BUTTON })).toBeInTheDocument();
    expect(container.querySelector('.cn-start-note')).not.toBeInTheDocument();
    expect(container.querySelector('.cn-hint')).not.toBeInTheDocument();
  });

  it('is a real form with a real action, for the browser with no JavaScript', () => {
    const { container } = draw();
    const form = container.querySelector('form');

    expect(form).toHaveAttribute('method', 'post');
    expect(form).toHaveAttribute('action', '/api/admin/lobbies/start');
    // The 303 path comes back to the tonight page, not to `/admin`, which is the route's own
    // default (M3.4). The route re-validates it as a path on this site.
    expect(container.querySelector('input[name="redirectTo"]')).toHaveValue('/');
  });
});

describe('the press', () => {
  it('posts an empty body in place, names the host, and never navigates', async () => {
    answers({ ok: true, commandId: 'c1', host: { playerId: 'p1', puuid: 'u1', name: HOST } });
    const refresh = vi.fn();
    draw(null, 0, refresh);

    press();

    await waitFor(() => expect(screen.getByText(openingOnPcLine(HOST))).toBeInTheDocument());
    const call = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(call?.[0]).toBe('/api/admin/lobbies/start');
    // The body decides nothing: no host, no name, no password, no mode (M4.2).
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({});
    // And the page asks the server for the row: this table emits no Realtime event.
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('keeps the focus on the button that was pressed', async () => {
    answers({ ok: true, host: { name: HOST } });
    draw();

    const button = screen.getByRole('button', { name: START_LOBBY_BUTTON });
    button.focus();
    press();

    await waitFor(() => expect(screen.getByText(openingOnPcLine(HOST))).toBeInTheDocument());
    // Not disabled while in flight: a control that disables itself loses the focus (M3.20).
    expect(document.activeElement).toBe(button);
    expect(button).not.toBeDisabled();
  });

  it('prints the route’s own sentence for every refusal, where the button is', async () => {
    for (const sentence of [
      LOBBY_WRITES_UNVERIFIED,
      LOBBY_ALREADY_OPEN,
      NO_COMPANION_AROUND,
      'A lobby is already being opened.',
    ]) {
      answers({ ok: false, error: sentence }, false);
      const { container, unmount } = draw();

      press();

      await waitFor(() => expect(screen.getByText(sentence)).toBeInTheDocument());
      // Beside the control, not as a banner at the top of the page and not in the URL.
      expect(container.querySelector('.cn-start-note')?.textContent).toBe(sentence);
      expect(container.querySelector('.cn-start')?.contains(screen.getByText(sentence))).toBe(true);
      unmount();
      vi.unstubAllGlobals();
    }
  });

  it('says nothing was opened when the request never left the browser', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    draw();

    press();

    await waitFor(() => expect(screen.getByText(START_LOBBY_OFFLINE)).toBeInTheDocument());
  });

  it('drops a second tap while one is in flight, instead of queuing a second command', async () => {
    answers({ ok: true, host: { name: HOST } });
    draw();

    press();
    press();

    await waitFor(() => expect(screen.getByText(openingOnPcLine(HOST))).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('what the row says afterwards', () => {
  it('names the host while the command is pending, and again while it is sent', () => {
    const { unmount } = draw(progress());
    expect(screen.getByText(openingOnPcLine(HOST))).toBeInTheDocument();
    unmount();

    draw(progress({ status: 'sent' }));
    expect(screen.getByText(openingOnPcLine(HOST))).toBeInTheDocument();
  });

  it('says nothing on success: the member list appearing is the answer', () => {
    const { container } = draw(progress({ status: 'acked' }));

    expect(container.querySelector('.cn-start-note')).not.toBeInTheDocument();
  });

  it('counts the invites once the lobby is open, until ten are in', () => {
    const { unmount } = draw(progress({ status: 'acked', invited: 7 }), 3);
    expect(screen.getByText(invitedLine(7))).toBeInTheDocument();
    unmount();

    // Ten in: there is nobody left to wait for.
    draw(progress({ status: 'acked', invited: 7 }), 10);
    expect(screen.queryByText(invitedLine(7))).not.toBeInTheDocument();
  });

  it('tells the group to join the lobby the host already had open', () => {
    draw(progress({ status: 'failed', error: 'already_in_lobby: partyId=abc' }));

    expect(screen.getByText(alreadyHasALobbyLine(HOST))).toBeInTheDocument();
  });

  it('says nobody’s client answered for every other failure, in one sentence', () => {
    const { unmount } = draw(progress({ status: 'failed', error: 'expired' }));
    expect(screen.getByText(NO_CLIENT_ANSWERED)).toBeInTheDocument();
    unmount();

    draw(progress({ status: 'failed', error: 'wrong_phase' }));
    expect(screen.getByText(NO_CLIENT_ANSWERED)).toBeInTheDocument();
  });

  it('lets a fresh refusal outrank the row from before it', async () => {
    answers({ ok: false, error: LOBBY_ALREADY_OPEN }, false);
    draw(progress({ status: 'failed', error: 'expired' }));

    expect(screen.getByText(NO_CLIENT_ANSWERED)).toBeInTheDocument();
    press();

    await waitFor(() => expect(screen.getByText(LOBBY_ALREADY_OPEN)).toBeInTheDocument());
    expect(screen.queryByText(NO_CLIENT_ANSWERED)).not.toBeInTheDocument();
  });
});
