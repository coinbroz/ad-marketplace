import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { Api } from 'telegram/tl/index.js';
import { config } from '../config.js';
import { redis } from '../lib/redis.js';

let client: TelegramClient | null = null;

/**
 * Get or create the GramJS MTProto client.
 * Returns null if MTProto is not configured.
 */
export async function getMTProtoClient(): Promise<TelegramClient | null> {
  if (!config.TELEGRAM_API_ID || !config.TELEGRAM_API_HASH || !config.TELEGRAM_SESSION) {
    return null;
  }

  if (client && client.connected) {
    return client;
  }

  const apiId = parseInt(config.TELEGRAM_API_ID, 10);
  const session = new StringSession(config.TELEGRAM_SESSION);

  client = new TelegramClient(session, apiId, config.TELEGRAM_API_HASH, {
    connectionRetries: 3,
  });

  await client.connect();
  return client;
}

export interface ChannelBroadcastStats {
  viewsPerPost: number;
  sharesPerPost: number;
  reactionsPerPost: number;
  subscriberCount: number;
  rawData: Record<string, unknown>;
}

/**
 * Fetch channel broadcast stats via MTProto stats.getBroadcastStats.
 * Results are cached in Redis for 1 hour.
 */
export async function getChannelStats(channelTelegramId: bigint): Promise<ChannelBroadcastStats | null> {
  // Check Redis cache
  const cacheKey = `channel_stats:${channelTelegramId}`;
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  const mtClient = await getMTProtoClient();
  if (!mtClient) {
    return null; // MTProto not configured, fallback to Bot API
  }

  try {
    const channelEntity = await mtClient.getEntity(Number(channelTelegramId));

    if (!(channelEntity instanceof Api.Channel)) {
      return null;
    }

    const inputChannel = new Api.InputChannel({
      channelId: channelEntity.id,
      accessHash: channelEntity.accessHash!,
    });

    const stats = await mtClient.invoke(
      new Api.stats.GetBroadcastStats({
        channel: inputChannel,
      }),
    );

    const result: ChannelBroadcastStats = {
      viewsPerPost: extractStatsValue(stats.viewsPerPost),
      sharesPerPost: extractStatsValue(stats.sharesPerPost),
      reactionsPerPost: extractStatsValue(stats.reactionsPerPost),
      subscriberCount: extractStatsValue(stats.followers),
      rawData: JSON.parse(JSON.stringify(stats)),
    };

    // Cache for 1 hour
    await redis.setex(cacheKey, 3600, JSON.stringify(result));

    return result;
  } catch (err) {
    console.error(`Failed to get MTProto stats for channel ${channelTelegramId}:`, err);
    return null;
  }
}

/**
 * Extract the current value from a Telegram StatsAbsValueAndPrev or StatsPercentValue object.
 */
function extractStatsValue(stat: unknown): number {
  if (stat && typeof stat === 'object' && 'current' in stat) {
    return (stat as { current: number }).current || 0;
  }
  if (typeof stat === 'number') {
    return stat;
  }
  return 0;
}

/**
 * Disconnect MTProto client (for graceful shutdown).
 */
export async function disconnectMTProto(): Promise<void> {
  if (client) {
    await client.disconnect();
    client = null;
  }
}
