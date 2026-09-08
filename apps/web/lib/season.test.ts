import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NO_ACTIVE_SEASON_MESSAGE } from './season';

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
