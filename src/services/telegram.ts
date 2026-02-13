import { bot } from '../bot/index.js';
import { redis } from '../lib/redis.js';

export interface ChatInfo {
  id: bigint;
  title: string;
  username?: string;
  description?: string;
  memberCount: number;
}

/**
 * Get basic channel info via Bot API.
 */
export async function getChatInfo(chatId: string | number): Promise<ChatInfo> {
  const chat = await bot.api.getChat(chatId);

  if (chat.type !== 'channel') {
    throw new Error('Chat is not a channel');
  }

  const memberCount = await bot.api.getChatMemberCount(chatId);

  return {
    id: BigInt(chat.id),
    title: chat.title,
    username: chat.username,
    description: chat.description,
    memberCount,
  };
}

/**
 * Check if the bot is an admin of the channel.
 */
export async function isBotAdmin(chatId: string | number): Promise<boolean> {
  try {
    const me = await bot.api.getMe();
    const member = await bot.api.getChatMember(chatId, me.id);
    return member.status === 'administrator' || member.status === 'creator';
  } catch {
    return false;
  }
}

/**
 * Check if a user is an admin of the channel.
 * Uses Redis cache with 5 minute TTL to avoid spamming Telegram API.
 */
export async function isUserAdmin(
  chatId: string | number,
  userId: number,
): Promise<boolean> {
  const cacheKey = `admin_check:${chatId}:${userId}`;
  const cached = await redis.get(cacheKey);

  if (cached !== null) {
    return cached === '1';
  }

  try {
    const member = await bot.api.getChatMember(chatId, userId);
    const isAdmin = member.status === 'administrator' || member.status === 'creator';

    // Cache for 5 minutes
    await redis.setex(cacheKey, 300, isAdmin ? '1' : '0');

    return isAdmin;
  } catch {
    return false;
  }
}

/**
 * Get list of channel administrators.
 */
export async function getChatAdministrators(chatId: string | number) {
  const admins = await bot.api.getChatAdministrators(chatId);
  return admins.map((admin) => ({
    userId: admin.user.id,
    username: admin.user.username,
    firstName: admin.user.first_name,
    lastName: admin.user.last_name,
    isBot: admin.user.is_bot,
    status: admin.status,
  }));
}

/**
 * Format a consistent deal notification message.
 */
export function formatNotification(params: {
  emoji: string;
  title: string;
  dealId: number;
  channel?: string;
  channelLink?: string;
  price?: number | string;
  lines?: string[];
  hint?: string;
}): string {
  const ch = params.channelLink || params.channel || '';
  const parts: string[] = [
    `${params.emoji}  <b>${params.title}</b>`,
    '',
    `<b>Deal #${params.dealId}</b>${ch ? ` · ${ch}` : ''}`,
  ];
  if (params.price !== undefined) {
    parts.push(`💎 ${params.price} TON`);
  }
  if (params.lines?.length) {
    parts.push('');
    parts.push(...params.lines);
  }
  if (params.hint) {
    parts.push('');
    parts.push(params.hint);
  }
  return parts.join('\n');
}

/**
 * Send a notification message to a user via the bot.
 */
export async function notifyUser(telegramId: bigint, text: string, extra?: object) {
  try {
    await bot.api.sendMessage(Number(telegramId), text, {
      parse_mode: 'HTML',
      ...extra,
    });
  } catch (err) {
    console.error(`Failed to notify user ${telegramId}:`, err);
  }
}
