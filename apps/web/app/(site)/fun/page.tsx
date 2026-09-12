import { notFound } from 'next/navigation';
import { WINDOW_LABELS } from '@/lib/board/copy';
import { parseWindow, STATS_WINDOW } from '@/lib/board/window';
import { QUEUE_LABELS } from '@/lib/games/copy';
import { GAMES_QUEUE, parseQueue } from '@/lib/games/queue';
import { createPublicClient } from '@/lib/publicClient';
import { FUN_LABEL } from '@/lib/stats/funCopy';
import { loadFunFacts } from '@/lib/stats/load';
import { nightTimeZone } from '@/lib/tonight/night';
import { FunView } from '../../_fun/FunView';
import '../../board.css';
import '../../stats.css';

/**
 * `/fun` (M5.24): single-game records from the scoreboard columns `/stats` does not fold.
 *
 * Same window picker, same anon read, same `gateGame` universe. `?window=` and `?queue=`
 * (`sr` / `aram`, default Rift) are the whole of the page's state. Default window is
 * `This month`, because every rate on this page wants five games and a week often does not
 * have them.
 */
export const dynamic = 'force-dynamic';

interface FunPageProps {
  searchParams: Promise<{ window?: string | string[]; queue?: string | string[] }>;
}

export async function generateMetadata({ searchParams }: FunPageProps) {
  const params = await searchParams;
  const kind = parseWindow(params.window, STATS_WINDOW);
  const queue = parseQueue(params.queue, GAMES_QUEUE);
  if (kind === null || queue === null) return { title: `Kustom · ${FUN_LABEL}` };
  return {
    title:
      queue === 'sr'
        ? `${WINDOW_LABELS[kind]} · ${FUN_LABEL} · Kustom`
        : `${WINDOW_LABELS[kind]} · ${QUEUE_LABELS[queue]} · ${FUN_LABEL} · Kustom`,
  };
}

export default async function FunPage({ searchParams }: FunPageProps) {
  const params = await searchParams;
  const kind = parseWindow(params.window, STATS_WINDOW);
  const queue = parseQueue(params.queue, GAMES_QUEUE);
  if (kind === null || queue === null) notFound();

  const facts = await loadFunFacts(createPublicClient(), {
    window: kind,
    queue,
    timeZone: nightTimeZone(),
  });

  return <FunView facts={facts} />;
}
