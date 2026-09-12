import { windowHref } from '../board/window';
import type { WindowKind } from '../night';
import type { QueueKind } from './queue';

/**
 * The extra query `/games` keeps across the window picker and the Everyone link:
 * `?p=` when focused, `?queue=aram` when not on Rift. The default queue is omitted so a
 * copied Rift URL stays the same length it was before the toggle existed.
 */
export function gamesQuery(options: {
  focusPuuid?: string | null | undefined;
  queue: QueueKind;
}): Record<string, string> {
  const query: Record<string, string> = {};
  if (options.focusPuuid) query.p = options.focusPuuid;
  if (options.queue !== 'sr') query.queue = options.queue;
  return query;
}

export function gamesHref(
  window: WindowKind,
  options: { focusPuuid?: string | null | undefined; queue: QueueKind },
): string {
  return windowHref('/games', window, gamesQuery(options));
}
