import { notFound } from 'next/navigation';
import { WINDOW_LABELS } from '@/lib/board/copy';
import { parseWindow } from '@/lib/board/window';
import { GAMES_LABEL, QUEUE_LABELS } from '@/lib/games/copy';
import { parseFocusPuuid } from '@/lib/games/params';
import { GAMES_QUEUE, parseQueue } from '@/lib/games/queue';
import { GAMES_WINDOW } from '@/lib/games/window';
import { createPublicClient } from '@/lib/publicClient';
import { loadGamesHistory } from '@/lib/stats/load';
import { nightTimeZone } from '@/lib/tonight/night';
import { GamesView } from '../../_games/GamesView';
import '../../board.css';
import '../../board-parts.css';
import '../../games.css';

/**
 * `/games`: captured customs, newest first, each expandable into both scoreboards.
 *
 * Same anon read and same window picker as `/stats`. `?window=` plus optional `?p=` (one
 * player's customs) and `?queue=` (`sr` / `aram`, default Rift) is the whole of the page's
 * state. Unknown values 404.
 */
export const dynamic = 'force-dynamic';

interface GamesPageProps {
  searchParams: Promise<{
    window?: string | string[];
    p?: string | string[];
    queue?: string | string[];
  }>;
}

export async function generateMetadata({ searchParams }: GamesPageProps) {
  const params = await searchParams;
  const kind = parseWindow(params.window, GAMES_WINDOW);
  const queue = parseQueue(params.queue, GAMES_QUEUE);
  if (kind === null || queue === null) return { title: `Kustom · ${GAMES_LABEL}` };
  return {
    title:
      queue === 'sr'
        ? `${WINDOW_LABELS[kind]} · ${GAMES_LABEL} · Kustom`
        : `${WINDOW_LABELS[kind]} · ${QUEUE_LABELS[queue]} · ${GAMES_LABEL} · Kustom`,
  };
}

export default async function GamesPage({ searchParams }: GamesPageProps) {
  const params = await searchParams;
  const kind = parseWindow(params.window, GAMES_WINDOW);
  if (kind === null) notFound();

  const queue = parseQueue(params.queue, GAMES_QUEUE);
  if (queue === null) notFound();

  const focus = parseFocusPuuid(params.p);
  if (focus === null) notFound();

  const history = await loadGamesHistory(createPublicClient(), {
    window: kind,
    timeZone: nightTimeZone(),
    queue,
    ...(focus === undefined ? {} : { focusPuuid: focus }),
  });

  return <GamesView history={history} />;
}
