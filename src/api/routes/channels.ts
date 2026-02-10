import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import { verifyChannelAdmin, getChannelIds } from '../middleware/verify-admin.js';
import {
  addChannel,
  listChannels,
  getChannelById,
  verifyBotAdmin,
  setChannelPrices,
  getFullChannelStats,
  type ChannelFilters,
  type SetPriceInput,
} from '../../services/channels.js';
import { getChatAdministrators } from '../../services/telegram.js';
import { prisma } from '../../lib/prisma.js';

export async function channelRoutes(app: FastifyInstance) {
  // List channels with filters
  app.get('/api/channels', { preHandler: [requireAuth] }, async (request, reply) => {
    const query = request.query as ChannelFilters;
    return listChannels(query);
  });

  // Get channel by ID
  app.get('/api/channels/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return getChannelById(parseInt(id, 10));
  });

  // Add channel
  app.post('/api/channels', { preHandler: [requireAuth] }, async (request, reply) => {
    const body = request.body as { username: string; language?: string };
    try {
      const channel = await addChannel({
        username: body.username.replace('@', ''),
        language: body.language,
        ownerId: request.userId,
      });
      return reply.status(201).send(channel);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to add channel';
      return reply.status(400).send({ error: message });
    }
  });

  // Update channel
  app.put('/api/channels/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { language?: string; isActive?: boolean };
    const channelId = parseInt(id, 10);
    const channel = await prisma.channel.findUniqueOrThrow({ where: { id: channelId } });

    if (channel.ownerId !== request.userId) {
      return reply.status(403).send({ error: 'Not authorized' });
    }

    const updated = await prisma.channel.update({
      where: { id: channelId },
      data: { language: body.language, isActive: body.isActive },
      include: { prices: true },
    });
    return getChannelById(channelId);
  });

  // Delete channel
  app.delete('/api/channels/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const channelId = parseInt(id, 10);
    const channel = await prisma.channel.findUniqueOrThrow({ where: { id: channelId } });

    if (channel.ownerId !== request.userId) {
      return reply.status(403).send({ error: 'Not authorized' });
    }

    await prisma.channel.update({
      where: { id: channelId },
      data: { isActive: false },
    });

    return { success: true };
  });

  // Set prices for channel
  app.put('/api/channels/:id/prices', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { prices: SetPriceInput[] };
    const channelId = parseInt(id, 10);
    const channel = await prisma.channel.findUniqueOrThrow({ where: { id: channelId } });

    if (channel.ownerId !== request.userId) {
      return reply.status(403).send({ error: 'Not authorized' });
    }

    return setChannelPrices(channelId, body.prices);
  });

  // Verify bot is admin
  app.post('/api/channels/:id/verify', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const channelId = parseInt(id, 10);
    const channel = await prisma.channel.findUniqueOrThrow({ where: { id: channelId } });

    if (channel.ownerId !== request.userId) {
      return reply.status(403).send({ error: 'Not authorized' });
    }

    return verifyBotAdmin(channelId);
  });

  // Get channel stats history
  app.get('/api/channels/:id/stats', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const channelId = parseInt(id, 10);
    return prisma.channelStats.findMany({
      where: { channelId },
      orderBy: { fetchedAt: 'desc' },
      take: 30,
    });
  });

  // Get full stats (MTProto)
  app.get('/api/channels/:id/stats/full', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const channelId = parseInt(id, 10);
    return getFullChannelStats(channelId);
  });

  // Get channel admins from Telegram
  app.get('/api/channels/:id/admins', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const channelId = parseInt(id, 10);
    const channel = await prisma.channel.findUniqueOrThrow({ where: { id: channelId } });

    if (channel.ownerId !== request.userId) {
      return reply.status(403).send({ error: 'Not authorized' });
    }

    if (!channel.username) {
      return reply.status(400).send({ error: 'Channel has no username' });
    }

    return getChatAdministrators(`@${channel.username}`);
  });

  // Add channel manager
  app.post('/api/channels/:id/managers', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { userId: number };
    const channelId = parseInt(id, 10);
    const channel = await prisma.channel.findUniqueOrThrow({ where: { id: channelId } });

    if (channel.ownerId !== request.userId) {
      return reply.status(403).send({ error: 'Only the owner can add managers' });
    }

    return prisma.channelManager.create({
      data: {
        channelId,
        userId: body.userId,
        role: 'manager',
      },
      include: {
        user: {
          select: { id: true, username: true, firstName: true },
        },
      },
    });
  });

  // Remove channel manager
  app.delete('/api/channels/:id/managers/:userId', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id, userId: userIdParam } = request.params as { id: string; userId: string };
    const channelId = parseInt(id, 10);
    const targetUserId = parseInt(userIdParam, 10);
    const channel = await prisma.channel.findUniqueOrThrow({ where: { id: channelId } });

    if (channel.ownerId !== request.userId) {
      return reply.status(403).send({ error: 'Only the owner can remove managers' });
    }

    await prisma.channelManager.delete({
      where: {
        channelId_userId: { channelId, userId: targetUserId },
      },
    });

    return { success: true };
  });
}
