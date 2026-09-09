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
import { ALL_FLEXIBLE_HINT, IDLE_SENTENCE, NAMELESS_HINT } from '@/lib/tonight/copy';
import type { TonightSnapshot } from '@/lib/tonight/types';
import { TonightView } from './TonightView';

/**
 * The tonight page's states, from fixture data (M3.4, restyled by M3.18).
 *
 * The acceptance checks these stand in for are the ones a night cannot be run to re-check: the
 * copy is product's word for word, the rack is ten rows at every count, the sit-out strip is
 * *above* the cards, a `-0` prints as `(−0)`, and the reroll control exists only for an admin
 * and only while there is a split left to promote. Realtime itself is exercised against the
 * local stack by hand.
 *
 * The page has **no `<h1>`**: the one heading is the shell's wordmark, so the strip's headline
 * is a `<p>` and every assertion here reads text rather than a heading role.
 */

function draw(state: TonightSnapshot, viewer: { puuid?: string; isAdmin?: boolean } = {}) {
  return render(
    <TonightView snapshot={state} viewerPuuid={viewer.puuid ?? null} isAdmin={viewer.isAdmin ?? false} />,
  );
}

/**
 * The strip's three lines, in order, as a reader sees them. A line's own parts are joined with
 * a space: the count, the headline and the live pill are three elements with no whitespace
 * between them in the markup, and `11IN THE LOBBYlive` is not what anybody reads.
 */
function strip(container: HTMLElement): string[] {
  return [...(container.querySelector('.cn-strip')?.children ?? [])].map((line) => {
    const parts =
      line.childElementCount === 0
        ? [line.textContent ?? '']
        : [...line.querySelectorAll(':scope > *')].map((part) => part.textContent ?? '');
    return parts
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .join(' ');
  });
}

