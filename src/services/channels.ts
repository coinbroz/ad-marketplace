import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { getChatInfo, isBotAdmin, getChatAdministrators } from './telegram.js';
import { getChannelStats } from './mtproto.js';

export interface AddChannelInput {
  username: string;
  language?: string;
  ownerId: number;
}

export interface SetPriceInput {
  format: string;
  priceInTon: number;
  description?: string;
}

export interface ChannelFilters {
  minSubscribers?: number;
  maxSubscribers?: number;
  minPrice?: number;
  maxPrice?: number;
  minAvgViews?: number;
  maxAvgViews?: number;
  language?: string;
  format?: string;
  search?: string;
  sortBy?: 'subscribers' | 'price' | 'views' | 'created';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

/**
 * Add a channel to the marketplace.
 */
export async function addChannel(input: AddChannelInput) {
  // Fetch channel info from Telegram
  const chatInfo = await getChatInfo(`@${input.username}`);

  // Check if bot is admin
  const botAdmin = await isBotAdmin(`@${input.username}`);

  // Check if channel already exists
  const existing = await prisma.channel.findUnique({
    where: { telegramId: chatInfo.id },
  });

  if (existing) {
    throw new Error('Channel already registered');
  }

  // Create channel
  const channel = await prisma.channel.create({
    data: {
      telegramId: chatInfo.id,
      username: chatInfo.username,
      title: chatInfo.title,
      description: chatInfo.description,
      subscriberCount: chatInfo.memberCount,
      language: input.language || null,
      botIsAdmin: botAdmin,
      ownerId: input.ownerId,
    },
    include: { prices: true },
  });

  // Auto-create ChannelManager entry for the owner
  await prisma.channelManager.create({
    data: {
      channelId: channel.id,
      userId: input.ownerId,
      role: 'owner',
    },
  });

  return channel;
}

/**
 * Verify that the bot is an admin of the channel.
 */
export async function verifyBotAdmin(channelId: number) {
  const channel = await prisma.channel.findUniqueOrThrow({
    where: { id: channelId },
  });

  const username = channel.username;
  if (!username) {
    throw new Error('Channel has no username');
  }

  const isAdmin = await isBotAdmin(`@${username}`);

  await prisma.channel.update({
    where: { id: channelId },
    data: { botIsAdmin: isAdmin },
  });

  return { botIsAdmin: isAdmin };
}

/**
 * Set prices for ad formats on a channel.
 */
export async function setChannelPrices(channelId: number, prices: SetPriceInput[]) {
  const results = [];

  for (const price of prices) {
    const result = await prisma.channelPrice.upsert({
      where: {
        channelId_format: { channelId, format: price.format },
      },
      update: {
        priceInTon: price.priceInTon,
        description: price.description || null,
      },
      create: {
        channelId,
        format: price.format,
        priceInTon: price.priceInTon,
        description: price.description || null,
      },
    });
    results.push(result);
  }

  return results;
}

/**
 * List channels with filters and pagination.
 */
export async function listChannels(filters: ChannelFilters) {
  const page = filters.page || 1;
  const limit = Math.min(filters.limit || 20, 100);
  const skip = (page - 1) * limit;

  const where: Prisma.ChannelWhereInput = {
    isActive: true,
    botIsAdmin: true,
  };

  // Subscriber filters
  if (filters.minSubscribers) {
    where.subscriberCount = { ...where.subscriberCount as object, gte: filters.minSubscribers };
  }
  if (filters.maxSubscribers) {
    where.subscriberCount = { ...where.subscriberCount as object, lte: filters.maxSubscribers };
  }

  // View filters
  if (filters.minAvgViews) {
    where.avgViewCount = { ...where.avgViewCount as object, gte: filters.minAvgViews };
  }
  if (filters.maxAvgViews) {
    where.avgViewCount = { ...where.avgViewCount as object, lte: filters.maxAvgViews };
  }

  // Language filter
  if (filters.language) {
    where.language = filters.language;
  }

  // Search filter
  if (filters.search) {
    where.OR = [
      { title: { contains: filters.search, mode: 'insensitive' } },
      { description: { contains: filters.search, mode: 'insensitive' } },
      { username: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  // Price filter (requires join)
  if (filters.minPrice || filters.maxPrice || filters.format) {
    const priceWhere: Prisma.ChannelPriceWhereInput = {};
    if (filters.format) {
      priceWhere.format = filters.format;
    }
    if (filters.minPrice) {
      priceWhere.priceInTon = { ...priceWhere.priceInTon as object, gte: filters.minPrice };
    }
    if (filters.maxPrice) {
      priceWhere.priceInTon = { ...priceWhere.priceInTon as object, lte: filters.maxPrice };
    }
    where.prices = { some: priceWhere };
  }

  // Sort
  let orderBy: Prisma.ChannelOrderByWithRelationInput = { createdAt: 'desc' };
  const order = filters.sortOrder || 'desc';

  switch (filters.sortBy) {
    case 'subscribers':
      orderBy = { subscriberCount: order };
      break;
    case 'views':
      orderBy = { avgViewCount: order };
      break;
    case 'created':
      orderBy = { createdAt: order };
      break;
  }

  const [channels, total] = await Promise.all([
    prisma.channel.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      include: {
        prices: true,
        owner: {
          select: { id: true, username: true, firstName: true },
        },
      },
    }),
    prisma.channel.count({ where }),
  ]);

  return {
    channels: channels.map(serializeChannel),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * Get channel by ID with full details.
 */
export async function getChannelById(id: number) {
  const channel = await prisma.channel.findUniqueOrThrow({
    where: { id },
    include: {
      prices: true,
      owner: {
        select: { id: true, username: true, firstName: true },
      },
      managers: {
        include: {
          user: {
            select: { id: true, username: true, firstName: true, telegramId: true },
          },
        },
      },
    },
  });

  return serializeChannel(channel);
}

/**
 * Get full channel stats including MTProto data.
 */
export async function getFullChannelStats(channelId: number) {
  const channel = await prisma.channel.findUniqueOrThrow({
    where: { id: channelId },
  });

  // Bot API stats
  const basicStats = {
    subscriberCount: channel.subscriberCount,
    avgViewCount: channel.avgViewCount,
    language: channel.language,
  };

  // MTProto stats (if available)
  const mtStats = await getChannelStats(channel.telegramId);

  if (mtStats) {
    // Update channel with latest stats
    await prisma.channel.update({
      where: { id: channelId },
      data: {
        subscriberCount: mtStats.subscriberCount || channel.subscriberCount,
        avgViewCount: Math.round(mtStats.viewsPerPost) || channel.avgViewCount,
      },
    });

    // Save snapshot
    await prisma.channelStats.create({
      data: {
        channelId,
        subscriberCount: mtStats.subscriberCount || channel.subscriberCount,
        avgViewCount: Math.round(mtStats.viewsPerPost),
        sharesPerPost: mtStats.sharesPerPost,
        reactionsPerPost: mtStats.reactionsPerPost,
        rawData: mtStats.rawData as Prisma.JsonObject,
      },
    });
  }

  return {
    ...basicStats,
    mtproto: mtStats || null,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Update channel info from Telegram (subscriber count, etc.)
 */
export async function refreshChannelInfo(channelId: number) {
  const channel = await prisma.channel.findUniqueOrThrow({
    where: { id: channelId },
  });

  if (!channel.username) return channel;

  const chatInfo = await getChatInfo(`@${channel.username}`);
  const botAdmin = await isBotAdmin(`@${channel.username}`);

  return prisma.channel.update({
    where: { id: channelId },
    data: {
      title: chatInfo.title,
      description: chatInfo.description,
      subscriberCount: chatInfo.memberCount,
      botIsAdmin: botAdmin,
    },
  });
}

/**
 * Serialize BigInt fields to strings for JSON response.
 */
function serializeChannel(channel: Record<string, unknown>) {
  return JSON.parse(
    JSON.stringify(channel, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    ),
  );
}
