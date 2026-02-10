import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export interface CreateCampaignInput {
  advertiserId: number;
  title: string;
  description: string;
  budgetPerPost: number;
  targetLanguage?: string;
  minSubscribers?: number;
  minAvgViews?: number;
}

export interface CampaignFilters {
  minBudget?: number;
  maxBudget?: number;
  language?: string;
  status?: 'ACTIVE' | 'PAUSED';
  search?: string;
  sortBy?: 'budget' | 'created';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

/**
 * Create a new campaign (advertiser brief).
 */
export async function createCampaign(input: CreateCampaignInput) {
  return prisma.campaign.create({
    data: {
      advertiserId: input.advertiserId,
      title: input.title,
      description: input.description,
      budgetPerPost: input.budgetPerPost,
      targetLanguage: input.targetLanguage || null,
      minSubscribers: input.minSubscribers || null,
      minAvgViews: input.minAvgViews || null,
    },
    include: {
      advertiser: {
        select: { id: true, username: true, firstName: true },
      },
    },
  });
}

/**
 * List campaigns with filters and pagination.
 */
export async function listCampaigns(filters: CampaignFilters) {
  const page = filters.page || 1;
  const limit = Math.min(filters.limit || 20, 100);
  const skip = (page - 1) * limit;

  const where: Prisma.CampaignWhereInput = {};

  // Budget filters
  if (filters.minBudget) {
    where.budgetPerPost = { ...where.budgetPerPost as object, gte: filters.minBudget };
  }
  if (filters.maxBudget) {
    where.budgetPerPost = { ...where.budgetPerPost as object, lte: filters.maxBudget };
  }

  // Language filter
  if (filters.language) {
    where.targetLanguage = filters.language;
  }

  // Status filter
  if (filters.status) {
    where.status = filters.status;
  } else {
    where.status = 'ACTIVE'; // Default: show only active
  }

  // Search filter
  if (filters.search) {
    where.OR = [
      { title: { contains: filters.search, mode: 'insensitive' } },
      { description: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  // Sort
  let orderBy: Prisma.CampaignOrderByWithRelationInput = { createdAt: 'desc' };
  const order = filters.sortOrder || 'desc';

  switch (filters.sortBy) {
    case 'budget':
      orderBy = { budgetPerPost: order };
      break;
    case 'created':
      orderBy = { createdAt: order };
      break;
  }

  const [campaigns, total] = await Promise.all([
    prisma.campaign.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      include: {
        advertiser: {
          select: { id: true, username: true, firstName: true },
        },
        _count: { select: { deals: true } },
      },
    }),
    prisma.campaign.count({ where }),
  ]);

  return {
    campaigns,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * Get campaign by ID.
 */
export async function getCampaignById(id: number) {
  return prisma.campaign.findUniqueOrThrow({
    where: { id },
    include: {
      advertiser: {
        select: { id: true, username: true, firstName: true },
      },
      deals: {
        select: {
          id: true,
          status: true,
          channel: {
            select: { id: true, title: true, username: true, subscriberCount: true },
          },
        },
      },
    },
  });
}

/**
 * Update a campaign.
 */
export async function updateCampaign(
  id: number,
  advertiserId: number,
  data: Partial<Pick<CreateCampaignInput, 'title' | 'description' | 'budgetPerPost' | 'targetLanguage' | 'minSubscribers' | 'minAvgViews'>>,
) {
  const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id } });

  if (campaign.advertiserId !== advertiserId) {
    throw new Error('Not authorized to update this campaign');
  }

  return prisma.campaign.update({
    where: { id },
    data,
  });
}

/**
 * Cancel a campaign.
 */
export async function cancelCampaign(id: number, advertiserId: number) {
  const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id } });

  if (campaign.advertiserId !== advertiserId) {
    throw new Error('Not authorized to cancel this campaign');
  }

  return prisma.campaign.update({
    where: { id },
    data: { status: 'CANCELLED' },
  });
}
