import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NO_MORE_SPLITS } from '@/lib/admin/reroll';
import { NO_ACTIVE_SEASON_MESSAGE, NO_ACTIVE_SEASON_TONIGHT_MESSAGE } from '@/lib/season';
import {
  extraMember,
  lobbyView,
  offRoleFixture,
  snapshot,
  workedMembers,
  workedResult,
  workedTeams,
} from '@/lib/testing/tonightFixtures';
import { IDLE_SENTENCE, NAMELESS_HINT } from '@/lib/tonight/copy';
import type { TonightSnapshot } from '@/lib/tonight/types';
import { TonightView } from './TonightView';

/**
 * The tonight page's three states plus the result, from fixture data (M3.4).
 *
 * The acceptance checks these stand in for are the ones a night cannot be run to re-check:
 * the copy is product's word for word, the sit-out strip is *above* the cards, a `-0` prints
 * as `(−0)`, and the reroll control exists only for an admin and only while there is a split
 * left to promote. Realtime itself is exercised against the local stack by hand.
 */

function draw(state: TonightSnapshot, viewer: { puuid?: string; isAdmin?: boolean } = {}) {
  return render(
    <TonightView snapshot={state} viewerPuuid={viewer.puuid ?? null} isAdmin={viewer.isAdmin ?? false} />,
  );
}

