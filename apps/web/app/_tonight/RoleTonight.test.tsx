import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extraMember, lobbyView, workedMembers } from '@/lib/testing/tonightFixtures';
import {
  PICK_YOURSELF,
  ROLE_CONTROL_HEADING,
  ROLE_CONTROL_HINT,
  ROLE_SAVED_FOR_NEXT_GAME,
  ROLE_SIGN_IN,
  ROLE_TAP_OFFLINE,
  SIGNED_IN_NO_LOBBY,
  THATS_ME,
} from '@/lib/tonight/copy';
import type { LobbyView } from '@/lib/tonight/types';
import type { ViewerState } from '@/lib/tonight/viewer';
import { RoleTonight } from './RoleTonight';

/**
 * `Your role tonight` and `That's me` (M3.6).
 *
 * The acceptance checks a night cannot be run to re-check: the tap posts the role that was
 * pressed and **never navigates** (M3.20), tapping the chosen role clears it, the control says
 * `Saved for the next game.` once the teams are up, a refusal is the route's own sentence
 * inline beside the control, and the four viewer states each draw exactly one thing.
 */

const ME = workedMembers(1)[0]?.puuid ?? '';

function lobby(overrides: Partial<LobbyView> = {}): LobbyView {
  return lobbyView({ members: workedMembers(4), ...overrides });
}

function draw(viewer: ViewerState, view: LobbyView | null, onViewerChanged?: () => void) {
  return render(<RoleTonight lobby={view} viewer={viewer} onViewerChanged={onViewerChanged} />);
}

const linked: ViewerState = { kind: 'linked', puuid: ME, isAdmin: false };

/** The route answered. `ok: false` carries the envelope every route in this app uses. */
function answers(body: unknown, ok = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response),
  );
}

function lastBody(): unknown {
  const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
  return JSON.parse(String(calls[calls.length - 1]?.[1]?.body));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the role control, for a linked viewer in tonight’s lobby', () => {
  it('draws the five roles under product’s heading, with the sentence that says it is a preference', () => {
    draw(linked, lobby());

    expect(screen.getByText(ROLE_CONTROL_HEADING)).toBeInTheDocument();
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'top',
      'jungle',
      'mid',
      'adc',
      'support',
    ]);
    expect(screen.getByText(ROLE_CONTROL_HINT)).toBeInTheDocument();
    // `open`: there is nothing to say about teams that do not exist yet.
    expect(screen.queryByText(ROLE_SAVED_FOR_NEXT_GAME)).not.toBeInTheDocument();
  });

  it('posts the role that was pressed, marks it chosen, and never navigates', async () => {
    answers({ ok: true, puuid: ME, role: 'jungle', status: 'open', savedForNextGame: false });
    draw(linked, lobby());

    const jungle = screen.getByRole('button', { name: 'jungle' });
    // False means the click's default was prevented: with JavaScript the form never submits,
    // so no document loads and the URL does not change (M3.20).
    expect(fireEvent.click(jungle)).toBe(false);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(lastBody()).toEqual({ lobbyId: 'lobby-1', role: 'jungle' });
    // The receipt is the word itself, optimistically, before the write comes back round
    // through Realtime. No toast and no "saved!".
    await waitFor(() => expect(jungle).toHaveAttribute('aria-pressed', 'true'));
    // The control survives its own success — nothing here unmounts — which is what keeps the
    // keyboard focus on the word that was pressed (M3.20). jsdom does not move focus on a
    // synthetic click, so the focus itself is checked in a browser.
    expect(jungle).toBeInTheDocument();
  });

  it('clears the override when the chosen role is pressed again', async () => {
    answers({ ok: true, puuid: ME, role: null, status: 'open', savedForNextGame: false });
    const members = workedMembers(4);
    const mine = members[0];
    if (mine !== undefined) members[0] = { ...mine, roleOverride: 'jungle' };
    draw(linked, lobby({ members }));

    const jungle = screen.getByRole('button', { name: 'jungle' });
    expect(jungle).toHaveAttribute('aria-pressed', 'true');
    // The only way out, and there is no separate Clear button.
    fireEvent.click(jungle);

    await waitFor(() => expect(lastBody()).toEqual({ lobbyId: 'lobby-1', role: null }));
    await waitFor(() => expect(jungle).toHaveAttribute('aria-pressed', 'false'));
  });

  it('says the teams are already set from `balanced` on, and still stores the tap', async () => {
    answers({ ok: true, puuid: ME, role: 'top', status: 'balanced', savedForNextGame: true });
    draw(linked, lobby({ status: 'balanced' }));

    expect(screen.getByText(ROLE_SAVED_FOR_NEXT_GAME)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'top' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  });

  it('prints the route’s own sentence beside the control and puts the word back', async () => {
    answers({ ok: false, error: 'That lobby is over. Nothing to set a role on.' }, false);
    draw(linked, lobby());

    const mid = screen.getByRole('button', { name: 'mid' });
    fireEvent.click(mid);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('That lobby is over. Nothing to set a role on.'),
    );
    // Not a banner at the top of the page and not in the query string (M3.20), and the word
    // that was pressed is not left looking chosen.
    expect(mid).toHaveAttribute('aria-pressed', 'false');
  });

  it('says so when the request never reached the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    draw(linked, lobby());
    fireEvent.click(screen.getByRole('button', { name: 'adc' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(ROLE_TAP_OFFLINE));
  });

  it('draws for a sitter, who may well be in the next game', () => {
    const sitter = extraMember({ puuid: ME });
    draw(linked, lobby({ members: [...workedMembers(4), sitter] }));

    expect(screen.getByText(ROLE_CONTROL_HEADING)).toBeInTheDocument();
  });
});

