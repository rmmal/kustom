import { notFound } from 'next/navigation';
import { WINDOW_LABELS } from '@/lib/board/copy';
import { parseWindow, STATS_WINDOW } from '@/lib/board/window';
import { createPublicClient } from '@/lib/publicClient';
import { STATS_LABEL } from '@/lib/stats/copy';
import { loadStats } from '@/lib/stats/load';
import { nightTimeZone } from '@/lib/tonight/night';
import { StatsView } from '../../_stats/StatsView';
import '../../board.css';
import '../../stats.css';

/**
 * `/stats` (M5.4), read through one of the five time windows (M5.12).
 *
 * **The page somebody opens at work the next morning**, not a page anybody looks at during a
 * night: no input, no toggles, no filters beyond the window picker, and nothing here writes to
 * the database. Server-rendered from the **anon key** through RLS, like `/leaderboard`, because
 * it is opened from a link with no login.
 *
 * **`?window=` is the whole of the page's state, and it defaults to `This month`** — not to the
 * board's `This week`: every minimum on this page is five games or more, and a five-game
 * minimum against a five-game week prints nothing but "not enough yet". One tap gets to the
 * week. Anything that is not one of the five is a 404 and never a silent fallback.
 */

/**
 * **Dynamic, like `/leaderboard`, and product's five minutes cannot apply here.**
 *
 * The brief asks for `export const revalidate = 300`, on the reasoning that five minutes is
 * invisible on a page about a month and means a refresh war costs one query. This page cannot
 * take it: it reads `searchParams` (the window is the whole of its state) and it renders inside
 * the shell, which reads the session cookie for the "you" rule — so Next renders it per request
 * whatever the number says, and with `revalidate` on it the build spends a static attempt
 * failing on `cookies` and logging it. `force-dynamic` is the same outcome, stated.
 *
 * What the brief's reasoning actually buys is unchanged and is the important half: **no
 * precomputed stats table and no materialised view**, because either would be a second thing
 * that can disagree with `game_players`, and `game_players` is the truth. If this page ever
 * gets slow the fix is `STATS_MAX_GAMES`, not a cache table.
 */
export const dynamic = 'force-dynamic';

interface StatsPageProps {
  searchParams: Promise<{ window?: string | string[] }>;
}

export async function generateMetadata({ searchParams }: StatsPageProps) {
  const kind = parseWindow((await searchParams).window, STATS_WINDOW);
  return {
    title: kind === null ? `Kustom · ${STATS_LABEL}` : `${WINDOW_LABELS[kind]} · ${STATS_LABEL} · Kustom`,
  };
}

export default async function StatsPage({ searchParams }: StatsPageProps) {
  const kind = parseWindow((await searchParams).window, STATS_WINDOW);
  if (kind === null) notFound();

  const stats = await loadStats(createPublicClient(), { window: kind, timeZone: nightTimeZone() });

  return <StatsView stats={stats} />;
}
