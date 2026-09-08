import type { NextResponse } from 'next/server';
import { maskSecret, saveDiscordConfig } from '@/lib/admin/discordConfig';
import type { AdminContext } from '@/lib/adminRoute';
import { type DiscordConfigRequest, discordConfigResponseSchema } from './schema';

/** See `app/api/admin/players/handler.ts` for why the handler is not inside `route.ts`. */
export async function handleDiscordConfig(
  input: DiscordConfigRequest,
  context: AdminContext,
): Promise<NextResponse> {
  // undefined = keep what is stored, null = clear, string = overwrite.
  const webhookUrl = input.clearWebhook === true ? null : (input.webhookUrl ?? undefined);

  const result = await saveDiscordConfig(context.client, {
    guildId: input.guildId,
    ...(webhookUrl === undefined ? {} : { webhookUrl }),
    resultsChannelId: input.resultsChannelId,
    lobbyVoiceChannelId: input.lobbyVoiceChannelId,
    blueVoiceChannelId: input.blueVoiceChannelId,
    redVoiceChannelId: input.redVoiceChannelId,
  });
  if (!result.ok) return context.fail(result.status, result.error);

  const config = result.value;
  return context.respond(
    discordConfigResponseSchema,
    {
      ok: true,
      guildId: config.guildId,
      webhookSet: config.webhookUrl !== null,
      webhookMasked: maskSecret(config.webhookUrl),
      resultsChannelId: config.resultsChannelId,
      lobbyVoiceChannelId: config.lobbyVoiceChannelId,
      blueVoiceChannelId: config.blueVoiceChannelId,
      redVoiceChannelId: config.redVoiceChannelId,
    },
    'Discord config saved',
  );
}
