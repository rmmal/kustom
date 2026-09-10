import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PLAYERS_PER_GAME } from '@/lib/lobbyState';
import {
  ALL_FLEXIBLE_HINT,
  AROUND_LABEL,
  FLEXIBLE_ROLE,
  OPEN_SEAT,
  RACK_LABEL,
  RACK_LEGEND,
  rackCount,
  renderWebName,
  SET_ROLES_LINK,
} from '@/lib/tonight/copy';
import { anyRoleShown, tonightRoles } from '@/lib/tonight/roles';
import type { MemberView } from '@/lib/tonight/types';
import { RoleIcon } from '../_icons/RoleIcon';

/**
 * The seat rack (05-design.md, "Filling — the seat rack"): **ten rows, at every count**, with
 * an unfilled seat rendered as a seat rather than as blank card.
 *
 * That is the same no-shift guarantee v1 bought with a `min-height`, kept as content instead of
 * as a number that has to agree with a font: the 9 → 10 join replaces `open` with a name and
 * moves nothing. `rowHeight.test.tsx` asserts both halves — ten `<li>` at every count, and the
 * 44px row arithmetic the reservation is made of.
 *
 * An empty seat is filled with `bg` — recessed below the card — so the rack reads as a rack.
 * It is not a skeleton: it does not shimmer, it does not fade, and it is the same on the
 * server and on the client.
 */

export interface SeatRackProps {
  /** Everybody around, in join order. The spectators past the ten sit under `Around`. */
  members: readonly MemberView[];
  viewerPuuid: string | null;
  /** Adds `Set roles` to the all-flexible hint. A link to a page only an admin can open. */
  isAdmin?: boolean;
}

export function SeatRack({ members, viewerPuuid, isAdmin = false }: SeatRackProps) {
  const playing = members.filter((member) => !member.isSpectator);
  const around = members.filter((member) => member.isSpectator);

  /**
   * **`flexible` only appears when it distinguishes.** With nobody on screen carrying a role
   * the column is not rendered at all and one line under the rack says so once; nine identical
   * grey words in a column is not information, it looks like a field that failed to load.
   */
  const showRoles = anyRoleShown(members);
  const seats = Array.from({ length: PLAYERS_PER_GAME }, (_, index) => playing[index] ?? null);

  return (
    <>
      <section className="cn-card cn-rack">
        <header className="cn-card-head cn-rack-head">
          <span className="cn-num cn-rack-label">{`${RACK_LABEL} · ${rackCount(playing.length)}`}</span>
          {/* The fix for "1612 means nothing": one 12px word, right-aligned over the column,
              in exactly the pattern the leaderboard's legend already uses. */}
          <span className="cn-num cn-rack-legend">{RACK_LEGEND}</span>
        </header>
        <ul className={showRoles ? 'cn-rack-list cn-rack-roled' : 'cn-rack-list'}>
          {seats.map((member, index) =>
            member === null ? (
              <li
                // A seat is a position, not a person: the index is its whole identity.
                // biome-ignore lint/suspicious/noArrayIndexKey: a fixed rack of ten seats
                key={`open-${index}`}
                className="cn-rack-row cn-rack-open"
              >
                <span className="cn-num cn-open">{OPEN_SEAT}</span>
              </li>
            ) : (
              <SeatRow key={member.puuid} member={member} viewerPuuid={viewerPuuid} showRoles={showRoles} />
            ),
          )}
        </ul>
      </section>

      {around.length === 0 ? null : (
        <div className="cn-around-block">
          <p className="cn-num cn-around">{AROUND_LABEL}</p>
          {/* The same row shape — including the role column, or the rating wraps under the
              name and the row is a different height from the ten above it. */}
          <ul
            className={
              showRoles
                ? 'cn-card cn-rack-list cn-rack-around cn-rack-roled'
                : 'cn-card cn-rack-list cn-rack-around'
            }
          >
            {around.map((member) => (
              <SeatRow key={member.puuid} member={member} viewerPuuid={viewerPuuid} showRoles={showRoles} />
            ))}
          </ul>
        </div>
      )}

      {/* Once, under the rack, and never on a rack nobody is in — at zero the strip's sentence
          has already said the only thing there is to say. */}
      {showRoles || members.length === 0 ? null : (
        <p className="cn-hint">
          {ALL_FLEXIBLE_HINT}
          {/* Admin only, and only now that M3.6 has shipped the control it points at
              (`05-design.md`, the copy table). Everybody else's profile roles are an admin's
              to set; their role for *tonight* is the card under this rack. */}
          {isAdmin ? (
            <>
              {' '}
              <Link className="cn-hint-link" href="/admin">
                {SET_ROLES_LINK}
              </Link>
            </>
          ) : null}
        </p>
      )}
    </>
  );
}

