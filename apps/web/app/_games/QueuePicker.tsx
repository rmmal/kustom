import Link from 'next/link';
import { windowHref } from '@/lib/board/window';
import { QUEUE_LABELS, QUEUE_PICKER_LABEL } from '@/lib/games/copy';
import { QUEUE_ORDER, type QueueKind } from '@/lib/games/queue';
import type { WindowKind } from '@/lib/night';

/**
 * Summoner's Rift · ARAM. Same chip recipe as the window picker: two links, the selected one
 * marked `aria-current="page"`, no client state. The default queue is omitted from the href
 * so a copied Rift URL stays `?window=…`.
 *
 * Used on `/games` and `/fun`. Extra query (`?p=` on a focused games list) rides along.
 */

export function QueuePicker({
  path,
  window,
  selected,
  query = {},
}: {
  path: string;
  window: WindowKind;
  selected: QueueKind;
  query?: Record<string, string>;
}) {
  return (
    <nav className="cn-windows cn-queues" aria-label={QUEUE_PICKER_LABEL}>
      {QUEUE_ORDER.map((kind) => {
        const extra = { ...query };
        if (kind === 'sr') delete extra.queue;
        else extra.queue = kind;
        return (
          <Link
            key={kind}
            className={kind === selected ? 'cn-window cn-window-on' : 'cn-window'}
            href={windowHref(path, window, extra)}
            {...(kind === selected ? { 'aria-current': 'page' as const } : {})}
          >
            {QUEUE_LABELS[kind]}
          </Link>
        );
      })}
    </nav>
  );
}
