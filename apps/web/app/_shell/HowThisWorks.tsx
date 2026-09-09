import { RELEASES_URL } from '@/lib/nav';
import {
  COMPANION_CARD_BODY,
  COMPANION_CARD_TITLE,
  COMPANION_LINK_LABEL,
  HOW_THIS_WORKS_LINES,
  HOW_THIS_WORKS_TITLE,
} from '@/lib/shellCopy';

/**
 * `How this works` and `Run the companion` (05-design.md, "The app shell" and "Breakpoints and
 * the desktop grid").
 *
 * Two shapes, one set of words:
 *
 *   - {@link HowThisWorksDetails} is the footer's `<details>`, closed by default. It is the one
 *     place on the page allowed to change height, because a person tapped it.
 *   - {@link HowThisWorksCard} and {@link CompanionCard} are the open cards the desktop rail
 *     carries, and the idle page renders inline at every width — there is nothing else to read
 *     on the screen a friend hits at 19:00.
 *
 * No new route and no new data: four sentences and one link.
 */

export function HowThisWorksDetails() {
  return (
    <details className="cn-how">
      <summary className="cn-how-summary">{HOW_THIS_WORKS_TITLE}</summary>
      <HowLines />
    </details>
  );
}

export function HowThisWorksCard() {
  return (
    <section className="cn-card cn-rail-card">
      <h2 className="cn-rail-title">{HOW_THIS_WORKS_TITLE}</h2>
      <HowLines />
    </section>
  );
}

function HowLines() {
  return (
    <div className="cn-how-lines">
      {HOW_THIS_WORKS_LINES.map((line) => (
        <p key={line} className="cn-how-line">
          {line}
        </p>
      ))}
    </div>
  );
}

export function CompanionCard() {
  return (
    <section className="cn-card cn-rail-card">
      <h2 className="cn-rail-title">{COMPANION_CARD_TITLE}</h2>
      <p className="cn-how-line">{COMPANION_CARD_BODY}</p>
      {/* The releases page, not the `.exe`: this card is read on a phone (05-design.md). */}
      <a className="cn-link" href={RELEASES_URL} target="_blank" rel="noreferrer noopener">
        {COMPANION_LINK_LABEL}
      </a>
    </section>
  );
}
