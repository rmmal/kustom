import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { snapshot } from '@/lib/testing/tonightFixtures';
import type { LobbyStartView } from '@/lib/tonight/lobbyStart';
import type { ViewerState } from '@/lib/tonight/viewer';

/**
 * The one timer on the tonight page that is not a Realtime subscription (M4.2's control).
 *
 * `companion_commands` has no RLS policy and is in no publication, so the browser can neither
 * read tonight's `create_lobby` nor be told that it moved. The page therefore asks its own
 * server components again every five seconds **while the command is live**, and stops the
 * moment it settles — a timer that outlived the command would re-render this page for the rest
 * of the night, which is the failure mode this file exists to catch.
 */

const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

/** No socket in a component test: the channel is a stub that never fires and never subscribes. */
vi.mock('@/lib/publicClient', () => ({
  createPublicClient: () => ({
    channel: () => ({
      on() {
        return this;
      },
      subscribe() {
        return this;
      },
    }),
    removeChannel: () => Promise.resolve('ok'),
  }),
}));

vi.mock('@/lib/tonight/load', () => ({
  loadTonight: vi.fn(async () => snapshot(null)),
}));

const { TonightLive } = await import('./TonightLive');

const admin: ViewerState = { kind: 'linked', puuid: 'puuid-hamoodi', isAdmin: true };

function start(status: LobbyStartView['status']): LobbyStartView {
  return {
    status,
    error: status === 'failed' ? 'expired' : null,
    hostName: 'Hamoodi',
    lobbyName: 'Customs 10 Sep #1',
    lobbyPassword: '4821',
    invited: 0,
  };
}

function draw(lobbyStart: LobbyStartView | null) {
  return render(
    <TonightLive initial={snapshot(null)} viewer={admin} topPlayers={[]} lobbyStart={lobbyStart} />,
  );
}

/** Five seconds, the companion's own poll interval (`START_POLL_MS`). */
const TICK = 5_000;

beforeEach(() => {
  refresh.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the create_lobby poll', () => {
  it('runs while the command is pending, and again while it is sent', () => {
    const { unmount } = draw(start('pending'));

    act(() => vi.advanceTimersByTime(TICK * 2));
    expect(refresh).toHaveBeenCalledTimes(2);
    unmount();

    refresh.mockClear();
    draw(start('sent'));
    act(() => vi.advanceTimersByTime(TICK));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not run at all on a night nobody pressed the button', () => {
    draw(null);

    act(() => vi.advanceTimersByTime(TICK * 4));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('stops the moment the row settles, acked or failed', () => {
    for (const settled of ['acked', 'failed'] as const) {
      refresh.mockClear();
      const { unmount } = draw(start(settled));

      act(() => vi.advanceTimersByTime(TICK * 4));
      expect(refresh, settled).not.toHaveBeenCalled();
      unmount();
    }
  });

  it('clears the timer when the page goes away, so it cannot outlive the command', () => {
    const { unmount } = draw(start('pending'));

    act(() => vi.advanceTimersByTime(TICK));
    expect(refresh).toHaveBeenCalledTimes(1);

    unmount();
    act(() => vi.advanceTimersByTime(TICK * 4));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
