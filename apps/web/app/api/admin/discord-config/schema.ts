import { z } from 'zod';
import { booleanFieldSchema, nullableTextSchema, requiredTextSchema } from '@/lib/admin/formValues';

/**
 * `POST /api/admin/discord-config`: the single `discord_config` row.
 *
 * `webhookUrl` is three-valued on purpose. The page shows the stored URL masked, and a masked
 * value cannot be posted back, so an empty field must mean "leave it alone" — clearing needs
 * its own checkbox.
 */
export const discordConfigRequestSchema = z
  .object({
    guildId: requiredTextSchema,
    /** Empty keeps the stored one. */
    webhookUrl: nullableTextSchema,
    /** Explicit "forget the webhook". Wins over `webhookUrl`. */
    clearWebhook: booleanFieldSchema.optional(),
    resultsChannelId: nullableTextSchema,
    lobbyVoiceChannelId: nullableTextSchema,
    blueVoiceChannelId: nullableTextSchema,
    redVoiceChannelId: nullableTextSchema,
  })
  .refine(
    (value) =>
      value.webhookUrl === null ||
      /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(value.webhookUrl),
    { path: ['webhookUrl'], message: 'must be a https://discord.com/api/webhooks/... URL' },
  );

export type DiscordConfigRequest = z.infer<typeof discordConfigRequestSchema>;

export const discordConfigResponseSchema = z.object({
  ok: z.literal(true),
  guildId: z.string().min(1),
  /** The URL itself is never sent back, only whether one is stored and its masked tail. */
  webhookSet: z.boolean(),
  webhookMasked: z.string().nullable(),
  resultsChannelId: z.string().nullable(),
  lobbyVoiceChannelId: z.string().nullable(),
  blueVoiceChannelId: z.string().nullable(),
  redVoiceChannelId: z.string().nullable(),
});

export type DiscordConfigResponse = z.infer<typeof discordConfigResponseSchema>;
