import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { extraMember, workedMembers } from '@/lib/testing/tonightFixtures';
import type { MemberView } from '@/lib/tonight/types';
import { SeatRack } from './SeatRack';

/**
 * The one number on this page that has to be right or the page moves under a thumb: the height
 * of the seat rack (M3.4, M3.18, `05-design.md`, "Filling — the seat rack").
 *
 * v2 reserves it as **content** rather than as a `min-height`: ten rows are rendered at every
 * count, and an unfilled one is an `open` seat. The arithmetic is still `10 × 44px` plus the
 * nine hairlines between the rows, and it is only true while a row actually is 44px — measured
 * at 390px before this test existed, `t-md` at the body's 1.5 line height made the rows 46-47px
 * against a reserved 440px, so the 9 → 10 join shifted the page by about thirty pixels.
 *
 * jsdom does no layout, so the pixel half is checked in the stylesheet and the ten-row half is
 * checked by rendering. The file is `.tsx` for the second half: the runner's `dom` project is
 * selected by extension (`vitest.config.ts`).
 */

/**
 * The stylesheet, read from disk. Not through `import.meta.url`: under jsdom the module URL is
 * an `http://` one and `fileURLToPath` refuses it. The working directory is `apps/web` when the
 * package's own script runs and the repo root when the whole workspace does, so both are tried.
 */
function readCss(name: string): string {
  for (const base of [process.cwd(), resolve(process.cwd(), 'apps/web')]) {
    const path = resolve(base, 'app', name);
    if (existsSync(path)) return readFileSync(path, 'utf8');
  }
  throw new Error(`rowHeight: cannot find app/${name} from ${process.cwd()}`);
}

const css = readCss('tonight.css');
const shellCss = readCss('shell.css');

/** The declarations of one rule, by its selector text. */
function block(selector: string, sheet = css): string {
  const start = sheet.indexOf(`${selector} {`);
  expect(start, `${selector} is not in the stylesheet`).toBeGreaterThan(-1);
  return sheet.slice(start, sheet.indexOf('}', start));
}

/** `count` people in the lobby, plus any past the ten in the spectator slot. */
function lobbyOf(count: number): MemberView[] {
  const ten = workedMembers(Math.min(count, 10));
  const extra = Array.from({ length: Math.max(0, count - 10) }, (_, index) =>
    extraMember({ puuid: `puuid-extra-${index}`, name: `Extra ${index}` }),
  );
  return [...ten, ...extra];
}

describe('the rack is ten rows at every count', () => {
  it.each([0, 6, 9, 10, 12])('renders ten seats with %i people around', (count) => {
    const { unmount } = render(<SeatRack members={lobbyOf(count)} viewerPuuid={null} />);

    const rack = screen.getAllByRole('list')[0] as HTMLElement;
    expect(rack.querySelectorAll('li')).toHaveLength(10);
    // The unfilled ones are seats, not blank rows: nine names and one `open` at count 9.
    expect(rack.querySelectorAll('.cn-rack-open')).toHaveLength(Math.max(0, 10 - Math.min(count, 10)));

    unmount();
  });

  it('reserves nothing for the people past the ten: they are their own list', () => {
    render(<SeatRack members={lobbyOf(12)} viewerPuuid={null} />);

    const lists = screen.getAllByRole('list');
    expect(lists).toHaveLength(2);
    expect((lists[1] as HTMLElement).querySelectorAll('li')).toHaveLength(2);
  });
});

describe('a rack row is 44px', () => {
  /** `--cn-t-md`, the name's size, in px. From `tokens.css`: 1.1875rem at a 16px root. */
  const NAME_PX = 19;
  /** `--cn-sp-2`, the row's top and bottom padding. */
  const PADDING_PX = 8;
  const ROW_PX = 44;
  const HAIRLINE_PX = 1;
  /** `05-design.md`, "Scale": the line height `t-md` is specified with. */
  const LINE_HEIGHT = 1.3;

  it('states the row height in the row, and ten of them are the reservation', () => {
    const row = block('.cn-rack-row,\n.cn-seat');
    expect(row).toContain(`min-height: ${ROW_PX}px`);
    expect(row).toContain(`line-height: ${LINE_HEIGHT}`);
    expect(row).toContain('padding: var(--cn-sp-2) var(--cn-sp-3)');
    expect(10 * ROW_PX + 9 * HAIRLINE_PX).toBe(449);
  });

  it("keeps a row inside 44px: the line height is the scale's 1.3, not the body 1.5", () => {
    // One line of `t-md` plus the padding, which is what the browser lays out when the content
    // is shorter than `min-height`. At the body's 1.5 this overflows the row; at the scale's
    // own 1.3 it fits.
    const content = Math.ceil(NAME_PX * LINE_HEIGHT) + 2 * PADDING_PX;
    expect(content).toBe(41);
    expect(content).toBeLessThanOrEqual(ROW_PX);
  });

  it('leaves nine hairlines: they are between rows, never on the first', () => {
    expect(block('.cn-rack-row + .cn-rack-row,\n.cn-seat + .cn-seat')).toContain(
      `border-top: ${HAIRLINE_PX}px solid var(--cn-line)`,
    );
  });

  it('gives every link in the shell a 44px tap target', () => {
    const link = block('.cn-link', shellCss);
    expect(link).toContain('display: inline-flex');
    expect(link).toContain('min-height: 44px');
  });
});
