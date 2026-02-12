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
import { getEscrowInfo, refundFunds, executePendingRefund } from '../../services/ton.js';
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

    // Notify ADVERTISER with escrow address (they always pay)
    await notifyUser(
      deal.advertiser.telegramId,
      `✅ <b>Deal accepted!</b>\n\nDeal #${dealId}\n` +
      `Channel: ${deal.channel.title}\n` +
      `Price: ${deal.priceInTon} TON\n\n` +
      `Escrow address: <code>${updatedDeal.escrowAddress}</code>\n\n` +
      `Please send ${deal.priceInTon} TON to this address to proceed.`,
    );

    // Notify CHANNEL OWNER that deal was accepted
    if (deal.advertiser.telegramId !== deal.channelOwner.telegramId) {
      await notifyUser(
        deal.channelOwner.telegramId,
        `✅ <b>Deal accepted!</b>\n\nDeal #${dealId}\n` +
        `Channel: ${deal.channel.title}\n` +
        `Price: ${deal.priceInTon} TON\n\n` +
        `Waiting for advertiser to fund the escrow.`,
      );
    }

    return updatedDeal;
  });

  // Reject deal (from PENDING)
  app.put('/api/deals/:id/reject', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const dealId = parseInt(id, 10);
    const deal = await cancelDeal(dealId, request.userId);

    // Notify the other party
    const otherTelegramId = request.userId === deal.advertiserId
      ? deal.channelOwner.telegramId
      : deal.advertiser.telegramId;
    const cancellerName = request.userId === deal.advertiserId
      ? deal.advertiser.firstName
      : deal.channelOwner.firstName;

    await notifyUser(
      otherTelegramId,
      `❌ <b>Deal rejected</b>\n\n` +
      `Deal #${dealId}\n` +
      `Channel: ${deal.channel.title}\n` +
      `By: ${cancellerName}\n\n` +
      `The deal proposal was rejected.`,
    );

    return deal;
  });

  // Cancel deal (from any active status)
  app.put('/api/deals/:id/cancel', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const dealId = parseInt(id, 10);

    // Check if deal is in a funded state — trigger refund automatically
    const FUNDED_STATUSES = ['FUNDED', 'CREATIVE_DRAFT', 'CREATIVE_REVIEW', 'CREATIVE_APPROVED', 'SCHEDULED'];
    const currentDeal = await prisma.deal.findUniqueOrThrow({
      where: { id: dealId },
      include: {
        advertiser: { select: { telegramId: true, firstName: true } },
        channelOwner: { select: { telegramId: true, firstName: true } },
        channel: { select: { title: true } },
      },
    });

    // Auth check
    if (request.userId !== currentDeal.advertiserId && request.userId !== currentDeal.channelOwnerId) {
      return reply.status(403).send({ error: 'Not authorized to cancel this deal' });
    }

    let deal;
    if (FUNDED_STATUSES.includes(currentDeal.status)) {
      // Funded deal — refund first, then status becomes REFUNDED
      try {
        await refundFunds(dealId);
      } catch (err) {
        console.error(`Refund failed for cancelled deal ${dealId}:`, err);
        // Fall back to simple cancel if refund fails
      }
      deal = await prisma.deal.findUniqueOrThrow({
        where: { id: dealId },
        include: { channel: true, advertiser: true, channelOwner: true },
      });
      // If refund didn't transition (e.g. no balance), cancel manually
      if (FUNDED_STATUSES.includes(deal.status)) {
        deal = await cancelDeal(dealId, request.userId);
      }
    } else {
      deal = await cancelDeal(dealId, request.userId);
    }

    // Notify the other party
    const otherTelegramId = request.userId === deal.advertiserId
      ? deal.channelOwner.telegramId
      : deal.advertiser.telegramId;
    const cancellerName = request.userId === deal.advertiserId
      ? deal.advertiser.firstName
      : deal.channelOwner.firstName;

    const isRefunded = deal.status === 'REFUNDED';

    // Notify the other party
    await notifyUser(
      otherTelegramId,
      `🚫 <b>Deal cancelled</b>\n\n` +
      `Deal #${dealId}\n` +
      `Channel: ${deal.channel.title}\n` +
      `Price: ${deal.priceInTon} TON\n` +
      `Cancelled by: ${cancellerName}\n\n` +
      `The deal has been cancelled.`,
    );

    // Notify advertiser about refund address if payment was involved
    if (isRefunded) {
      const advertiserTgId = deal.advertiser.telegramId;
      await notifyUser(
        advertiserTgId,
        `🔄 <b>Refund pending</b>\n\n` +
        `Deal #${dealId}\n` +
        `Amount: ${deal.priceInTon} TON\n\n` +
        `Please open the Mini App → My Deals → Deal #${dealId} and enter your TON wallet address for the refund.`,
      );
    }

    return deal;
  });

  // Set refund address (advertiser provides wallet for refund after cancellation)
  app.put('/api/deals/:id/refund-address', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const dealId = parseInt(id, 10);
    const body = request.body as { address: string; memo?: string };

    if (!body.address?.trim()) {
      return reply.status(400).send({ error: 'Wallet address is required' });
    }

    const deal = await prisma.deal.findUniqueOrThrow({
      where: { id: dealId },
      include: { channel: { select: { title: true } } },
    });

    // Only advertiser can set refund address
    if (request.userId !== deal.advertiserId) {
      return reply.status(403).send({ error: 'Only the advertiser can set the refund address' });
    }

    // Only for refunded/cancelled deals that had payment
    if (!['REFUNDED', 'CANCELLED'].includes(deal.status)) {
      return reply.status(400).send({ error: 'Refund address can only be set for cancelled/refunded deals' });
    }

    const updated = await prisma.deal.update({
      where: { id: dealId },
      data: {
        refundAddress: body.address.trim(),
        refundMemo: body.memo?.trim() || null,
      },
      include: {
        channel: true,
        advertiser: true,
        channelOwner: true,
      },
    });

    // Log event
    await prisma.dealEvent.create({
      data: {
        dealId,
        type: 'refund_address',
        data: {
          address: body.address.trim(),
          memo: body.memo?.trim() || null,
        },
      },
    });

    // If deal is CANCELLED with escrow, check balance before attempting refund
    if (deal.status === 'CANCELLED' && deal.escrowAddress) {
      const { getWalletBalance } = await import('../../utils/ton-wallet.js');
      let balance = BigInt(0);
      try { balance = await getWalletBalance(deal.escrowAddress); } catch { /* no balance */ }
      if (balance <= BigInt(0)) {
        return updated; // No funds to refund
      }
      try {
        await refundFunds(dealId);
      } catch (err) {
        console.error(`Late refund failed for deal ${dealId}:`, err);
      }
      // Re-fetch after refund
      return prisma.deal.findUniqueOrThrow({
        where: { id: dealId },
        include: { channel: true, advertiser: true, channelOwner: true },
      });
    }

    // If deal is REFUNDED but TON wasn't actually sent (placeholder hash), retry now
    if (deal.status === 'REFUNDED' && deal.escrowAddress) {
      try {
        const txHash = await executePendingRefund(dealId);
        console.log(`Pending refund result for deal ${dealId}:`, txHash);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`Pending refund execution failed for deal ${dealId}:`, err);
        return reply.status(500).send({ error: `Refund transfer failed: ${errMsg}` });
      }
      return prisma.deal.findUniqueOrThrow({
        where: { id: dealId },
        include: { channel: true, advertiser: true, channelOwner: true },
      });
    }

    return updated;
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

    // Notify channel owner with clear next step
    await notifyUser(
      deal.channelOwner.telegramId,
      `✅ <b>Creative approved!</b>\n\n` +
      `Deal #${dealId}\n` +
      `Channel: ${deal.channel.title}\n\n` +
      `Send /schedulepost to the bot to publish the post in the channel.`,
    );

    return deal;
  });

  // Request edits
  app.put('/api/deals/:id/request-edit', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { comment: string };
    const dealId = parseInt(id, 10);
    const deal = await requestCreativeEdit(dealId, request.userId, body.comment);

    // Notify channel owner with clear next step
    await notifyUser(
      deal.channelOwner.telegramId,
      `✏️ <b>Edit requested</b>\n\n` +
      `Deal #${dealId}\n` +
      `Channel: ${deal.channel.title}\n\n` +
      `<b>Advertiser's comment:</b>\n${body.comment}\n\n` +
      `Please update the creative based on this feedback.\n` +
      `Send /submitcreative to the bot to resubmit.`,
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
