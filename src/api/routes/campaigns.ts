import type { FastifyInstance } from 'fastify';
import { config } from '../../config.js';
import { requireAuth } from '../middleware/auth.js';
import {
  createCampaign,
  listCampaigns,
  getCampaignById,
  updateCampaign,
  cancelCampaign,
  type CampaignFilters,
  type CreateCampaignInput,
} from '../../services/campaigns.js';
import { prisma } from '../../lib/prisma.js';
import { notifyUser, formatNotification } from '../../services/telegram.js';

export async function campaignRoutes(app: FastifyInstance) {
  // List campaigns with filters
  app.get('/api/campaigns', { preHandler: [requireAuth] }, async (request, reply) => {
    const query = request.query as CampaignFilters;
    return listCampaigns(query);
  });

  // Get campaign by ID
  app.get('/api/campaigns/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return getCampaignById(parseInt(id, 10));
  });

  // Create campaign
  app.post('/api/campaigns', { preHandler: [requireAuth] }, async (request, reply) => {
    const body = request.body as Omit<CreateCampaignInput, 'advertiserId'>;
    const campaign = await createCampaign({
      ...body,
      advertiserId: request.userId,
    });
    return reply.status(201).send(campaign);
  });

  // Update campaign
  app.put('/api/campaigns/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Partial<Pick<CreateCampaignInput, 'title' | 'description' | 'budgetPerPost' | 'targetLanguage' | 'minSubscribers' | 'minAvgViews'>>;
    return updateCampaign(
      parseInt(id, 10),
      request.userId,
      body,
    );
  });

  // Cancel campaign
  app.delete('/api/campaigns/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return cancelCampaign(parseInt(id, 10), request.userId);
  });

  // Apply to campaign (channel owner applies with their channel)
  // This creates a Deal initiated by the channel owner
  app.post('/api/campaigns/:id/apply', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { channelId, message } = request.body as { channelId: number; message?: string };
    const campaignId = parseInt(id, 10);

    // Verify campaign exists and is active
    const campaign = await prisma.campaign.findUniqueOrThrow({
      where: { id: campaignId },
      include: {
        advertiser: { select: { id: true, telegramId: true, firstName: true } },
      },
    });

    if (campaign.status !== 'ACTIVE') {
      return reply.status(400).send({ error: 'Campaign is not active' });
    }

    // Verify channel belongs to this user
    const channel = await prisma.channel.findUniqueOrThrow({
      where: { id: channelId },
      include: { prices: true, owner: { select: { telegramId: true, firstName: true } } },
    });

    // Check ownership or manager role
    const isOwnerOrManager = channel.ownerId === request.userId ||
      await prisma.channelManager.findUnique({
        where: { channelId_userId: { channelId, userId: request.userId } },
      });

    if (!isOwnerOrManager) {
      return reply.status(403).send({ error: 'You are not authorized to manage this channel' });
    }

    if (!channel.botIsAdmin) {
      return reply.status(400).send({ error: 'Bot must be an admin of the channel' });
    }

    // Check campaign requirements
    if (campaign.minSubscribers && channel.subscriberCount < campaign.minSubscribers) {
      return reply.status(400).send({
        error: `Channel needs at least ${campaign.minSubscribers.toLocaleString()} subscribers (yours: ${channel.subscriberCount.toLocaleString()})`,
      });
    }
    if (campaign.minAvgViews && channel.avgViewCount < campaign.minAvgViews) {
      return reply.status(400).send({
        error: `Channel needs at least ${campaign.minAvgViews.toLocaleString()} avg views (yours: ${channel.avgViewCount.toLocaleString()})`,
      });
    }
    if (campaign.targetLanguage && channel.language) {
      const la = channel.language.toLowerCase(), lb = campaign.targetLanguage.toLowerCase();
      const match = la === lb || la.includes(lb) || lb.includes(la) ||
        (la.length >= 3 && lb.length >= 3 && la.slice(0, 3) === lb.slice(0, 3));
      if (!match) {
        return reply.status(400).send({
          error: `Campaign requires ${campaign.targetLanguage} channels (yours: ${channel.language})`,
        });
      }
    }

    // Check for existing deal for this channel + campaign
    const existingDeal = await prisma.deal.findFirst({
      where: {
        channelId,
        campaignId,
        status: { notIn: ['CANCELLED', 'EXPIRED', 'REFUNDED', 'COMPLETED'] },
      },
    });

    if (existingDeal) {
      return reply.status(400).send({ error: 'A deal already exists for this channel and campaign' });
    }

    // Determine price (use campaign budget or channel's post price)
    const postPrice = channel.prices.find((p) => p.format === 'post');
    const priceInTon = postPrice?.priceInTon || campaign.budgetPerPost;

    // Create deal
    const deal = await prisma.deal.create({
      data: {
        channelId,
        campaignId,
        advertiserId: campaign.advertiserId,
        channelOwnerId: channel.ownerId,
        initiatedBy: 'channel_owner',
        format: 'post',
        priceInTon,
        // brief is NOT set here — it's submitted separately via /submitbrief after payment
        status: 'PENDING',
      },
    });

    // Log deal event
    await prisma.dealEvent.create({
      data: {
        dealId: deal.id,
        type: 'status_change',
        data: {
          from: null,
          to: 'PENDING',
          initiatedBy: 'channel_owner',
        },
      },
    });

    // Notify advertiser
    await notifyUser(
      campaign.advertiser.telegramId,
      formatNotification({
        emoji: '📩', title: 'New campaign application',
        dealId: deal.id, channel: `${channel.title} (@${channel.username})`,
        price: priceInTon,
        lines: [
          `Subscribers: ${channel.subscriberCount.toLocaleString()}`,
          `Campaign: ${campaign.title}`,
          ...(message ? [`Message: ${message}`] : []),
        ],
        hint: 'Open the deal to accept or reject.',
      }),
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📋 Open Deal', web_app: { url: `${config.WEBAPP_URL}/deals/${deal.id}` } }],
          ],
        },
      },
    );

    // Notify channel owner (confirmation that application was sent)
    await notifyUser(
      channel.owner.telegramId,
      formatNotification({
        emoji: '📤', title: 'Application sent',
        dealId: deal.id, channel: channel.title,
        price: priceInTon,
        lines: [
          `Campaign: ${campaign.title}`,
          `Advertiser: ${campaign.advertiser.firstName}`,
        ],
        hint: 'Waiting for the advertiser to accept.',
      }),
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📋 Open Deal', web_app: { url: `${config.WEBAPP_URL}/deals/${deal.id}` } }],
          ],
        },
      },
    );

    return reply.status(201).send(deal);
  });
}
