import { STANDINGS_LABEL } from '@/lib/board/copy';
import { loadBoard } from '@/lib/board/load';
import { createPublicClient } from '@/lib/publicClient';
import { currentViewer } from '@/lib/viewer';
import { BoardView } from '../_board/BoardView';
import '../board.css';

/**
 * `/leaderboard` (M3.5). The season table, ordered by Proven.
 *
 * Server-rendered from the **anon key** through RLS (`lib/publicClient.ts`), like the tonight
 * page and for the same reason: it is opened from a link, on a phone, with no login. There is
 * no client component on this page and no subscription — a board is not live state, and the
 * numbers only move when a game ends.
 *
 * The one thing the session decides is which row gets the `accent` "you" rule. Nothing here
 * writes to the database.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: `Customs Night · ${STANDINGS_LABEL}` };

export default async function LeaderboardPage() {
  const [board, viewer] = await Promise.all([loadBoard(createPublicClient()), currentViewer()]);

  return <BoardView board={board} viewerPuuid={viewer?.puuid ?? null} />;
}
