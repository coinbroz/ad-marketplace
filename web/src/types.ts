// Shared types for the Mini App

export interface User {
  id: number;
  telegramId: string;
  username: string | null;
  firstName: string;
  lastName: string | null;
  role: 'ADVERTISER' | 'CHANNEL_OWNER' | 'BOTH';
  tonWalletAddress: string | null;
  channels?: Channel[];
  campaigns?: Campaign[];
}

export interface Channel {
  id: number;
  telegramId: string;
  username: string | null;
  title: string;
  description: string | null;
  subscriberCount: number;
  avgViewCount: number;
  language: string | null;
  botIsAdmin: boolean;
  isActive: boolean;
  ownerId: number;
  owner?: { id: number; username: string | null; firstName: string };
  prices: ChannelPrice[];
}

export interface ChannelPrice {
  id: number;
  channelId: number;
  format: string;
  priceInTon: number;
  description: string | null;
}

export interface Campaign {
  id: number;
  advertiserId: number;
  advertiser?: { id: number; username: string | null; firstName: string };
  title: string;
  description: string;
  budgetPerPost: number;
  targetLanguage: string | null;
  minSubscribers: number | null;
  minAvgViews: number | null;
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
  _count?: { deals: number };
}

export type DealStatus =
  | 'PENDING' | 'ACCEPTED' | 'AWAITING_PAYMENT' | 'FUNDED'
  | 'CREATIVE_DRAFT' | 'CREATIVE_REVIEW' | 'CREATIVE_APPROVED'
  | 'SCHEDULED' | 'POSTED' | 'VERIFIED' | 'COMPLETED'
  | 'REFUNDED' | 'CANCELLED' | 'DISPUTED' | 'EXPIRED';

export interface Deal {
  id: number;
  channelId: number;
  campaignId: number | null;
  advertiserId: number;
  channelOwnerId: number;
  initiatedBy: 'advertiser' | 'channel_owner';
  format: string;
  priceInTon: number;
  status: DealStatus;
  escrowAddress: string | null;
  brief: string | null;
  creativeText: string | null;
  creativeMediaType: string | null;
  creativeApproved: boolean;
  editComment: string | null;
  scheduledAt: string | null;
  postedAt: string | null;
  postMessageId: number | null;
  refundAddress: string | null;
  refundMemo: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  channel?: { id: number; title: string; username: string | null; subscriberCount: number };
  advertiser?: { id: number; username: string | null; firstName: string };
  channelOwner?: { id: number; username: string | null; firstName: string };
  campaign?: { id: number; title: string } | null;
  events?: DealEvent[];
}

export interface DealEvent {
  id: number;
  dealId: number;
  type: string;
  data: Record<string, unknown> | null;
  createdAt: string;
}

export interface EscrowInfo {
  address: string | null;
  requiredAmount: number;
  currentBalance: number;
  status: DealStatus;
  explorerUrl: string | null;
  paymentTx: string | null;
  payoutTx: string | null;
  refundTx: string | null;
  payoutPending: boolean;
  refundPending: boolean;
}

export interface PaginatedResponse<T> {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  channels?: T[];
  campaigns?: T[];
}
