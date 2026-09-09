import { notFound } from 'next/navigation';
import { cache } from 'react';
import { loadPlayerBoard } from '@/lib/board/load';
import { createPublicClient } from '@/lib/publicClient';
import { renderWebName } from '@/lib/tonight/copy';
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
 */
export const dynamic = 'force-dynamic';

interface PlayerPageProps {
  params: Promise<{ puuid: string }>;
}

/**
 * Wrapped in React's `cache` so the title and the page cost one load between them: Next calls
 * `generateMetadata` and the component separately, and this page's load is several queries.
 */
const loadPlayer = cache(async (puuid: string) => loadPlayerBoard(createPublicClient(), puuid));

export async function generateMetadata({ params }: PlayerPageProps) {
  const { puuid } = await params;
  const player = await loadPlayer(puuid);
  return { title: player === null ? 'Kustom' : `${renderWebName(player.name)} · Kustom` };
}

export default async function PlayerPage({ params }: PlayerPageProps) {
  const { puuid } = await params;
  const player = await loadPlayer(puuid);
  if (player === null) notFound();

  // **The session decides nothing here** (M3.19): a lineup marks the player whose page it is,
  // and marking the viewer as well put the `brand` rule on two rows of five on every night the
  // two of them played together. With nothing left for it to decide, the page does not read it.
  return <PlayerView player={player} />;
}
