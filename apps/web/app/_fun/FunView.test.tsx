import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { QueueKind } from '@/lib/games/queue';
import type { WindowKind } from '@/lib/night';
import { FIRST_BLOOD_EMPTY, FIRST_BLOOD_TITLE, FUN_LABEL, THIS_GAME } from '@/lib/stats/funCopy';
import { assembleFunFacts } from '@/lib/stats/funView';
import type { FunFactsView } from '@/lib/stats/types';
import { rosterFor, tenPlayerGame } from '@/lib/testing/statsFixtures';
import { FunView } from './FunView';

const MONTH = { start: new Date('2026-09-01T03:00:00Z'), end: new Date('2026-10-01T03:00:00Z') };

function view(
  options: { window?: WindowKind; queue?: QueueKind; gameMode?: string | null } = {},
): FunFactsView {
  const game = tenPlayerGame({
    at: '2026-09-02T20:00:00Z',
    durationS: 1_800,
    winner: 100,
    ...(options.gameMode === undefined ? {} : { gameMode: options.gameMode }),
    blue: [
      {
        key: 'lena',
        role: 'adc',
        championId: 103,
        kills: 12,
        deaths: 2,
        assists: 8,
        cs: 240,
        damageToChamps: 20_000,
      },
    ],
  });
  return assembleFunFacts(
    {
      window: options.window ?? 'this-month',
      games: [game],
      players: rosterFor([game]),
      range: MONTH,
      capped: false,
      cap: 2_000,
      timeZone: 'Africa/Cairo',
    },
    options.queue,
  );
}

describe('FunView', () => {
  it('names the window and the page', () => {
    render(<FunView facts={view()} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(`This month ${FUN_LABEL}`);
    expect(screen.getByText(FIRST_BLOOD_TITLE)).toBeInTheDocument();
    expect(screen.getByText(FIRST_BLOOD_EMPTY)).toBeInTheDocument();
    expect(screen.queryByText(/we do not store it/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Vision score is not stored/i)).not.toBeInTheDocument();
  });

  it('links a record holder to their page', () => {
    render(<FunView facts={view()} />);
    expect(screen.getAllByRole('link', { name: 'Lena' })[0]).toHaveAttribute('href', '/p/u-lena');
  });

  it('opens the counted custom under a one-game record', () => {
    const { container } = render(<FunView facts={view()} />);
    const mostKills = screen.getByText('Most kills').closest('.cn-role-block');
    expect(mostKills).not.toBeNull();
    const card = mostKills?.querySelector('details');
    expect(card).not.toBeNull();
    expect(card).not.toHaveAttribute('open');
    expect(within(mostKills as HTMLElement).getByText(THIS_GAME)).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText('Blue · 12')).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText('Ahri')).toBeInTheDocument();
    expect(container.querySelectorAll('details').length).toBeGreaterThan(0);
  });

  it('keeps a record name, number and date as separate cells', () => {
    render(<FunView facts={view()} />);
    expect(screen.getAllByRole('link', { name: 'Lena' })[0]).toHaveTextContent(/^Lena$/);
    expect(screen.getByText('Highest CS')).toBeInTheDocument();
    expect(screen.getByText('Most kills')).toBeInTheDocument();
    expect(screen.getAllByText('12/2/8').length).toBeGreaterThan(0);
  });

  it('defaults to Rift and keeps the window when switching to ARAM', () => {
    render(<FunView facts={view()} />);
    expect(screen.getByRole('link', { name: "Summoner's Rift" })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'ARAM' })).toHaveAttribute(
      'href',
      '/fun?window=this-month&queue=aram',
    );
  });

  it('names a first-blood taker from the stored block', () => {
    const game = tenPlayerGame({
      at: '2026-09-02T20:00:00Z',
      durationS: 1_800,
      winner: 100,
      blue: [{ key: 'lena', role: 'adc', championId: 103, kills: 4, deaths: 1, assists: 2 }],
      rawFacts: {
        byPuuid: {
          'u-lena': {
            firstBloodKill: true,
            firstBloodAssist: false,
            visionScore: null,
            objectivesStolen: 0,
            objectivesStolenAssists: 0,
            baronKills: 0,
            dragonKills: 0,
            longestLivedS: null,
            championName: 'Ahri',
          },
        },
        bans: [],
      },
    });
    const facts = assembleFunFacts({
      window: 'this-month',
      games: [game],
      players: rosterFor([game]),
      range: MONTH,
      capped: false,
      cap: 2_000,
      timeZone: 'Africa/Cairo',
    });
    render(<FunView facts={facts} />);
    expect(screen.getAllByText('Ahri').length).toBeGreaterThan(0);
    expect(screen.queryByText(FIRST_BLOOD_EMPTY)).not.toBeInTheDocument();
  });

  it('hides CS by role on ARAM', () => {
    render(<FunView facts={view({ queue: 'aram', gameMode: 'ARAM' })} />);
    expect(screen.getByRole('link', { name: 'ARAM' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: "Summoner's Rift" })).toHaveAttribute(
      'href',
      '/fun?window=this-month',
    );
    expect(screen.getByRole('link', { name: 'Last month' })).toHaveAttribute(
      'href',
      '/fun?window=last-month&queue=aram',
    );
    expect(screen.queryByText('CS by role')).not.toBeInTheDocument();
    expect(screen.queryByText('Objective Thief')).not.toBeInTheDocument();
    expect(screen.getByText('Most kills')).toBeInTheDocument();
  });

  it('draws nothing under the strip on an empty window', () => {
    const empty = assembleFunFacts({
      window: 'last-week',
      games: [],
      players: [],
      range: { start: new Date('2026-08-31T03:00:00Z'), end: new Date('2026-09-07T03:00:00Z') },
      capped: false,
      cap: 2_000,
      timeZone: 'Africa/Cairo',
    });
    render(<FunView facts={empty} />);
    expect(screen.queryByText('CS by role')).not.toBeInTheDocument();
  });
});
