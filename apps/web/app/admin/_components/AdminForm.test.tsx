import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminForm } from './AdminForm';

/**
 * M3.20: every write on `/admin` happens in place.
 *
 * What this pins is the part a browser check cannot: the request that goes out is the same
 * object the no-JS form post would have sent, the answer is rendered **inside the form**, a
 * refusal prints the route's own sentence, and the default form submit — the thing that
 * navigates — is cancelled. The "the `load` event count stays 1" half is checked in a real
 * browser, because jsdom does not navigate on a form submit at all.
 */

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

function draw() {
  return render(
    <AdminForm action="/api/admin/players" kind="players">
      <input type="hidden" name="action" value="set-name" />
      <input type="hidden" name="playerId" value="player-1" />
      <input type="text" name="displayName" defaultValue="Hana" aria-label="Name" />
      <button type="submit">Save</button>
    </AdminForm>,
  );
}

function answer(body: unknown, ok = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response),
  );
}

beforeEach(() => {
  refresh.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a save', () => {
  it('posts the form values as JSON to the same route, and never navigates', async () => {
    answer({ ok: true, action: 'set-name', playerId: 'player-1' });
    draw();

    const submitted = fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form') as Node);
    // The browser's own submit — the one that loads a document — is cancelled.
    expect(submitted).toBe(false);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [url, init] =
      (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0] ?? [];
    expect(url).toBe('/api/admin/players');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      action: 'set-name',
      playerId: 'player-1',
      displayName: 'Hana',
    });
  });

  it('renders its notice inside the form, beside the control, and re-reads the row', async () => {
    answer({ ok: true, action: 'set-name', playerId: 'player-1' });
    const { container } = draw();

    fireEvent.submit(container.querySelector('form') as Node);

    await waitFor(() => expect(screen.getByText('name saved: Hana')).toBeInTheDocument());
    // Inside the form: not a banner at the top of the page.
    expect(container.querySelector('form')?.contains(screen.getByText('name saved: Hana'))).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('leaves the button focused, because nothing was disabled and nothing navigated', async () => {
    answer({ ok: true, action: 'set-name', playerId: 'player-1' });
    draw();

    const button = screen.getByRole('button', { name: 'Save' });
    button.focus();
    fireEvent.submit(button.closest('form') as Node);

    await waitFor(() => expect(screen.getByText('name saved: Hana')).toBeInTheDocument());
    expect(document.activeElement).toBe(button);
    expect(button).toBeEnabled();
  });

  it('keeps the plain form post as the no-JavaScript path', () => {
    const { container } = draw();
    const form = container.querySelector('form');

    expect(form).toHaveAttribute('method', 'post');
    expect(form).toHaveAttribute('action', '/api/admin/players');
  });
});

describe('a refusal', () => {
  it('prints the route’s own sentence, inline, and does not re-read', async () => {
    answer({ ok: false, error: 'that player is not yours to rename' }, false);
    const { container } = draw();

    fireEvent.submit(container.querySelector('form') as Node);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('that player is not yours to rename'),
    );
    expect(refresh).not.toHaveBeenCalled();
    // Never in the query string: this page never navigated.
    expect(window.location.search).toBe('');
  });

  it('says something true when the request never reached the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    const { container } = draw();

    fireEvent.submit(container.querySelector('form') as Node);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('minting a token', () => {
  it('shows the raw token, because with JavaScript on there is no one-time page', async () => {
    answer({ ok: true, action: 'mint', token: 'cnt_live_secret' });
    render(
      <AdminForm action="/api/admin/tokens" kind="tokens">
        <input type="hidden" name="action" value="mint" />
        <button type="submit">Mint token</button>
      </AdminForm>,
    );

    fireEvent.submit(screen.getByRole('button', { name: 'Mint token' }).closest('form') as Node);

    await waitFor(() => expect(screen.getByText('token minted')).toBeInTheDocument());
    expect(screen.getByText(/cnt_live_secret/)).toBeInTheDocument();
    expect(screen.getByText(/Copy it now/)).toBeInTheDocument();
  });
});
