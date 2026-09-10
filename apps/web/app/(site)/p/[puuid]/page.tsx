import { notFound } from 'next/navigation';
import { cache } from 'react';
import { loadPlayerBoard } from '@/lib/board/load';
import { PLAYER_WINDOW, parseWindow } from '@/lib/board/window';
import type { WindowKind } from '@/lib/night';
import { createPublicClient } from '@/lib/publicClient';
import { renderWebName } from '@/lib/tonight/copy';
import { nightTimeZone } from '@/lib/tonight/night';
import { PlayerView } from '../../../_board/PlayerView';
import '../../../board.css';

/**
 * `/p/[puuid]` (M3.5). One player: the two numbers, the `Rating` history, the role record and
 * the last few games.
 *
 * **Keyed by PUUID**, like everything else in this product: names get renamed and the link a
 * friend pasted last month still opens the right page. Read with the anon key through RLS,
 * server-rendered, no client component and nothing written.
 *
 * A puuid with no `players_public` row is a 404 rather than an empty page — there is nobody to
 * show, and an invented blank profile is worse than the browser's own answer.
 *
 * **Its default window is `All time`** (M5.12), unlike `/leaderboard`'s: the page is a person's
 * history, and one that opened on six days of games would answer a question nobody asked it.
 * The parameter is the same word on both pages, so a link keeps its meaning across them.
 */
export const dynamic = 'force-dynamic';

interface PlayerPageProps {
  params: Promise<{ puuid: string }>;
  searchParams: Promise<{ window?: string | string[] }>;
}

/**
 * Wrapped in React's `cache` so the title and the page cost one load between them: Next calls
 * `generateMetadata` and the component separately, and this page's load is several queries.
 */
const loadPlayer = cache(async (puuid: string, window: WindowKind) =>
  loadPlayerBoard(createPublicClient(), puuid, { window, timeZone: nightTimeZone() }),
);

export async function generateMetadata({ params, searchParams }: PlayerPageProps) {
  const [{ puuid }, query] = await Promise.all([params, searchParams]);
  const window = parseWindow(query.window, PLAYER_WINDOW);
  // An unknown window is the page's 404, not the title's problem: it renders `Kustom` and the
  // component below refuses the request.
  const player = window === null ? null : await loadPlayer(puuid, window);
  return { title: player === null ? 'Kustom' : `${renderWebName(player.name)} · Kustom` };
}

export default async function PlayerPage({ params, searchParams }: PlayerPageProps) {
  const [{ puuid }, query] = await Promise.all([params, searchParams]);
  const window = parseWindow(query.window, PLAYER_WINDOW);
  if (window === null) notFound();

  const player = await loadPlayer(puuid, window);
  if (player === null) notFound();

  // **The session decides nothing here** (M3.19): a lineup marks the player whose page it is,
  // and marking the viewer as well put the `brand` rule on two rows of five on every night the
  // two of them played together. With nothing left for it to decide, the page does not read it.
  return <PlayerView player={player} />;
}
