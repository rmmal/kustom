import { cookies } from 'next/headers';
import { cache } from 'react';
import { discordIdFromUser, supabaseSessionUser } from './adminAuth';
import { getServiceClient } from './supabase';
import { createAuthClient, readOnlyCookieJar } from './supabaseAuth';

/**
 * Who is reading the tonight page, when anybody is (M3.4).
 *
 * The page is public and renders completely without this: it decides two cosmetic things —
 * which row gets the `accent` "you" border, and whether the sit-out strip uses the
 * second-person sentence — and one real one: whether the reroll control is drawn.
 *
 * **`isAdmin` is decided here, on the server, from the session.** The control it draws posts to
 * `/api/admin/lobbies/[lobbyId]/reroll`, which checks the session again with the service-role
 * client before it writes anything, so this is a rendering decision and never the gate. A
 * client that lied about it would get a 403 from the route.
 *
 * Deliberately **not** `resolveAdmin`: that calls `ensureBootstrapAdmin`, which writes. A page
 * never writes to the database (CLAUDE.md), and the tonight page is the one page that anyone
 * on the internet can open.
 */
export interface Viewer {
  puuid: string;
  isAdmin: boolean;
}

/**
 * The signed-in viewer's player row, or `null` for the ordinary case: nobody is signed in.
 *
 * Wrapped in React's `cache` so the page asks once per request. Every failure is `null` — no
 * session, no Discord identity, no linked player, no configured environment, Supabase
 * unreachable. A friend opening a WhatsApp link must never see an error page because the auth
 * server was slow.
 */
export const currentViewer: () => Promise<Viewer | null> = cache(async () => {
  try {
    const store = await cookies();
    const jar = readOnlyCookieJar(store.getAll().map(({ name, value }) => ({ name, value })));
    // No session cookie, no round trip: this is the common path and it costs nothing.
    if (jar.getAll().every((cookie) => !cookie.name.startsWith('sb-'))) return null;

    const user = await supabaseSessionUser(createAuthClient(jar))();
    if (user === null) return null;

    const discordId = discordIdFromUser(user);
    if (discordId === null) return null;

    // `discord_id` is service-role only: anon has no privilege on `players` at all, which is
    // exactly why the column lives there and not in `players_public`. This read never leaves
    // the server and only the puuid and the admin flag reach the page.
    const { data, error } = await getServiceClient()
      .from('players')
      .select('puuid, is_admin')
      .eq('discord_id', discordId)
      .maybeSingle();
    if (error !== null || data === null) return null;

    return { puuid: data.puuid, isAdmin: data.is_admin };
  } catch (error) {
    console.error('tonight page: reading the viewer failed', error);
    return null;
  }
});
