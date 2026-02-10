import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import { verifyChannelAdmin, getDealChannelIds } from '../middleware/verify-admin.js';
import {
  createDeal,
  acceptDeal,
  cancelDeal,
  submitCreative,
  approveCreative,
  requestCreativeEdit,
  scheduleDeal,
  getUserDeals,
  getDealById,
  getDealEvents,
  moveToPayment,
} from '../../services/deals.js';
import { getEscrowInfo } from '../../services/ton.js';
import { prisma } from '../../lib/prisma.js';
import { notifyUser } from '../../services/telegram.js';

export async function dealRoutes(app: FastifyInstance) {
  // List my deals
  app.get('/api/deals', { preHandler: [requireAuth] }, async (request, reply) => {
    const query = request.query as { status?: string };
    const statusFilter = query.status
      ? query.status.split(',') as any[]
      : undefined;
    return getUserDeals(request.userId, statusFilter);
  });

  // Get deal by ID
  app.get('/api/deals/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const dealId = parseInt(id, 10);
    const deal = await getDealById(dealId);

    // Only participants can view
    if (deal.advertiserId !== request.userId && deal.channelOwnerId !== request.userId) {
      return reply.status(403).send({ error: 'Not authorized to view this deal' });
    }

    return deal;
  });

  // Create deal (advertiser proposes to a channel)
  app.post('/api/deals', { preHandler: [requireAuth] }, async (request, reply) => {
    const { channelId, format, brief } = request.body as {
      channelId: number;
      format?: string;
      brief?: string;
    };

    const channel = await prisma.channel.findUniqueOrThrow({
      where: { id: channelId },
      include: {
        prices: true,
        owner: { select: { id: true, telegramId: true, firstName: true } },
      },
    });

    if (!channel.botIsAdmin) {
      return reply.status(400).send({ error: 'Bot must be an admin of the channel' });
    }

    // Get price for the format
    const selectedFormat = format || 'post';
    const price = channel.prices.find((p) => p.format === selectedFormat);
    if (!price) {
      return reply.status(400).send({ error: `No price set for format: ${selectedFormat}` });
    }

    // Check no existing active deal
    const existing = await prisma.deal.findFirst({
      where: {
        channelId,
        advertiserId: request.userId,
        status: { notIn: ['CANCELLED', 'EXPIRED', 'REFUNDED', 'COMPLETED'] },
      },
    });

    if (existing) {
      return reply.status(400).send({ error: 'You already have an active deal with this channel' });
    }

    const deal = await createDeal({
      channelId,
      advertiserId: request.userId,
      channelOwnerId: channel.ownerId,
      initiatedBy: 'advertiser',
      format: selectedFormat,
      priceInTon: price.priceInTon,
      brief,
    });

    // Notify channel owner
    const user = await prisma.user.findUniqueOrThrow({ where: { id: request.userId } });
    await notifyUser(
      channel.owner.telegramId,
      `📩 <b>New deal proposal!</b>\n\n` +
      `From: ${user.firstName}${user.username ? ` (@${user.username})` : ''}\n` +
      `Channel: ${channel.title}\n` +
      `Format: ${selectedFormat}\n` +
      `Price: ${price.priceInTon} TON\n` +
      (brief ? `\nBrief: ${brief}\n` : '') +
      `\nDeal #${deal.id}`,
    );

    return reply.status(201).send(deal);
  });

  // Accept deal (with admin re-check for channel owners)
  app.put('/api/deals/:id/accept', {
    preHandler: [
      requireAuth,
      verifyChannelAdmin(getDealChannelIds),
    ],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const dealId = parseInt(id, 10);
    const deal = await acceptDeal(dealId, request.userId);

    // Auto-transition to AWAITING_PAYMENT
    const updatedDeal = await moveToPayment(dealId);

    // Notify the other party
    const otherPartyTelegramId = deal.initiatedBy === 'advertiser'
      ? deal.advertiser.telegramId
      : deal.channelOwner.telegramId;

    await notifyUser(
      otherPartyTelegramId,
      `✅ <b>Deal accepted!</b>\n\nDeal #${dealId}\n` +
      `Channel: ${deal.channel.title}\n` +
      `Price: ${deal.priceInTon} TON\n\n` +
      `Escrow address: <code>${updatedDeal.escrowAddress}</code>\n\n` +
      `Please send ${deal.priceInTon} TON to this address to proceed.`,
    );

    return updatedDeal;
  });

  // Reject / cancel deal
  app.put('/api/deals/:id/reject', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const dealId = parseInt(id, 10);
    return cancelDeal(dealId, request.userId);
  });

  app.put('/api/deals/:id/cancel', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const dealId = parseInt(id, 10);
    return cancelDeal(dealId, request.userId);
  });

  // Submit creative (with admin re-check)
  app.put('/api/deals/:id/creative', {
    preHandler: [
      requireAuth,
      verifyChannelAdmin(getDealChannelIds),
    ],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { text: string; mediaType?: string; mediaFileId?: string };
    const dealId = parseInt(id, 10);
    const deal = await submitCreative(dealId, request.userId, body);

    // Notify advertiser
    await notifyUser(
      deal.advertiser.telegramId,
      `📝 <b>Creative submitted for review!</b>\n\n` +
      `Deal #${dealId}\n` +
      `Channel: ${deal.channel.title}\n\n` +
      `<b>Preview:</b>\n${body.text}\n\n` +
      `Please review and approve or request edits.`,
    );

    return deal;
  });

  // Approve creative
  app.put('/api/deals/:id/approve', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const dealId = parseInt(id, 10);
    const deal = await approveCreative(dealId, request.userId);

    // Notify channel owner
    await notifyUser(
      deal.channelOwner.telegramId,
      `✅ <b>Creative approved!</b>\n\n` +
      `Deal #${dealId}\n` +
      `Channel: ${deal.channel.title}\n\n` +
      `You can now schedule the post or publish immediately.`,
    );

    return deal;
  });

  // Request edits
  app.put('/api/deals/:id/request-edit', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { comment: string };
    const dealId = parseInt(id, 10);
    const deal = await requestCreativeEdit(dealId, request.userId, body.comment);

    // Notify channel owner
    await notifyUser(
      deal.channelOwner.telegramId,
      `✏️ <b>Edit requested</b>\n\n` +
      `Deal #${dealId}\n` +
      `Channel: ${deal.channel.title}\n\n` +
      `Comment: ${body.comment}\n\n` +
      `Please update the creative and resubmit.`,
    );

    return deal;
  });

  // Schedule post
  app.put('/api/deals/:id/schedule', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { scheduledAt: string };
    const dealId = parseInt(id, 10);
    const scheduledAt = new Date(body.scheduledAt);

    if (scheduledAt <= new Date()) {
      return { error: 'Scheduled time must be in the future' };
    }

    return scheduleDeal(dealId, scheduledAt);
  });

  // Get escrow info
  app.get('/api/deals/:id/escrow', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const dealId = parseInt(id, 10);
    return getEscrowInfo(dealId);
  });

  // Get deal events (timeline)
  app.get('/api/deals/:id/events', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const dealId = parseInt(id, 10);
    return getDealEvents(dealId);
  });
}
