import { describe, expect, it } from 'vitest';
import { maskSecret } from './discordConfig';
import { isSelfDemotion } from './players';
import { escapeHtml, renderMintedTokenPage } from './tokenPage';

/** The rules the admin pages enforce that are not the database's to enforce. */

const HANA = '11111111-1111-4111-8111-111111111111';
const OMAR = '22222222-2222-4222-8222-222222222222';

describe('isSelfDemotion', () => {
  it('blocks an admin removing their own flag', () => {
    expect(isSelfDemotion({ playerId: HANA, isAdmin: false, actingPlayerId: HANA })).toBe(true);
  });

  it('allows demoting someone else', () => {
    expect(isSelfDemotion({ playerId: OMAR, isAdmin: false, actingPlayerId: HANA })).toBe(false);
  });

  it('allows promoting anyone, including yourself', () => {
    expect(isSelfDemotion({ playerId: HANA, isAdmin: true, actingPlayerId: HANA })).toBe(false);
    expect(isSelfDemotion({ playerId: OMAR, isAdmin: true, actingPlayerId: HANA })).toBe(false);
  });
});

describe('maskSecret', () => {
  it('keeps the shape of a webhook URL and hides the token', () => {
    const url = 'https://discord.com/api/webhooks/1234567890/abcdefghijklmnopqrstuvwxyz-TOKEN';
    const masked = maskSecret(url);

    expect(masked).not.toBeNull();
    expect(masked).toContain('discord.com/api/webhooks/1234567890/');
    expect(masked).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(masked?.endsWith('OKEN')).toBe(true);
  });

  it('never reveals a short value', () => {
    expect(maskSecret('short')).not.toContain('short');
  });

  it('is null for nothing at all', () => {
    expect(maskSecret(null)).toBeNull();
    expect(maskSecret('   ')).toBeNull();
  });
});

describe('renderMintedTokenPage', () => {
  it('shows the token once and escapes everything else', () => {
    const html = renderMintedTokenPage({
      token: 'tok_abc123',
      puuid: '<script>alert(1)</script>',
      label: 'omar & "the laptop"',
      backTo: '/admin/tokens',
    });

    expect(html.split('tok_abc123')).toHaveLength(2);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('omar &amp; &quot;the laptop&quot;');
    expect(html).toContain('href="/admin/tokens"');
  });

  it('escapes the five characters that matter', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});