describe('idle: no lobby tonight', () => {
  it('is the header strip, one sentence and a link, and nothing else', () => {
    draw(snapshot(null));

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Nothing tonight');
    // M1.10's sentence, unchanged word for word: the wording does not move under people.
    expect(screen.getByText(IDLE_SENTENCE)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Last night and the board' })).toHaveAttribute(
      'href',
      '/leaderboard',
    );
    // The strip is a label, not a sentence: the body must not say "Nothing tonight" twice.
    expect(screen.queryByText(/Nothing tonight yet/)).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('says nothing about a season when one is active, and its own sentence when none is', () => {
    const { unmount } = draw(snapshot(null));
    expect(screen.queryByText(NO_ACTIVE_SEASON_TONIGHT_MESSAGE)).not.toBeInTheDocument();
    unmount();

    draw(snapshot(null, { seasonActive: false }));
    expect(screen.getByText(NO_ACTIVE_SEASON_TONIGHT_MESSAGE)).toBeInTheDocument();
    // Never the admin sentence: it ends by naming a page most of the group cannot open (M3.17).
    expect(screen.queryByText(NO_ACTIVE_SEASON_MESSAGE)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Start a season on the Seasons page.');
  });

  it('puts the no-season line directly under the header strip, not at the foot of the page', () => {
    const { container } = draw(
      snapshot(lobbyView({ status: 'balanced', teams: workedTeams() }), { seasonActive: false }),
    );

    const main = container.querySelector('.cn-page');
    expect([...(main?.children ?? [])].map((child) => child.className)).toEqual([
      'cn-strip',
      'cn-notice',
      'cn-block',
    ]);
  });

  it('carries the no-season line in every state, and in none of them when a season is live', () => {
    const states = [
      snapshot(null),
      snapshot(lobbyView({ members: workedMembers(3) })),
      snapshot(lobbyView({ status: 'balanced', teams: workedTeams() })),
      snapshot(lobbyView({ status: 'finished', teams: workedTeams(), result: workedResult() })),
    ];

    for (const state of states) {
      const live = draw(state);
      expect(screen.queryByText(NO_ACTIVE_SEASON_TONIGHT_MESSAGE)).not.toBeInTheDocument();
      live.unmount();

      const without = draw({ ...state, seasonActive: false });
      expect(screen.getByText(NO_ACTIVE_SEASON_TONIGHT_MESSAGE)).toBeInTheDocument();
      without.unmount();
    }
  });
});

describe('filling: the lobby is open', () => {
  it('counts the people around and lists them in join order with their ratings', () => {
    draw(snapshot(lobbyView({ members: workedMembers(3) })));

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('3 in the lobby');
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      'Bilaladc / mid1713',
      'Hanatop / mid1434',
      'Irisjungle / top1578',
    ]);
  });

  it('has an empty state that is one sentence, not a spinner', () => {
    draw(snapshot(lobbyView({ members: [] })));

    expect(screen.getByText('Nobody in the lobby yet.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('0 in the lobby');
  });

  it('puts the eleventh person under the Around hairline, not among the ten', () => {
    draw(snapshot(lobbyView({ members: [...workedMembers(), extraMember()] })));

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('11 in the lobby');
    const lists = screen.getAllByRole('list');
    expect(lists).toHaveLength(2);
    expect(within(lists[1] as HTMLElement).getByText('Deniz')).toBeInTheDocument();
    expect(screen.getByText('Around')).toBeInTheDocument();
  });

  it('shows no teams, no prediction and no countdown before the balance', () => {
    draw(snapshot(lobbyView({ members: workedMembers(9) })));

    expect(screen.queryByText('Blue')).not.toBeInTheDocument();
    expect(screen.queryByText(/favored/)).not.toBeInTheDocument();
    expect(screen.queryByText(/waiting/i)).not.toBeInTheDocument();
  });

  it('marks a member who joined in the last three seconds, and lets it fade', async () => {
    const [first, ...rest] = workedMembers();
    if (first === undefined) throw new Error('no member');
    const { container } = draw(
      snapshot(lobbyView({ members: [{ ...first, joinedAt: new Date().toISOString() }, ...rest] })),
    );

    // The marker is always in the DOM — only its opacity changes — so the row never resizes.
    expect(container.querySelectorAll('.cn-new')).toHaveLength(10);
    await waitFor(() => expect(container.querySelectorAll('.cn-new-on')).toHaveLength(1));
    expect(container.querySelectorAll('.cn-new-on')[0]?.closest('li')).toHaveTextContent('Bilal');
  });

  it('marks nobody when the lobby filled up minutes ago', () => {
    const { container } = draw(snapshot(lobbyView({ members: workedMembers() })));
    expect(container.querySelectorAll('.cn-new-on')).toHaveLength(0);
  });

  it('marks the signed-in viewer, and nobody else', () => {
    const { container } = draw(snapshot(lobbyView({ members: workedMembers() })), {
      puuid: 'puuid-hana',
    });

    const mine = container.querySelectorAll('.cn-you');
    expect(mine).toHaveLength(1);
    expect(mine[0]).toHaveTextContent('Hana');
  });
});

describe('teams: balanced and in_game are the same block', () => {
  const balanced = snapshot(lobbyView({ status: 'balanced', teams: workedTeams() }));

  it('renders the promoted split verbatim, blue first, in lane order', () => {
    const { container } = draw(balanced);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Teams set');
    const cards = container.querySelectorAll('.cn-card');
    expect(cards).toHaveLength(2);

    const blue = cards[0] as HTMLElement;
    expect(within(blue).getByRole('heading', { level: 2 })).toHaveTextContent('Blue');
    expect(within(blue).getByText('7695')).toBeInTheDocument();
    expect(
      within(blue)
        .getAllByRole('listitem')
        .map((row) => row.textContent),
    ).toEqual(['topHana1434', 'jungleIris1578', 'midKarim1551', 'adcBilal1713', 'supportTheo1419']);
  });

  it('prints the stored explanation as one paragraph, never recomposed', () => {
    const { container } = draw(balanced);

    expect(container.querySelector('.cn-explain-text')).toHaveTextContent(
      'Blue favored 54%. Everyone on a main role. Gap 100. Next best: swap Hana and Omar, gap 170.',
    );
  });

  it('changes only the header word between balanced and in_game', () => {
    const { container: first } = draw(balanced);
    const balancedCards = first.querySelector('.cn-cards')?.innerHTML;

    const { container: second } = draw(snapshot(lobbyView({ status: 'in_game', teams: workedTeams() })));
    expect(screen.getAllByRole('heading', { level: 1 })[1]).toHaveTextContent('In game');
    expect(second.querySelector('.cn-cards')?.innerHTML).toBe(balancedCards);
  });

  it('marks every off-role row, in words and not only in colour, and says so in the sentence', () => {
    // Ten friends who all main mid: `balance()` has to put nine of them somewhere else, and
    // the stored explanation says which (M3.7).
    const offRole = offRoleFixture();
    const marked = [...offRole.teams.blue, ...offRole.teams.red].filter((seat) => seat.offRole);
    expect(marked.length).toBeGreaterThan(0);

    const { container } = draw(
      snapshot(lobbyView({ status: 'balanced', members: offRole.members, teams: offRole.teams })),
    );

    expect(container.querySelectorAll('.cn-off')).toHaveLength(marked.length);
    expect(screen.getAllByText('off-role')).toHaveLength(marked.length);
    // The clause is the stored string's, rendered verbatim: `N off-role: Name at role, ...`.
    expect(container.querySelector('.cn-explain-text')?.textContent).toContain(`${marked.length} off-role:`);
  });
});

describe('the sit-out strip', () => {
  const eleven = snapshot(
    lobbyView({
      status: 'balanced',
      members: [...workedMembers(), extraMember()],
      teams: workedTeams({ sitters: [extraMember()] }),
    }),
  );

  it('sits above the cards: what is under it is not about the person sitting', () => {
    const { container } = draw(eleven);
    const blocks = [...container.querySelectorAll('.cn-sitout, .cn-cards, .cn-explain')].map(
      (element) => element.className,
    );

    expect(blocks).toEqual(['cn-sitout', 'cn-cards', 'cn-explain']);
  });

  it('reads the general sentence for everybody who is not sitting', () => {
    draw(eleven);

    expect(
      screen.getByText(
        'Sitting out this game: Deniz. Each game goes to whoever has played least tonight, so they are first in line for the next one.',
      ),
    ).toBeInTheDocument();
  });

  it('reads the second-person one for the viewer who is sitting, and nobody else changes', () => {
    draw(eleven, { puuid: 'puuid-deniz' });

    expect(
      screen.getByText(
        'You are sitting this one out. Each game goes to whoever has played least tonight, so you are first in line for the next one.',
      ),
    ).toBeInTheDocument();
  });

  it('is absent when ten are around and nobody sits', () => {
    const { container } = draw(snapshot(lobbyView({ status: 'balanced', teams: workedTeams() })));
    expect(container.querySelector('.cn-sitout')).toBeNull();
  });
});

describe('result: the game is over', () => {
  const finished = snapshot(lobbyView({ status: 'finished', teams: workedTeams(), result: workedResult() }));

  it('leads with the winner, the duration and the prediction it made before the game', () => {
    draw(finished);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Final');
    expect(screen.getByText('Red wins')).toBeInTheDocument();
    expect(screen.getByText('34:12')).toBeInTheDocument();
    expect(screen.getByText('Blue was favored 54%.')).toBeInTheDocument();
    expect(screen.getByText(/Top damage: Lena/)).toBeInTheDocument();
  });

  it('prints one rating per player: the after number and its delta, and no second pair of cards', () => {
    const { container } = draw(finished);

    expect(container.querySelectorAll('.cn-card')).toHaveLength(2);
    const blue = container.querySelectorAll('.cn-card')[0] as HTMLElement;
    expect(
      within(blue)
        .getAllByRole('listitem')
        .map((row) => row.textContent),
    ).toEqual([
      'topHana1393 (−41)',
      'jungleIris1531 (−47)',
      'midKarim1508 (−43)',
      'adcBilal1668 (−45)',
      'supportTheo1372 (−47)',
    ]);
  });

  it('keeps the sign on a change too small to round: (−0), never (0) and never (+0)', () => {
    // A rating that fell by less than half a point. `displayDelta` answers -0, which does not
    // survive JSON — this is why the delta is computed where it is rendered (05-design.md).
    const result = workedResult();
    const seat = result.blue[0];
    if (seat === undefined) throw new Error('no seat');
    const nudged = { ...result, blue: [{ ...seat, muBefore: 25, muAfter: 24.999 }, ...result.blue.slice(1)] };

    const { container } = draw(
      snapshot(lobbyView({ status: 'finished', teams: workedTeams(), result: nudged })),
    );

    const row = container.querySelector('.cn-card .cn-seat');
    expect(row?.textContent).toContain('1500 (−0)');
    // Never `(0)`: one unsigned entry in a column of ten signed ones reads as a bug.
    expect(container.textContent).not.toContain('(0)');
    expect(container.textContent).not.toContain('(+0)');
  });

  it('prints no side sums: a team total of deltas must not be computable from the screen', () => {
    const { container } = draw(finished);

    // The teams block has them; the result card does not (05-design.md, "Result card").
    expect(container.querySelectorAll('.cn-sum')).toHaveLength(0);
    expect(screen.queryByText('6465')).not.toBeInTheDocument();
  });

  it('keeps the explanation line of the split they played under the result', () => {
    const { container } = draw(finished);
    expect(container.querySelector('.cn-explain-text')).toHaveTextContent('Blue favored 54%.');
  });

  it('shows the teams and no deltas for a game the fold did not rate', () => {
    const unrated = workedResult({ rated: false });
    const { container } = draw(
      snapshot(lobbyView({ status: 'finished', teams: workedTeams(), result: unrated })),
    );

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Final');
    expect(container.querySelector('.cn-delta')).toBeNull();
    expect(screen.queryByText(/did not count/i)).not.toBeInTheDocument();
    // The teams they played are still up, with their before ratings.
    expect(screen.getByText('1434')).toBeInTheDocument();
  });
});

describe('a player the database has no name for', () => {
  const nameless = workedMembers().map((member, index) => (index === 0 ? { ...member, name: null } : member));

  it('renders Someone, with one hint line under the block and never one per row', () => {
    draw(snapshot(lobbyView({ members: nameless })));

    expect(screen.getAllByText('Someone')).toHaveLength(1);
    expect(screen.getAllByText(NAMELESS_HINT)).toHaveLength(1);
  });

  it('drops the hint as soon as every row has a name', () => {
    draw(snapshot(lobbyView({ members: workedMembers() })));
    expect(screen.queryByText(NAMELESS_HINT)).not.toBeInTheDocument();
  });
});

describe('the reroll control', () => {
  const balanced = (chosen: number) =>
    snapshot(lobbyView({ status: 'balanced', teams: workedTeams({ chosen }) }));

  it('is not drawn for a reader with no session', () => {
    draw(balanced(0));
    expect(screen.queryByRole('button', { name: 'Reroll' })).not.toBeInTheDocument();
  });

  it('is drawn for an admin and names the next split down the list', () => {
    const { container } = draw(balanced(0), { isAdmin: true });

    expect(screen.getByRole('button', { name: 'Reroll' })).toBeEnabled();
    expect(container.querySelector('form')).toHaveAttribute('action', '/api/admin/lobbies/lobby-1/reroll');
    expect(container.querySelector('input[name="splitId"]')).toHaveValue('split-2');
  });

  it('is disabled on the last split, with the sentence for the friend who presses again', () => {
    draw(balanced(2), { isAdmin: true });

    expect(screen.getByRole('button', { name: 'Reroll' })).toBeDisabled();
    expect(screen.getByText(NO_MORE_SPLITS)).toBeInTheDocument();
  });

  it('is not drawn once the game has started: the teams on the rift are the teams', () => {
    draw(snapshot(lobbyView({ status: 'in_game', teams: workedTeams() })), { isAdmin: true });
    expect(screen.queryByRole('button', { name: 'Reroll' })).not.toBeInTheDocument();
  });
});