describe('when there is nothing to tap', () => {
  it('draws nothing for a linked viewer who is not in tonight’s lobby', () => {
    const { container } = draw({ kind: 'linked', puuid: 'somebody-else', isAdmin: false }, lobby());

    expect(container).toBeEmptyDOMElement();
  });

  it('draws nothing once the game is over, or with no lobby at all', () => {
    expect(draw(linked, lobby({ status: 'finished' })).container).toBeEmptyDOMElement();
    expect(draw(linked, null).container).toBeEmptyDOMElement();
  });

  it('draws nothing for a signed-out reader on the idle page: reading is never gated', () => {
    expect(draw({ kind: 'anonymous' }, null).container).toBeEmptyDOMElement();
  });
});

describe('signed out, with a lobby up', () => {
  it('offers the one control that starts the Discord round trip, back to the tonight page', () => {
    const { container } = draw({ kind: 'anonymous' }, lobby());

    expect(screen.getByRole('button', { name: ROLE_SIGN_IN })).toBeInTheDocument();
    expect(container.querySelector('form')).toHaveAttribute('action', '/auth/signin');
    // Not `/admin`, which is where a sign-in with no destination lands.
    expect(container.querySelector('input[name="next"]')).toHaveValue('/');
  });
});

describe('signed in with no player row: picking yourself, once', () => {
  const visitor: ViewerState = { kind: 'unlinked' };

  it('offers tonight’s members, each with `That’s me`, under product’s question', () => {
    draw(visitor, lobby());

    expect(screen.getByText(PICK_YOURSELF)).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(4);
    // The visible label is the same four words on every row; the name is what a listener
    // moving button to button needs.
    expect(screen.getAllByRole('button')[0]).toHaveAccessibleName(`${THATS_ME}: Bilal`);
  });

  it('posts the puuid, never navigates, and asks the page to re-read who the viewer is', async () => {
    answers({ ok: true, puuid: ME });
    const refreshed = vi.fn();
    draw(visitor, lobby(), refreshed);

    expect(fireEvent.click(screen.getAllByRole('button')[0] as Element)).toBe(false);

    await waitFor(() => expect(lastBody()).toEqual({ puuid: ME }));
    // `players.discord_id` is in no Realtime publication and the browser may not read it, so
    // the server components are the only place that answer can come from.
    await waitFor(() => expect(refreshed).toHaveBeenCalledTimes(1));
  });

  it('prints the route’s sentence when somebody is already linked to that player', async () => {
    answers({ ok: false, error: 'Someone is already linked to that player.' }, false);
    draw(visitor, lobby());

    fireEvent.click(screen.getAllByRole('button')[0] as Element);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Someone is already linked to that player.'),
    );
  });

  it('asks nothing when there is nobody to pick', () => {
    draw(visitor, null);

    expect(screen.getByText(SIGNED_IN_NO_LOBBY)).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