function SeatRow({
  member,
  viewerPuuid,
  showRoles,
}: {
  member: MemberView;
  viewerPuuid: string | null;
  showRoles: boolean;
}) {
  const you = member.puuid === viewerPuuid;
  const justJoined = useJustJoined(member.joinedAt);

  return (
    <li className={you ? 'cn-rack-row cn-you' : 'cn-rack-row'}>
      {/* The three-second marker. Always mounted, so removing it is a 150ms opacity fade
          rather than a row that changes shape (05-design.md, "Lobby member list"). */}
      <span className={justJoined ? 'cn-new cn-new-on' : 'cn-new'} aria-hidden="true" />
      <span className="cn-rack-name">{renderWebName(member.name)}</span>
      {showRoles ? <RoleCell member={member} /> : null}
      <span className="cn-num cn-rack-rating">{member.rating}</span>
    </li>
  );
}

/**
 * `top · mid`, or `flexible` for somebody who has declared nothing on a screen where somebody
 * else has. Never `top / mid`: a slash between two roles reads as a fraction next to a column
 * of numbers.
 *
 * **Tonight's roles, not the profile's** (M3.6): a role tap writes `lobby_members.role_override`,
 * and core's `resolveRoles` makes that the player's main with their usual main as the backup —
 * so a row that has tapped `support` reads `support · jungle`, which is what the bot is about
 * to build teams from. The call is core's own (`lib/tonight/roles.ts`), never a copy of the
 * rule, so the page and the balancer cannot disagree about what an override means.
 */
function RoleCell({ member }: { member: MemberView }) {
  const { main, secondary } = tonightRoles(member);
  if (main === null) {
    return <span className="cn-num cn-rack-roles">{FLEXIBLE_ROLE}</span>;
  }

  return (
    <span className="cn-num cn-rack-roles">
      <RoleIcon role={main} />
      {main}
      {secondary === null ? null : (
        // Hidden below 480px by `tonight.css`, where the pair does not fit beside a name.
        <span className="cn-rack-second">{` · ${secondary}`}</span>
      )}
    </span>
  );
}

/** `05-design.md`: a member who joined in the last 3s carries a 2px brand left rule. */
const JUST_JOINED_MS = 3_000;

/**
 * Has this row been on the page for less than three seconds?
 *
 * Always `false` on the server, and decided after mount: the answer depends on the clock, and
 * a server render that disagreed with the first client render is a hydration mismatch. The
 * timer clears itself, so a row stops being new exactly once and nothing polls.
 */
function useJustJoined(joinedAt: string): boolean {
  const [justJoined, setJustJoined] = useState(false);

  useEffect(() => {
    // A row whose timestamp is in the future — the database's clock is not the phone's — is
    // not new, it is skewed, and it must not keep a brand border for the rest of the night.
    const age = Date.now() - Date.parse(joinedAt);
    if (!Number.isFinite(age) || age < 0 || age >= JUST_JOINED_MS) return;

    setJustJoined(true);
    const timer = setTimeout(() => setJustJoined(false), JUST_JOINED_MS - age);
    return () => clearTimeout(timer);
  }, [joinedAt]);

  return justJoined;
}
