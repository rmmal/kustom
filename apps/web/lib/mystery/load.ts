import { cookies } from 'next/headers';
import { getServiceClient } from '../supabase';
import { nightTimeZone } from '../tonight/night';
import { loadMysteryPage, type MysteryPageState } from './service';
import { isVisitorId, MYSTERY_VISITOR_COOKIE } from './visitor';

/**
 * Today's mystery for a public page. Failures log and return null so `/` never
 * 500s because the puzzle could not be built.
 */
export async function loadMysteryOrNone(now: Date = new Date()): Promise<MysteryPageState | null> {
  try {
    const jar = await cookies();
    const visitor = jar.get(MYSTERY_VISITOR_COOKIE)?.value;
    return await loadMysteryPage(getServiceClient(), {
      now,
      timeZone: nightTimeZone(),
      visitorId: isVisitorId(visitor) ? visitor : null,
    });
  } catch (error) {
    console.error('daily mystery: page load failed', error);
    return null;
  }
}
