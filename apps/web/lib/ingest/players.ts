import type { PlayerInsert, PlayerUpdate } from '@customs/db';
import type { ServiceClient } from '../supabase';

/**
 * Lazy player creation. A `players` row appears the first time a PUUID shows up in a lobby,
 * a game or a rank report (`docs/01-architecture.md` "Data model") — there is no sign-up.
 *
 * PUUID is the identity. Riot IDs and summoner ids are display data: refreshed when the
 * client reports them, never used to match a row and never overwritten with null.
 *
 * `display_name` (M1.7) is the name the group reads on every surface. It follows the Riot
 * `gameName` automatically until an admin overrides it, and goes back on automatic when the
 * admin clears the override — see `isDisplayNameAutomatic`.
 */

export interface PlayerIdentityInput {
  puuid: string;
  summonerId?: string | null;
  gameName?: string | null;
  tagLine?: string | null;
}

/** PUUID to `players.id`, for every PUUID passed in. */
export type PlayerIdsByPuuid = ReadonlyMap<string, string>;

/**
 * Creates the missing rows, refreshes changed display data, and returns the id of every
 * PUUID given. Safe to run concurrently: the insert is `on conflict do nothing`.
 */
export async function ensurePlayers(
  client: ServiceClient,
  inputs: readonly PlayerIdentityInput[],
): Promise<PlayerIdsByPuuid> {
  const wanted = mergeByPuuid(inputs);
  if (wanted.size === 0) return new Map();

  const puuids = [...wanted.keys()];

  // A new row is created with everything the client just told us, `display_name` included:
  // on creation the display name *is* the reported `gameName` (null when none was reported,
  // e.g. a PUUID first seen in an eog block). Existing rows are untouched here.
  const inserts: PlayerInsert[] = puuids.map((puuid) => {
    const input = wanted.get(puuid);
    return {
      puuid,
      summoner_id: input?.summonerId ?? null,
      game_name: input?.gameName ?? null,
      tag_line: input?.tagLine ?? null,
      display_name: input?.gameName ?? null,
    };
  });
  const { error: insertError } = await client
    .from('players')
    .upsert(inserts, { onConflict: 'puuid', ignoreDuplicates: true });
  if (insertError) {
    throw new Error(`ensurePlayers: insert failed: ${insertError.message}`);
  }

  const { data, error } = await client
    .from('players')
    .select('id, puuid, summoner_id, game_name, tag_line, display_name')
    .in('puuid', puuids);
  if (error) {
    throw new Error(`ensurePlayers: select failed: ${error.message}`);
  }

  const ids = new Map<string, string>();
  for (const row of data ?? []) {
    ids.set(row.puuid, row.id);

    const input = wanted.get(row.puuid);
    if (!input) continue;

    // Only fields the client actually reported, and only when they changed, so a repeated
    // post of the same roster writes nothing at all.
    const patch: PlayerUpdate = {};
    if (input.summonerId != null && input.summonerId !== row.summoner_id) {
      patch.summoner_id = input.summonerId;
    }
    if (input.gameName != null) {
      if (input.gameName !== row.game_name) patch.game_name = input.gameName;
      // The Riot ID moved: carry the display name with it, but only while nobody has
      // overridden it. An admin's name survives every rename after it.
      if (isDisplayNameAutomatic(row) && input.gameName !== row.display_name) {
        patch.display_name = input.gameName;
      }
    }
    if (input.tagLine != null && input.tagLine !== row.tag_line) patch.tag_line = input.tagLine;
    if (Object.keys(patch).length === 0) continue;

    const { error: updateError } = await client.from('players').update(patch).eq('id', row.id);
    if (updateError) {
      throw new Error(`ensurePlayers: refresh of ${row.puuid} failed: ${updateError.message}`);
    }
  }

  const missing = puuids.filter((puuid) => !ids.has(puuid));
  if (missing.length > 0) {
    throw new Error(`ensurePlayers: ${missing.length} puuid(s) missing after insert`);
  }

  return ids;
}

/**
 * "Nobody has overridden this name." True while `display_name` still equals the `gameName` we
 * stored last time, and true when it is null — clearing the admin field posts `""`, stores
 * null, and that is how a row is put back on automatic (M1.7).
 */
export function isDisplayNameAutomatic(row: {
  game_name: string | null;
  display_name: string | null;
}): boolean {
  return row.display_name === null || row.display_name === row.game_name;
}

/**
 * The same PUUID can appear twice in one payload (a client quirk, or a spectator listed
 * again). Merge instead of failing, preferring the last non-null value for each field.
 */
function mergeByPuuid(inputs: readonly PlayerIdentityInput[]): Map<string, PlayerIdentityInput> {
  const merged = new Map<string, PlayerIdentityInput>();
  for (const input of inputs) {
    const previous = merged.get(input.puuid);
    merged.set(input.puuid, {
      puuid: input.puuid,
      summonerId: input.summonerId ?? previous?.summonerId ?? null,
      gameName: input.gameName ?? previous?.gameName ?? null,
      tagLine: input.tagLine ?? previous?.tagLine ?? null,
    });
  }
  return merged;
}
