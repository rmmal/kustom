import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NO_ACTIVE_SEASON_MESSAGE, NO_ACTIVE_SEASON_TONIGHT_MESSAGE } from './season';

/**
 * The two no-active-season sentences (M2.18, M3.17), **rewritten by M5.14** (product,
 * 2026-09-10) now that nothing can start a season.
 *
 * The failure they replace was a Postgres constraint message on a Vercel function after the
 * game was over, so the whole value of the task is that one wording reaches a human in three
 * places: the companion's log (the API answer), the admin index, and the seasons page. The
 * admin pages are async server components behind a session, so there is no renderer here to
 * assert against; what is asserted instead is that neither page spells the sentence out for
 * itself — a second copy is exactly how the three drift apart.
 *
 * **Neither sentence may promise a button again.** There is no `Start` control anywhere in the
 * product, and a sentence that sends somebody looking for one is worse than the constraint
 * message it replaced.
 */

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));

function source(path: string): string {
  return readFileSync(`${WEB_ROOT}${path}`, 'utf8');
}

describe('NO_ACTIVE_SEASON_MESSAGE', () => {
  it('is the product-approved sentence, exactly', () => {
    expect(NO_ACTIVE_SEASON_MESSAGE).toBe(
      'Games cannot be saved: the database is missing its one season row.',
    );
  });

  it('names the fault, not a column or a constraint', () => {
    expect(NO_ACTIVE_SEASON_MESSAGE).toContain('season row');
    expect(NO_ACTIVE_SEASON_MESSAGE).not.toContain('season_id');
    expect(NO_ACTIVE_SEASON_MESSAGE).not.toMatch(/null|constraint|violates/i);
  });

  /** M5.14: there is no page action to send an admin to, so it promises none. */
  it('promises no button, because there is none', () => {
    expect(NO_ACTIVE_SEASON_MESSAGE).not.toMatch(/start/i);
    expect(NO_ACTIVE_SEASON_MESSAGE).not.toContain('Seasons page');
  });
});

describe('NO_ACTIVE_SEASON_TONIGHT_MESSAGE', () => {
  it('is the product-approved sentence for the whole group, exactly (M3.17, M5.14)', () => {
    expect(NO_ACTIVE_SEASON_TONIGHT_MESSAGE).toBe(
      "Tonight's games are not being saved. Play on — they can be added back from match history later.",
    );
  });

  /**
   * **It says the only thing twenty people on a WhatsApp link can act on**, which is nothing:
   * keep playing, backfill can recover the night (M5.1). It used to end `An admin can start
   * one.`, over a button that no longer exists.
   */
  it('names nothing the reader cannot open, and nobody they have to find', () => {
    expect(NO_ACTIVE_SEASON_TONIGHT_MESSAGE).not.toContain('Seasons page');
    expect(NO_ACTIVE_SEASON_TONIGHT_MESSAGE).not.toMatch(/admin/i);
    expect(NO_ACTIVE_SEASON_TONIGHT_MESSAGE).not.toMatch(/start/i);
    // The word `season` never reaches the tonight page at all now.
    expect(NO_ACTIVE_SEASON_TONIGHT_MESSAGE.toLowerCase()).not.toContain('season');
    expect(NO_ACTIVE_SEASON_TONIGHT_MESSAGE).not.toBe(NO_ACTIVE_SEASON_MESSAGE);
  });

  it('is what the tonight page renders, and the admin one is not', () => {
    const view = source('app/_tonight/TonightView.tsx');
    expect(view).toContain('NO_ACTIVE_SEASON_TONIGHT_MESSAGE');
    // The page must not import the admin constant at all. Its name is a prefix of this one's,
    // so the check is on the word boundary rather than on a substring.
    expect(view).not.toMatch(/NO_ACTIVE_SEASON_MESSAGE[^_T]/);
    expect(view).not.toContain('Start a season on the Seasons page.');
  });
});

describe('the pages and the route that say it', () => {
  const users = [
    'app/api/companion/game/route.ts',
    'app/admin/(dashboard)/page.tsx',
    'app/admin/(dashboard)/seasons/page.tsx',
  ];

  it('all read the one constant', () => {
    for (const path of users) {
      expect(source(path)).toContain('NO_ACTIVE_SEASON_MESSAGE');
    }
  });

  it('nobody writes their own version of it', () => {
    for (const path of users) {
      // The old admin wording, which the companion's log never matched.
      expect(source(path)).not.toContain('No season is active. Start one on the seasons page.');
      expect(source(path)).not.toContain("'No season is active, so games cannot be saved");
      // M5.14: no page may offer to start one, in its own words or anybody else's.
      expect(source(path)).not.toContain('Start a season');
    }
  });
});
