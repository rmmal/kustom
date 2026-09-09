import { notFound } from 'next/navigation';
import { cache } from 'react';
import { loadPlayerBoard } from '@/lib/board/load';
import { createPublicClient } from '@/lib/publicClient';
import { renderWebName } from '@/lib/tonight/copy';
import { currentViewer } from '@/lib/viewer';
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
  return { title: player === null ? 'Customs Night' : `${renderWebName(player.name)} · Customs Night` };
}

export default async function PlayerPage({ params }: PlayerPageProps) {
  const { puuid } = await params;
  const [player, viewer] = await Promise.all([loadPlayer(puuid), currentViewer()]);
  if (player === null) notFound();

  return <PlayerView player={player} viewerPuuid={viewer?.puuid ?? null} />;
}
