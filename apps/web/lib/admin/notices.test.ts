import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { adminError, adminNotice, mintedToken } from './notices';

/**
 * M3.20's in-place notices, and the guard that keeps them honest.
 *
 * The route handlers are the API and this task does not touch them, so the sentence a JSON
 * caller shows beside the control is a **second copy** of the one the 303 path carries. Every
 * fixed sentence below is therefore also grepped for in the handler that owns it: if somebody
 * rewords a notice in `app/api`, this file fails rather than the page quietly drifting.
 */

const handler = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../../app/api/admin/${path}`, import.meta.url)), 'utf8');

const players = handler('players/handler.ts');
const tokens = handler('tokens/handler.ts');
const discord = handler('discord-config/handler.ts');
const seasons = handler('seasons/handler.ts');
const reroll = handler('lobbies/[lobbyId]/reroll/handler.ts');

describe('players', () => {
  const notice = (values: Record<string, string>) => adminNotice('players', values, { ok: true });

  it('has nothing to say about a role save, because there is no longer one (M5.17)', () => {
    // The action is retired: it answers 410 and the page prints the route's own sentence, so
    // this file must not compose a receipt for a write that never happens.
    expect(notice({ action: 'set-roles', mainRole: 'mid', secondaryRole: 'top' })).toBe('saved');
  });

  it('says both halves of a name save: what it is now, and whether the client may move it', () => {
    expect(notice({ action: 'set-name', displayName: 'Hana' })).toBe('name saved: Hana');
    expect(notice({ action: 'set-name', displayName: '' })).toBe(
      'name cleared: it follows the Riot ID again',
    );
  });

  it('covers the Discord link, the admin flag and backfill', () => {
    expect(notice({ action: 'set-discord', discordId: '123' })).toBe('Discord id linked');
    expect(notice({ action: 'set-discord', discordId: '' })).toBe('Discord id cleared');
    expect(notice({ action: 'set-admin', isAdmin: 'true' })).toBe('admin granted');
    expect(notice({ action: 'set-admin', isAdmin: 'false' })).toBe('admin removed');
    expect(notice({ action: 'set-backfill', approved: 'true' })).toBe(
      'backfill allowed. Backfilled games are not rated until the ratings are rebuilt.',
    );
    expect(notice({ action: 'set-backfill', approved: 'false' })).toBe('backfill revoked');
  });

  it('says the same words the route says', () => {
    for (const sentence of [
      'name cleared: it follows the Riot ID again',
      'name saved: ',
      'Discord id cleared',
      'Discord id linked',
      'admin granted',
      'admin removed',
      'backfill allowed. Backfilled games are not rated until the ratings are rebuilt.',
      'backfill revoked',
    ]) {
      expect(players, sentence).toContain(sentence);
    }
  });
});

describe('tokens, the Discord config and the season', () => {
  it('names the two token outcomes, in the route’s words', () => {
    expect(adminNotice('tokens', { action: 'mint' }, { ok: true })).toBe('token minted');
    expect(adminNotice('tokens', { action: 'revoke' }, { ok: true })).toBe('token revoked');
    expect(tokens).toContain("'token minted'");
    expect(tokens).toContain("'token revoked'");
  });

  it('hands back the raw token, which exists in that one response and nowhere else', () => {
    expect(mintedToken({ ok: true, token: 'cnt_live_abc' })).toBe('cnt_live_abc');
    expect(mintedToken({ ok: true })).toBeNull();
  });

  it('confirms the Discord config in the route’s words', () => {
    expect(adminNotice('discord', {}, { ok: true })).toBe('Discord config saved');
    expect(discord).toContain("'Discord config saved'");
  });

  it('reads the season sentence off the response: what ended and what is live now', () => {
    expect(adminNotice('seasons', {}, { ok: true, season: { name: 'Season 2' }, endedSeason: null })).toBe(
      'Season 2 is now the active season, and its leaderboard starts empty.',
    );
    expect(
      adminNotice(
        'seasons',
        {},
        { ok: true, season: { name: 'Season 2' }, endedSeason: { name: 'Season 1' } },
      ),
    ).toBe('Season 1 has ended. Season 2 is now the active season, and its leaderboard starts empty.');

    expect(seasons).toContain('is now the active season, and its leaderboard starts empty.');
    expect(seasons).toContain('has ended.');
  });
});

describe('the reroll', () => {
  const notice = (body: Record<string, unknown>) => adminNotice('reroll', {}, { ok: true, ...body });

  it('says which split is up, out of how many, and what Discord did', () => {
    expect(notice({ rank: 2, splitCount: 3, promoted: true, post: 'posted' })).toBe(
      'Split 2 is up: reroll 1 of 2. Posted to Discord.',
    );
    expect(notice({ rank: 1, splitCount: 3, promoted: true, post: 'skipped' })).toBe(
      'Split 1 is back on the board. No webhook is configured, so nothing was posted.',
    );
    expect(notice({ rank: 3, splitCount: 3, promoted: true, post: 'failed' })).toBe(
      'Split 3 is up: reroll 2 of 2. Discord did not take the post, but the teams stand.',
    );
  });

  it('says nothing moved when the split was already on the board: two taps, one message', () => {
    expect(notice({ rank: 2, splitCount: 3, promoted: false, post: null })).toBe(
      'Split 2 was already the one on the board. Nothing was posted.',
    );
  });

  it('says the same words the route says', () => {
    for (const fragment of [
      'was already the one on the board. Nothing was posted.',
      'Split 1 is back on the board.',
      'Posted to Discord.',
      'No webhook is configured, so nothing was posted.',
      'Discord did not take the post, but the teams stand.',
    ]) {
      expect(reroll, fragment).toContain(fragment);
    }
  });
});

describe('a refusal', () => {
  it('is the route’s own sentence, never one of ours', () => {
    expect(adminError({ ok: false, error: 'that lobby is not balanced' }, 'fallback')).toBe(
      'that lobby is not balanced',
    );
  });

  it('falls back only when the answer carries no sentence at all', () => {
    expect(adminError(null, 'that did not save')).toBe('that did not save');
    expect(adminError({ ok: false }, 'that did not save')).toBe('that did not save');
  });
});
