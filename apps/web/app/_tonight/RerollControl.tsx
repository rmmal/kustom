'use client';

import { type FormEvent, useState } from 'react';
import { NO_MORE_SPLITS } from '@/lib/admin/reroll';
import { REROLL_LABEL } from '@/lib/tonight/copy';
import { nextRerollSplit } from '@/lib/tonight/state';
import type { SplitChoice } from '@/lib/tonight/types';

/**
 * The reroll control on the explanation strip (M3.2's button, M3.4's home for it).
 *
 * One button, one meaning: promote the next split down the list. It names the split it means
 * in the body, exactly as `/admin` does, so a double tap on a slow phone promotes the same
 * split twice — a no-op — instead of skipping one the group never saw.
 *
 * **The page does not write.** This posts to `/api/admin/lobbies/[lobbyId]/reroll`, which
 * re-checks the Supabase session and `players.is_admin` server-side before anything moves.
 * Being drawn is not permission; a non-admin who forged the markup gets a 403.
 *
 * It is a real `<form>` with a real action, intercepted when JavaScript is running. Submitted
 * as a form — the no-JavaScript fallback — it carries `redirectTo=/` and comes back here with
 * the route's notice in the query string; submitted as JSON, which is the normal path, nothing
 * navigates at all and the promoted split arrives through Realtime like every other change,
 * which is what keeps the strip from scrolling under a thumb.
 */
export function RerollControl({ lobbyId, splits }: { lobbyId: string; splits: readonly SplitChoice[] }) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const next = nextRerollSplit(splits);
  const action = `/api/admin/lobbies/${lobbyId}/reroll`;

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    if (next === null) return;
    event.preventDefault();
    setPending(true);
    setFailed(null);
    try {
      const response = await fetch(action, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ splitId: next.id }),
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        setFailed(errorOf(body));
      }
    } catch {
      setFailed('That did not reach the server. The teams have not changed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="cn-reroll" method="post" action={action} onSubmit={submit}>
      {next === null ? (
        // The last split is on the board, so the group has seen the whole list. The route
        // answers the same sentence to a press that gets through anyway (M3.2).
        <p className="cn-reroll-note">{NO_MORE_SPLITS}</p>
      ) : (
        <>
          <input type="hidden" name="splitId" value={next.id} />
          {/* Only the form path reads this. The route re-validates it as a path on this site. */}
          <input type="hidden" name="redirectTo" value="/" />
        </>
      )}
      <button className="cn-button" type="submit" disabled={next === null || pending}>
        {REROLL_LABEL}
      </button>
      {failed === null ? null : (
        <p className="cn-reroll-note" role="alert">
          {failed}
        </p>
      )}
    </form>
  );
}

/** The API's envelope is `{ ok: false, error }`. Anything else gets a sentence of our own. */
function errorOf(body: unknown): string {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const error = (body as { error: unknown }).error;
    if (typeof error === 'string' && error.length > 0) return error;
  }
  return 'That reroll did not go through. The teams have not changed.';
}
