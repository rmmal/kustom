import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { WindowKind } from '@/lib/night';
import { FIRST_BLOOD_EMPTY, FIRST_BLOOD_NOTE, FUN_LABEL } from '@/lib/stats/funCopy';
import { assembleFunFacts } from '@/lib/stats/funView';
import type { FunFactsView } from '@/lib/stats/types';
import { rosterFor, tenPlayerGame } from '@/lib/testing/statsFixtures';
import { FunView } from './FunView';

const MONTH = { start: new Date('2026-09-01T03:00:00Z'), end: new Date('2026-10-01T03:00:00Z') };

function view(options: { window?: WindowKind } = {}): FunFactsView {
  const game = tenPlayerGame({
    at: '2026-09-02T20:00:00Z',
    durationS: 1_800,
    winner: 100,
    blue: [{ key: 'lena', role: 'adc', kills: 12, deaths: 2, assists: 8, cs: 240, damageToChamps: 20_000 }],
  });
  return assembleFunFacts({
    window: options.window ?? 'this-month',
    games: [game],
    players: rosterFor([game]),
    range: MONTH,
    capped: false,
    cap: 2_000,
    timeZone: 'Africa/Cairo',
  });
}

describe('FunView', () => {
  it('names the window and the page', () => {
    render(<FunView facts={view()} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(`This month ${FUN_LABEL}`);
    expect(screen.getByText(FIRST_BLOOD_NOTE)).toBeInTheDocument();
    expect(screen.getByText(FIRST_BLOOD_EMPTY)).toBeInTheDocument();
  });

  it('links a record holder to their page', () => {
    render(<FunView facts={view()} />);
    expect(screen.getAllByRole('link', { name: 'Lena' })[0]).toHaveAttribute('href', '/p/u-lena');
  });

  it('keeps a record name, number and date as separate cells', () => {
    render(<FunView facts={view()} />);
    expect(screen.getAllByRole('link', { name: 'Lena' })[0]).toHaveTextContent(/^Lena$/);
    expect(screen.getByText('Highest CS')).toBeInTheDocument();
    expect(screen.getByText('Most kills')).toBeInTheDocument();
    expect(screen.getAllByText('12/2/8').length).toBeGreaterThan(0);
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
