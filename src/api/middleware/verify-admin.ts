import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { isUserAdmin } from '../../services/telegram.js';

/**
 * Middleware factory: verifies that the current user is still an admin
 * of the channel associated with the deal/channel.
 *
 * Spec requirement: "Must re-check if user still an admin on financial
 * and other important operations"
 *
 * Uses Redis cache (5 min TTL) via isUserAdmin to avoid spamming Telegram API.
 */
export function verifyChannelAdmin(getChannelId: (request: FastifyRequest) => Promise<{ channelTelegramId: bigint; userTelegramId: bigint } | null>) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    const ids = await getChannelId(request);
    if (!ids) {
      return reply.status(404).send({ error: 'Channel not found' });
    }

    const isAdmin = await isUserAdmin(
      Number(ids.channelTelegramId),
      Number(ids.userTelegramId),
    );

    if (!isAdmin) {
      return reply.status(403).send({
        error: 'You are no longer an admin of this channel. Please re-verify your admin status.',
      });
    }
  };
}

/**
 * Helper: get channel Telegram ID and user Telegram ID from a deal.
 */
export async function getDealChannelIds(request: FastifyRequest): Promise<{ channelTelegramId: bigint; userTelegramId: bigint } | null> {
  const dealId = (request.params as { id: string }).id;

  const deal = await prisma.deal.findUnique({
    where: { id: parseInt(dealId, 10) },
    include: {
      channel: { select: { telegramId: true } },
      channelOwner: { select: { telegramId: true } },
    },
  });

  if (!deal) return null;

  // Only check admin status for channel owner, not advertiser
  const user = await prisma.user.findUnique({
    where: { id: request.userId },
  });

  if (!user || user.id !== deal.channelOwnerId) {
    // Not the channel owner, skip admin check
    return null;
  }

  return {
    channelTelegramId: deal.channel.telegramId,
    userTelegramId: user.telegramId,
  };
}

/**
 * Helper: get channel Telegram ID from channel ID param.
 */
export async function getChannelIds(request: FastifyRequest): Promise<{ channelTelegramId: bigint; userTelegramId: bigint } | null> {
  const channelId = (request.params as { id: string }).id;

  const channel = await prisma.channel.findUnique({
    where: { id: parseInt(channelId, 10) },
  });

  if (!channel) return null;

  const user = await prisma.user.findUnique({
    where: { id: request.userId },
  });

  if (!user) return null;

  return {
    channelTelegramId: channel.telegramId,
    userTelegramId: user.telegramId,
  };
}
