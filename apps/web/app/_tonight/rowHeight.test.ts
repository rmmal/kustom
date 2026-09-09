import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The one number on this page that has to be right or the page moves under a thumb: the
 * height reserved for ten member rows (M3.4, `05-design.md`, "Lobby member list").
 *
 * The rule is `10 × 44px` plus the nine hairlines between the rows, and it is only true while
 * a row actually is 44px. Measured at 390px before this test existed, `t-md` at the body's 1.5
 * line height made the rows 46-47px against a reserved 440px, so the 9 → 10 join — the one
 * moment everybody is looking at the page — shifted it by about thirty pixels.
 *
 * jsdom does no layout, so there is no honest height to measure in a component test. This
 * checks the arithmetic in the stylesheet instead: the row's own box cannot exceed 44px, and
 * the reserved height is stated in the row's units rather than guessed from the font.
 */

const css = readFileSync(fileURLToPath(new URL('../tonight.css', import.meta.url)), 'utf8');

/** The declarations of one rule, by its selector text. */
function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} is not in tonight.css`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('}', start));
}

describe('the member list reserves exactly ten rows', () => {
  /** `--cn-t-md`, the name's size, in px. From `tokens.css`: 1.25rem at a 16px root. */
  const NAME_PX = 20;
  /** `--cn-sp-2`, the row's top and bottom padding. */
  const PADDING_PX = 8;
  const ROW_PX = 44;
  const HAIRLINE_PX = 1;

  it('states the reserved height in rows and hairlines, not in a guessed pixel count', () => {
    expect(block('.cn-members')).toContain(`min-height: calc(10 * ${ROW_PX}px + 9px)`);
    expect(10 * ROW_PX + 9 * HAIRLINE_PX).toBe(449);
  });

  it('keeps a row inside 44px: the line height is 1.2, not the body 1.5', () => {
    const row = block('.cn-member,\n.cn-seat');
    expect(row).toContain('min-height: 44px');
    expect(row).toContain('line-height: 1.2');
    expect(row).toContain('padding: var(--cn-sp-2) var(--cn-sp-3)');

    // One line of `t-md` plus the padding, which is what the browser lays out when the content
    // is shorter than `min-height`. At the body's 1.5 this is 46px and the list overflows its
    // reservation by 2-3px a row.
    const content = Math.ceil(NAME_PX * 1.2) + 2 * PADDING_PX;
    expect(content).toBeLessThanOrEqual(ROW_PX);
    expect(Math.ceil(NAME_PX * 1.5) + 2 * PADDING_PX).toBeGreaterThan(ROW_PX);
  });

  it('reserves nothing for the people past the ten', () => {
    expect(block('.cn-members-around')).toContain('min-height: 0');
  });

  it('leaves nine hairlines: they are between rows, never on the first', () => {
    expect(block('.cn-member + .cn-member,\n.cn-seat + .cn-seat')).toContain(
      `border-top: ${HAIRLINE_PX}px solid var(--cn-hairline)`,
    );
  });

  it('gives the idle page a 44px tap target on its one link', () => {
    const link = block('.cn-link');
    expect(link).toContain('display: inline-block');
    expect(link).toContain('min-height: 44px');
    expect(link).toContain('line-height: 44px');
  });
});
