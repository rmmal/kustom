import { SETTLING_CHIP, SETTLING_SENTENCE, SETTLING_SENTENCE_PLAYER } from '@/lib/board/copy';
import { NAMELESS_HINT } from '@/lib/tonight/copy';

/**
 * The pieces `/leaderboard` and `/p/[puuid]` share (M3.8, M3.10).
 *
 * They live in one file because both pages have to say them the same way: the chip is the same
 * chip, the sentence appears **once per page** on both, and the nameless hint is the tonight
 * page's own line, imported rather than retyped.
 */

/**
 * The still-settling marker: the word `settling`, mono `t-xs`, `dim`, a hairline border.
 *
 * No colour, no dot, no emoji, no asterisk — it reads as a label, not a warning
 * (`05-design.md`, "Still-settling marker"). It disappears at 30 games with no ceremony, which
 * is the caller's `settling` flag and nothing here.
 */
export function SettlingChip() {
  return <span className="cn-num cn-chip">{SETTLING_CHIP}</span>;
}

/**
 * The sentence, once per page: under the leaderboard heading, under the rating chart on the
 * player page. Never once per row — ten rows of it is the thing the one line replaces.
 *
 * **Two forms, one placement** (M3.26, product 2026-09-10). The board's is second person,
 * because everyone reading a board is on it; the player page's is the third-person twin, with
 * no name in it, because `your rating` there names the number printed above it and that number
 * belongs to whoever's page it is. The `person` prop picks the constant and nothing else
 * differs — same element, same class, same gate on `settling`.
 */
export function SettlingNote({ person = 'you' }: { person?: 'you' | 'player' }) {
  return <p className="cn-settling">{person === 'player' ? SETTLING_SENTENCE_PLAYER : SETTLING_SENTENCE}</p>;
}

/** M3.10's quiet line, once per page, while any row on it reads `Someone`. */
export function NamelessHint() {
  return <p className="cn-hint">{NAMELESS_HINT}</p>;
}
