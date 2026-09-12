import { notFound } from 'next/navigation';
import { WINDOW_LABELS } from '@/lib/board/copy';
import { parseWindow, STATS_WINDOW } from '@/lib/board/window';
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
 * Same window picker, same anon read, same `gateGame` universe. `?window=` is the whole of
 * the page's state and defaults to `This month`, because every rate on this page wants five
 * games and a week often does not have them.
 */
export const dynamic = 'force-dynamic';

interface FunPageProps {
  searchParams: Promise<{ window?: string | string[] }>;
}

export async function generateMetadata({ searchParams }: FunPageProps) {
  const kind = parseWindow((await searchParams).window, STATS_WINDOW);
  return {
    title: kind === null ? `Kustom · ${FUN_LABEL}` : `${WINDOW_LABELS[kind]} · ${FUN_LABEL} · Kustom`,
  };
}

export default async function FunPage({ searchParams }: FunPageProps) {
  const kind = parseWindow((await searchParams).window, STATS_WINDOW);
  if (kind === null) notFound();

  const facts = await loadFunFacts(createPublicClient(), { window: kind, timeZone: nightTimeZone() });

  return <FunView facts={facts} />;
}
