/**
 * Who is reading the tonight page, as the page has to branch on it (M3.6).
 *
 * Until M3.6 there were two answers — a linked player, or nobody — and `null` served for both.
 * The role tap needs three, because the middle one is the day-one case for **everybody**: a
 * friend who has signed in with Discord and matches no `players` row yet. That visitor is not
 * anonymous (they have an identity we can write) and not linked (there is no row to tap), and
 * the page owes them the `That's me` list rather than a sign-in button they have already
 * pressed.
 *
 * A discriminated union rather than two nullable fields, per `CLAUDE.md`: `puuid` exists on
 * exactly the state that has one, so no component can read it from a visitor who has none.
 *
 * This file is deliberately free of `next/headers` and of any Supabase import: it is the type
 * the client components share with `lib/viewer.ts`, which is the server half.
 */
export type ViewerState =
  | { kind: 'anonymous' }
  | { kind: 'unlinked' }
  | { kind: 'linked'; puuid: string; isAdmin: boolean };

/** Nobody is signed in, which is the ordinary case and the one the page is designed for. */
export const ANONYMOUS_VIEWER: ViewerState = { kind: 'anonymous' };

/** The puuid whose seat gets the `brand` "you" rule, or `null` for everybody else. */
export function viewerPuuid(viewer: ViewerState): string | null {
  return viewer.kind === 'linked' ? viewer.puuid : null;
}

/**
 * Decided on the server from the session (`lib/viewer.ts`) and used to draw the reroll control
 * and the role tap on somebody else's row. It is never the gate: the routes behind both check
 * the session again before they write.
 */
export function viewerIsAdmin(viewer: ViewerState): boolean {
  return viewer.kind === 'linked' && viewer.isAdmin;
}
