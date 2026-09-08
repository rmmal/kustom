import type { ServiceClient } from '../supabase';
import { type AdminWriteResult, writeOk } from './result';

/**
 * The single `discord_config` row (`/admin/discord`).
 *
 * The table is keyed by guild id and holds a secret — the webhook URL is a bearer credential
 * for posting into the results channel — so it has no read policy at all and only the service
 * role ever touches it. The page shows the webhook masked; an admin overwrites it by typing a
 * new one, and clears it with the explicit "clear" box. An empty field means "leave it alone",
 * because a masked value cannot be round-tripped through a form.
 */

export interface AdminDiscordConfig {
  guildId: string;
  webhookUrl: string | null;
  resultsChannelId: string | null;
  lobbyVoiceChannelId: string | null;
  blueVoiceChannelId: string | null;
  redVoiceChannelId: string | null;
  updatedAt: string;
}

/**
 * Every configured guild, oldest first. There should be one; the page renders the first and
 * says so when there is more than one, rather than picking silently.
 */
export async function listDiscordConfigs(client: ServiceClient): Promise<AdminDiscordConfig[]> {
  const { data, error } = await client
    .from('discord_config')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) throw new Error(`listDiscordConfigs failed: ${error.message}`);
  return (data ?? []).map(toAdminDiscordConfig);
}

/** One guild's row, by its primary key. */
export async function getDiscordConfig(
  client: ServiceClient,
  guildId: string,
): Promise<AdminDiscordConfig | null> {
  const { data, error } = await client
    .from('discord_config')
    .select('*')
    .eq('guild_id', guildId)
    .maybeSingle();

  if (error) throw new Error(`getDiscordConfig failed: ${error.message}`);
  if (!data) return null;
  return toAdminDiscordConfig(data);
}

function toAdminDiscordConfig(data: {
  guild_id: string;
  webhook_url: string | null;
  results_channel_id: string | null;
  lobby_voice_channel_id: string | null;
  blue_voice_channel_id: string | null;
  red_voice_channel_id: string | null;
  updated_at: string;
}): AdminDiscordConfig {
  return {
    guildId: data.guild_id,
    webhookUrl: data.webhook_url,
    resultsChannelId: data.results_channel_id,
    lobbyVoiceChannelId: data.lobby_voice_channel_id,
    blueVoiceChannelId: data.blue_voice_channel_id,
    redVoiceChannelId: data.red_voice_channel_id,
    updatedAt: data.updated_at,
  };
}

export interface SaveDiscordConfigInput {
  guildId: string;
  /** `undefined` keeps whatever is stored; a string overwrites it; `null` clears it. */
  webhookUrl?: string | null;
  resultsChannelId: string | null;
  lobbyVoiceChannelId: string | null;
  blueVoiceChannelId: string | null;
  redVoiceChannelId: string | null;
}

/**
 * Writes the row for `input.guildId` and nothing else.
 *
 * Keyed by the primary key, never by "the first row": an earlier version rewrote whichever row
 * happened to be oldest, so a leftover config from another guild would have been silently
 * renamed into this one. If saving under a new guild id leaves two rows, the page says so and
 * an admin deletes the stale one deliberately.
 */
export async function saveDiscordConfig(
  client: ServiceClient,
  input: SaveDiscordConfigInput,
): Promise<AdminWriteResult<AdminDiscordConfig>> {
  const row = {
    guild_id: input.guildId,
    results_channel_id: input.resultsChannelId,
    lobby_voice_channel_id: input.lobbyVoiceChannelId,
    blue_voice_channel_id: input.blueVoiceChannelId,
    red_voice_channel_id: input.redVoiceChannelId,
    ...(input.webhookUrl === undefined ? {} : { webhook_url: input.webhookUrl }),
  };

  const { error } = await client.from('discord_config').upsert(row, { onConflict: 'guild_id' });
  if (error) throw new Error(`saveDiscordConfig failed: ${error.message}`);

  const saved = await getDiscordConfig(client, input.guildId);
  if (saved === null) throw new Error('saveDiscordConfig: row vanished after write');
  return writeOk(saved);
}

/**
 * `https://discord.com/api/webhooks/12345/…kQ9f`. Enough for an admin to tell whether the
 * right webhook is stored, not enough for anyone reading over a shoulder to post with it.
 */
export function maskSecret(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length <= 12) return '…'.padStart(trimmed.length, '•');

  const slash = trimmed.lastIndexOf('/');
  const head = slash > 0 ? trimmed.slice(0, Math.min(slash + 1, 44)) : trimmed.slice(0, 12);
  return `${head}…${trimmed.slice(-4)}`;
}
