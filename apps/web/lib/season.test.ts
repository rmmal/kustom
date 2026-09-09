import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NO_ACTIVE_SEASON_MESSAGE, NO_ACTIVE_SEASON_TONIGHT_MESSAGE } from './season';

/**
 * The no-active-season sentence (M2.18).
 *
 * The failure it replaces was a Postgres constraint message on a Vercel function after the
 * game was over, so the whole value of this task is that one wording reaches a human in three
 * places: the companion's log (the API answer), the admin index, and the seasons page. The
 * admin pages are async server components behind a session, so there is no renderer here to
 * assert against; what is asserted instead is that neither page spells the sentence out for
 * itself — a second copy is exactly how the three drift apart.
 */

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));

function source(path: string): string {
  return readFileSync(`${WEB_ROOT}${path}`, 'utf8');
}

describe('NO_ACTIVE_SEASON_MESSAGE', () => {
  it('is the product-approved sentence, exactly', () => {
    expect(NO_ACTIVE_SEASON_MESSAGE).toBe(
      'No season is active, so games cannot be saved. Start a season on the Seasons page.',
    );
  });

  it('names the season as the thing to fix, not a column or a constraint', () => {
    expect(NO_ACTIVE_SEASON_MESSAGE).toContain('season');
    expect(NO_ACTIVE_SEASON_MESSAGE).not.toContain('season_id');
    expect(NO_ACTIVE_SEASON_MESSAGE).not.toMatch(/null|constraint|violates/i);
  });
});

describe('NO_ACTIVE_SEASON_TONIGHT_MESSAGE', () => {
  it('is the product-approved sentence for the whole group, exactly (M3.17)', () => {
    expect(NO_ACTIVE_SEASON_TONIGHT_MESSAGE).toBe(
      "No season is active, so tonight's games are not being saved. An admin can start one.",
    );
  });

  it('names nothing the reader cannot open', () => {
    // The admin sentence ends "Start a season on the Seasons page." — a page nineteen of the
    // twenty people holding the WhatsApp link cannot open. Same fact, different reader.
    expect(NO_ACTIVE_SEASON_TONIGHT_MESSAGE).not.toContain('Seasons page');
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
    }
  });
});
