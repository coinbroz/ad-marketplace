import { DealStatus, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { DEAL_TIMEOUTS } from '../config.js';
import { notifyUser } from './telegram.js';

// ── Deal State Machine ─────────────────────────────────────

const VALID_TRANSITIONS: Record<DealStatus, DealStatus[]> = {
  PENDING: ['ACCEPTED', 'CANCELLED', 'EXPIRED'],
  ACCEPTED: ['AWAITING_PAYMENT', 'CANCELLED'],
  AWAITING_PAYMENT: ['FUNDED', 'CANCELLED', 'EXPIRED'],
  FUNDED: ['CREATIVE_DRAFT', 'CANCELLED', 'REFUNDED'],
  CREATIVE_DRAFT: ['CREATIVE_REVIEW', 'CANCELLED', 'REFUNDED'],
  CREATIVE_REVIEW: ['CREATIVE_APPROVED', 'CREATIVE_DRAFT', 'CANCELLED', 'REFUNDED'],
  CREATIVE_APPROVED: ['SCHEDULED', 'POSTED', 'CANCELLED', 'REFUNDED'],
  SCHEDULED: ['SCHEDULED', 'POSTED', 'CANCELLED', 'REFUNDED'],
  POSTED: ['VERIFIED', 'DISPUTED'],
  VERIFIED: ['COMPLETED'],
  COMPLETED: [],
  REFUNDED: [],
  CANCELLED: ['REFUNDED'],  // Allow refund for cancelled deals that had payment
  DISPUTED: ['REFUNDED', 'COMPLETED'],
  EXPIRED: [],
};

/**
 * Check if a state transition is valid.
 */
export function isValidTransition(from: DealStatus, to: DealStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Transition a deal to a new status with validation and event logging.
 */
export async function transitionDeal(
  dealId: number,
  newStatus: DealStatus,
  extra?: Partial<Prisma.DealUpdateInput>,
  eventData?: Record<string, unknown>,
) {
  const deal = await prisma.deal.findUniqueOrThrow({ where: { id: dealId } });

  if (!isValidTransition(deal.status, newStatus)) {
    throw new Error(`Invalid transition: ${deal.status} → ${newStatus}`);
  }

  // Calculate new expiresAt based on timeout for new status
  const timeoutHours = DEAL_TIMEOUTS[newStatus];
  const expiresAt = timeoutHours
    ? new Date(Date.now() + timeoutHours * 3600_000)
    : null;

  const updated = await prisma.deal.update({
    where: { id: dealId },
    data: {
      status: newStatus,
      expiresAt,
      ...extra,
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
      type: 'status_change',
      data: {
        from: deal.status,
        to: newStatus,
        ...eventData,
      },
    },
  });

  return updated;
}

// ── Deal Operations ────────────────────────────────────────

export interface CreateDealInput {
  channelId: number;
  advertiserId: number;
  channelOwnerId: number;
  campaignId?: number;
  initiatedBy: 'advertiser' | 'channel_owner';
  format?: string;
  priceInTon: number;
  brief?: string;
}

/**
 * Create a new deal.
 */
export async function createDeal(input: CreateDealInput) {
  const deal = await prisma.deal.create({
    data: {
      channelId: input.channelId,
      advertiserId: input.advertiserId,
      channelOwnerId: input.channelOwnerId,
      campaignId: input.campaignId || null,
      initiatedBy: input.initiatedBy,
      format: input.format || 'post',
      priceInTon: input.priceInTon,
      brief: input.brief || null,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + DEAL_TIMEOUTS.PENDING * 3600_000),
    },
    include: {
      channel: true,
      advertiser: true,
      channelOwner: true,
    },
  });

  // Log creation event
  await prisma.dealEvent.create({
    data: {
      dealId: deal.id,
      type: 'status_change',
      data: { from: null, to: 'PENDING', initiatedBy: input.initiatedBy },
    },
  });

  return deal;
}

/**
 * Accept a deal. Can be called by the other party.
 */
export async function acceptDeal(dealId: number, userId: number) {
  const deal = await prisma.deal.findUniqueOrThrow({
    where: { id: dealId },
    include: { advertiser: true, channelOwner: true },
  });

  // The accepting party must be the OTHER side
  if (deal.initiatedBy === 'advertiser' && userId !== deal.channelOwnerId) {
    throw new Error('Only the channel owner can accept this deal');
  }
  if (deal.initiatedBy === 'channel_owner' && userId !== deal.advertiserId) {
    throw new Error('Only the advertiser can accept this deal');
  }

  return transitionDeal(dealId, 'ACCEPTED', {}, { acceptedBy: userId });
}

/**
 * Move deal to AWAITING_PAYMENT — generates escrow wallet.
 * Called after both parties agree.
 */
export async function moveToPayment(dealId: number) {
  const { generateEscrowWallet } = await import('../utils/ton-wallet.js');

  const walletData = await generateEscrowWallet();

  // Create EscrowWallet record
  await prisma.escrowWallet.create({
    data: {
      dealId,
      address: walletData.address,
      publicKey: walletData.publicKey,
      secretKeyEnc: walletData.secretKeyEnc,
      secretKeyIv: walletData.secretKeyIv,
      secretKeyTag: walletData.secretKeyTag,
    },
  });

  return transitionDeal(dealId, 'AWAITING_PAYMENT', {
    escrowAddress: walletData.address,
  });
}

/**
 * Submit creative for review.
 */
export async function submitCreative(
  dealId: number,
  userId: number,
  creative: {
    text: string;
    mediaType?: string;
    mediaFileId?: string;
  },
) {
  const deal = await prisma.deal.findUniqueOrThrow({ where: { id: dealId } });

  if (userId !== deal.channelOwnerId) {
    throw new Error('Only the channel owner can submit creative');
  }

  // If in FUNDED, move to CREATIVE_DRAFT first
  if (deal.status === 'FUNDED') {
    await transitionDeal(dealId, 'CREATIVE_DRAFT');
  }

  return transitionDeal(dealId, 'CREATIVE_REVIEW', {
    creativeText: creative.text,
    creativeMediaType: creative.mediaType || null,
    creativeMediaFileId: creative.mediaFileId || null,
    editComment: null,
  });
}

/**
 * Approve creative.
 */
export async function approveCreative(dealId: number, userId: number) {
  const deal = await prisma.deal.findUniqueOrThrow({ where: { id: dealId } });

  if (userId !== deal.advertiserId) {
    throw new Error('Only the advertiser can approve creative');
  }

  return transitionDeal(dealId, 'CREATIVE_APPROVED', {
    creativeApproved: true,
  });
}

/**
 * Request creative edits.
 */
export async function requestCreativeEdit(
  dealId: number,
  userId: number,
  comment: string,
) {
  const deal = await prisma.deal.findUniqueOrThrow({ where: { id: dealId } });

  if (userId !== deal.advertiserId) {
    throw new Error('Only the advertiser can request edits');
  }

  return transitionDeal(dealId, 'CREATIVE_DRAFT', {
    editComment: comment,
    creativeApproved: false,
  });
}

/**
 * Cancel a deal. Either party can cancel in most states.
 */
export async function cancelDeal(dealId: number, userId: number) {
  const deal = await prisma.deal.findUniqueOrThrow({ where: { id: dealId } });

  if (userId !== deal.advertiserId && userId !== deal.channelOwnerId) {
    throw new Error('Not authorized to cancel this deal');
  }

  return transitionDeal(dealId, 'CANCELLED', {}, { cancelledBy: userId });
}

/**
 * Schedule a post for a specific time.
 */
export async function scheduleDeal(dealId: number, scheduledAt: Date) {
  const deal = await transitionDeal(dealId, 'SCHEDULED', { scheduledAt });

  // Add BullMQ job to publish at the scheduled time
  const { schedulePublishJob } = await import('../workers/scheduled-publisher.js');
  await schedulePublishJob(dealId, scheduledAt);

  return deal;
}

/**
 * Get deals for a user.
 */
export async function getUserDeals(userId: number, statusFilter?: DealStatus[]) {
  const where: Prisma.DealWhereInput = {
    OR: [
      { advertiserId: userId },
      { channelOwnerId: userId },
    ],
  };

  if (statusFilter && statusFilter.length > 0) {
    where.status = { in: statusFilter };
  }

  const deals = await prisma.deal.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    include: {
      channel: {
        select: { id: true, title: true, username: true, subscriberCount: true },
      },
      advertiser: {
        select: { id: true, username: true, firstName: true },
      },
      channelOwner: {
        select: { id: true, username: true, firstName: true },
      },
      campaign: {
        select: { id: true, title: true },
      },
    },
  });

  return deals.map(serializeDeal);
}

/**
 * Get deal by ID with full details.
 */
export async function getDealById(dealId: number) {
  const deal = await prisma.deal.findUniqueOrThrow({
    where: { id: dealId },
    include: {
      channel: {
        select: { id: true, title: true, username: true, subscriberCount: true, telegramId: true },
      },
      advertiser: {
        select: { id: true, username: true, firstName: true, telegramId: true, tonWalletAddress: true },
      },
      channelOwner: {
        select: { id: true, username: true, firstName: true, telegramId: true, tonWalletAddress: true },
      },
      campaign: {
        select: { id: true, title: true },
      },
      events: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  return serializeDeal(deal);
}

/**
 * Get deal events (timeline).
 */
export async function getDealEvents(dealId: number) {
  return prisma.dealEvent.findMany({
    where: { dealId },
    orderBy: { createdAt: 'asc' },
  });
}

function serializeDeal(deal: Record<string, unknown>) {
  return JSON.parse(
    JSON.stringify(deal, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    ),
  );
}
