import type { ReactNode } from 'react';
import { currentViewer } from '@/lib/viewer';
import { Shell } from '../_shell/Shell';
import '../shell.css';

/**
 * Every public page — the tonight page, `/leaderboard`, `/p/[puuid]` — inside the Floodlit
 * shell (M3.18). `/admin` is outside this route group and therefore outside the shell, which
 * is the whole reason the group exists; the URLs are unchanged by it.
 *
 * `currentViewer()` is React-cached per request, so the footer's `Your games` link costs the
 * page nothing: the tonight page already asks the same question for the "you" rule.
 */
export default async function SiteLayout({ children }: { children: ReactNode }) {
  const viewer = await currentViewer();

  return <Shell viewerPuuid={viewer?.puuid ?? null}>{children}</Shell>;
}
