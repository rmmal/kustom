import { loadTopPlayers } from '@/lib/board/load';
import { createPublicClient } from '@/lib/publicClient';
import { loadTonight } from '@/lib/tonight/load';
import { nightTimeZone, tonightStart } from '@/lib/tonight/night';
import { currentViewer } from '@/lib/viewer';
import { TonightLive } from '../_tonight/TonightLive';
import '../tonight.css';

/**
 * The tonight page (M3.4). The link somebody pastes in WhatsApp at 21:40.
 *
 * Server-rendered with real content — the member list, the teams, the result, whichever the
 * newest non-`abandoned` lobby of the night is in — so the first paint answers "is the night
 * happening and am I in it" with no spinner and no login. `TonightLive` then attaches the
 * Realtime subscription and re-reads the same snapshot on every change.
 *
 * Reads go through the **anon key** and RLS (`lib/publicClient.ts`). The one thing the session
 * decides is whether the reroll control is drawn, and the route behind it re-checks the
 * session server-side anyway. Nothing on this page writes to the database.
 */
export const dynamic = 'force-dynamic';

/** The rail's `Top of the board` (`05-design.md`, "Breakpoints and the desktop grid"). */
const RAIL_BOARD_ROWS = 5;

export default async function TonightPage() {
  const client = createPublicClient();
  const [snapshot, viewer, topPlayers] = await Promise.all([
    loadTonight(client, { nightStart: tonightStart(), timeZone: nightTimeZone() }),
    currentViewer(),
    // The rail, read once with the page and never re-read on a Realtime event: it is the one
    // block on this screen that is allowed to be a few minutes old, because it is the only one
    // nobody is watching.
    loadTopPlayers(client, { limit: RAIL_BOARD_ROWS }),
  ]);

  return (
    <TonightLive
      initial={snapshot}
      viewerPuuid={viewer?.puuid ?? null}
      isAdmin={viewer?.isAdmin ?? false}
      topPlayers={topPlayers}
    />
  );
}