describe('idle: no lobby tonight', () => {
  it('says the night, the state and the shipped sentence, and shows an empty rack', () => {
    const { container } = draw(snapshot(null));

    expect(strip(container)).toEqual(['Tuesday 8 September · Season 1', 'NOBODY IN YET', IDLE_SENTENCE]);
    // The rack is the idle page's body: ten `open` seats, the shape the page will have later.
    expect(container.querySelectorAll('.cn-rack-open')).toHaveLength(10);
    expect(screen.getByText('SEATS · 0 of 10')).toBeInTheDocument();
    // The v1 idle link is gone: `Leaderboard` is a tab in the shell. One destination, one place.
    expect(screen.queryByText('Last night and the board')).not.toBeInTheDocument();
    // Nothing is rendered under the rack at zero: the fact is said once, in the strip.
    expect(screen.queryByText('Nobody in the lobby yet.')).not.toBeInTheDocument();
    expect(screen.queryByText(ALL_FLEXIBLE_HINT)).not.toBeInTheDocument();
  });

  it('carries the two cards inline, because there is nothing else to read', () => {
    draw(snapshot(null));

    expect(screen.getAllByText('How this works').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Run the companion').length).toBeGreaterThan(0);
  });

  it('says nothing about a season when one is active, and its own sentence when none is', () => {
    const { unmount } = draw(snapshot(null));
    expect(screen.queryByText(NO_ACTIVE_SEASON_TONIGHT_MESSAGE)).not.toBeInTheDocument();
    unmount();

    draw(snapshot(null, { seasonActive: false, seasonName: null }));
    expect(screen.getByText(NO_ACTIVE_SEASON_TONIGHT_MESSAGE)).toBeInTheDocument();
    // Never the admin sentence: it ends by naming a page most of the group cannot open (M3.17).
    expect(screen.queryByText(NO_ACTIVE_SEASON_MESSAGE)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Start a season on the Seasons page.');
  });

  it('drops the season from the slug when there is none, leaving the date alone', () => {
    const { container } = draw(snapshot(null, { seasonActive: false, seasonName: null }));
    expect(container.querySelector('.cn-slug')).toHaveTextContent('Tuesday 8 September');
    expect(container.querySelector('.cn-slug')?.textContent).not.toContain('·');
  });

  it('puts the no-season line directly under the status strip, not at the foot of the page', () => {
    const { container } = draw(
      snapshot(lobbyView({ status: 'balanced', teams: workedTeams() }), { seasonActive: false }),
    );

    const main = container.querySelector('main');
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
  it('counts the people around and seats them in join order with their ratings', () => {
    const { container } = draw(snapshot(lobbyView({ members: workedMembers(3) })));

    expect(strip(container)).toEqual([
      'Tuesday 8 September · Season 1',
      '3 IN THE LOBBY live',
      'Seven more to go.',
    ]);
    const rows = [...container.querySelectorAll('.cn-rack-row')];
    expect(rows.slice(0, 3).map((row) => row.textContent)).toEqual([
      'Bilaladc · mid1713',
      'Hanatop · mid1434',
      'Irisjungle · top1578',
    ]);
    // Ten seats, always: the seven that are open are seats and not blank rows.
    expect(rows).toHaveLength(10);
    expect(container.querySelectorAll('.cn-rack-open')).toHaveLength(7);
  });

  it('has an empty state that is a rack of ten open seats and one sentence in the strip', () => {
    const { container } = draw(snapshot(lobbyView({ members: [] })));

    expect(strip(container)[1]).toBe('0 IN THE LOBBY live');
    expect(strip(container)[2]).toBe('Nobody in the lobby yet.');
    expect(container.querySelectorAll('.cn-rack-open')).toHaveLength(10);
    // Said once. The old under-the-rack copy of the same sentence is gone.
    expect(screen.getAllByText('Nobody in the lobby yet.')).toHaveLength(1);
  });

  it('puts the eleventh person under the Around divider, not among the ten', () => {
    const { container } = draw(snapshot(lobbyView({ members: [...workedMembers(), extraMember()] })));

    expect(strip(container)[1]).toBe('11 IN THE LOBBY live');
    expect(strip(container)[2]).toBe('Ten play, the rest sit out this game.');
    const lists = screen.getAllByRole('list');
    expect(lists).toHaveLength(2);
    expect(within(lists[1] as HTMLElement).getByText('Deniz')).toBeInTheDocument();
    expect(screen.getByText('Around')).toBeInTheDocument();
    // Nothing is reserved for them: the second list is one row long.
    expect((lists[1] as HTMLElement).querySelectorAll('li')).toHaveLength(1);
  });

  it('shows no teams, no prediction and no countdown before the balance', () => {
    draw(snapshot(lobbyView({ members: workedMembers(9) })));

    expect(screen.queryByText('BLUE')).not.toBeInTheDocument();
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

describe('the role column only appears when it distinguishes', () => {
  const flexible = workedMembers(6).map((member) => ({
    ...member,
    mainRole: null,
    secondaryRole: null,
  }));

  it('drops the column and says it once when nobody on screen has a role', () => {
    const { container } = draw(snapshot(lobbyView({ members: flexible })));

    expect(container.querySelectorAll('.cn-rack-roles')).toHaveLength(0);
    expect(screen.getAllByText(ALL_FLEXIBLE_HINT)).toHaveLength(1);
    // Never a column of nine identical grey words.
    expect(container.textContent).not.toContain('flexible');
  });

  it('shows the column, with `flexible` on the rows that have none, as soon as one does', () => {
    const [first, ...rest] = flexible;
    if (first === undefined) throw new Error('no member');
    const { container } = draw(snapshot(lobbyView({ members: [{ ...first, mainRole: 'jungle' }, ...rest] })));

    expect(container.querySelectorAll('.cn-rack-roles')).toHaveLength(6);
    expect(screen.getAllByText('flexible')).toHaveLength(5);
    expect(screen.queryByText(ALL_FLEXIBLE_HINT)).not.toBeInTheDocument();
  });
});

describe('teams: balanced and in_game are the same block', () => {
  const balanced = snapshot(lobbyView({ status: 'balanced', teams: workedTeams() }));

  it('renders the promoted split verbatim, blue first, in lane order', () => {
    const { container } = draw(balanced);

    expect(strip(container)[1]).toBe('TEAMS ARE SET live');
    const cards = container.querySelectorAll('.cn-team');
    expect(cards).toHaveLength(2);

    const blue = cards[0] as HTMLElement;
    expect(within(blue).getByRole('heading', { level: 2 })).toHaveTextContent('BLUE');
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

  it('changes only the headline word and the pill between balanced and in_game', () => {
    const { container: first } = draw(balanced);
    const balancedCards = first.querySelector('.cn-cards')?.innerHTML;

    const { container: second } = draw(snapshot(lobbyView({ status: 'in_game', teams: workedTeams() })));
    expect(strip(second)[1]).toBe('IN GAME live');
    expect(second.querySelector('.cn-cards')?.innerHTML).toBe(balancedCards);
  });

  it('draws a role icon beside every role word, and never in place of one', () => {
    const { container } = draw(balanced);

    const roles = [...container.querySelectorAll('.cn-seat-role')];
    expect(roles).toHaveLength(10);
    for (const role of roles) {
      expect(role.querySelector('svg')).not.toBeNull();
      expect(role.textContent?.length ?? 0).toBeGreaterThan(0);
      // The word beside it is the accessible name.
      expect(role.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    }
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
    const blocks = [...container.querySelectorAll('.cn-sitout, .cn-cards, .cn-explain')].map((element) =>
      element.className.includes('cn-sitout')
        ? 'cn-sitout'
        : element.className.includes('cn-cards')
          ? 'cn-cards'
          : 'cn-explain',
    );

    expect(blocks).toEqual(['cn-sitout', 'cn-cards', 'cn-explain']);
    expect(screen.getByText('SITTING OUT')).toBeInTheDocument();
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

  it('leads with the winner, the duration, the prediction and the top damage, in one card', () => {
    const { container } = draw(finished);

    expect(strip(container)[1]).toBe('GAME OVER');
    expect(strip(container)[2]).toBe('Ratings are updated. The leaderboard has the rest.');

    const card = container.querySelector('.cn-result');
    expect(card).toHaveTextContent('RED WINS');
    expect(card).toHaveTextContent('34:12');
    expect(card).toHaveTextContent('Blue was favored 54%.');
    expect(card).toHaveTextContent('Top damage: Lena, 47.3k');
  });

  it('prints one rating per player: the after number and its delta, and no second pair of cards', () => {
    const { container } = draw(finished);

    expect(container.querySelectorAll('.cn-team')).toHaveLength(2);
    const blue = container.querySelectorAll('.cn-team')[0] as HTMLElement;
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

  it('rings the winner and drops the loser to a hairline, both structurally', () => {
    const { container } = draw(finished);

    const cards = [...container.querySelectorAll('.cn-team')];
    expect(cards[0]?.className).toContain('cn-team-lost');
    expect(cards[1]?.className).toContain('cn-team-won');
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

    const row = container.querySelector('.cn-team .cn-seat');
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

  it('shows the teams, no deltas and an empty sentence slot for a game the fold did not rate', () => {
    const unrated = workedResult({ rated: false });
    const { container } = draw(
      snapshot(lobbyView({ status: 'finished', teams: workedTeams(), result: unrated })),
    );

    expect(strip(container)[1]).toBe('GAME OVER');
    expect(strip(container)[2]).toBe('');
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
