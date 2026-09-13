import { cookies } from 'next/headers';
import { getServiceClient } from '../supabase';
import { nightTimeZone } from '../tonight/night';
import { emptyMysteryPage, loadMysteryPage, type MysteryPageState } from './service';
import { isVisitorId, MYSTERY_VISITOR_COOKIE } from './visitor';

/**
 * Today's mystery for a public page. Failures log and return the empty card so
 * `/` never 500s because the puzzle could not be built — and never omits the
 * block the `/mystery` tab still shows.
 */
export async function loadMysteryOrNone(now: Date = new Date()): Promise<MysteryPageState> {
  const timeZone = nightTimeZone();
  try {
    const jar = await cookies();
    const visitor = jar.get(MYSTERY_VISITOR_COOKIE)?.value;
    return await loadMysteryPage(getServiceClient(), {
      now,
      timeZone,
      visitorId: isVisitorId(visitor) ? visitor : null,
    });
  } catch (error) {
    console.error('daily mystery: page load failed', error);
    return emptyMysteryPage(now, timeZone);
  }
}
