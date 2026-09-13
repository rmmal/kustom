import { MYSTERY_TITLE } from '@/lib/mystery/copy';
import { loadMysteryOrNone } from '@/lib/mystery/load';
import { MysteryLive } from '../../_mystery/MysteryLive';
import '../../mystery.css';
import '../../tonight.css';

/**
 * `/mystery` (M5.32): today's one accountless Daily Mystery. The same card lives
 * on `/` so the WhatsApp link opens it without a second tap.
 */
export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return { title: `${MYSTERY_TITLE} · Kustom` };
}

export default async function MysteryPage() {
  const mystery = await loadMysteryOrNone();
  const state = mystery ?? {
    kind: 'empty' as const,
    empty: { empty: true as const, expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
  };

  return (
    <main className="cn-page">
      <MysteryLive initial={state} />
    </main>
  );
}
