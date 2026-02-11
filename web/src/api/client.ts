import type { User, Channel, Campaign, Deal, DealEvent, EscrowInfo, PaginatedResponse } from '../types';

let authToken: string | null = null;

const tg = window.Telegram?.WebApp;

/**
 * Authenticate with the backend using Telegram initData.
 */
export async function authenticate(): Promise<User> {
  const initData = tg?.initData;
  if (!initData) {
    throw new Error('Telegram WebApp initData not available');
  }

  const response = await fetch('/api/auth/telegram', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData }),
  });

  if (!response.ok) {
    throw new Error('Authentication failed');
  }

  const data = await response.json();
  authToken = data.token;
  return data.user;
}

/**
 * Make an authenticated API request.
 */
async function api<T>(path: string, options?: RequestInit): Promise<T> {
  if (!authToken) {
    await authenticate();
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${authToken}`,
  };
  if (options?.body) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(path, {
    ...options,
    headers: {
      ...headers,
      ...options?.headers,
    },
  });

  if (response.status === 401) {
    // Token expired — re-authenticate
    authToken = null;
    await authenticate();
    return api(path, options);
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// ── User ───────────────────────────────────────────────────

export function getMe() {
  return api<User>('/api/user/me');
}

export function updateWallet(address: string) {
  return api<{ id: number; tonWalletAddress: string }>('/api/user/me/wallet', {
    method: 'PUT',
    body: JSON.stringify({ address }),
  });
}

// ── Channels ───────────────────────────────────────────────

export function getChannels(params?: Record<string, string | number>) {
  const query = params ? '?' + new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)]),
  ).toString() : '';
  return api<PaginatedResponse<Channel> & { channels: Channel[] }>(`/api/channels${query}`);
}

export function getChannel(id: number) {
  return api<Channel>(`/api/channels/${id}`);
}

export function addChannel(username: string, language?: string) {
  return api<Channel>('/api/channels', {
    method: 'POST',
    body: JSON.stringify({ username, language }),
  });
}

export function updateChannel(id: number, data: { language?: string; isActive?: boolean }) {
  return api<Channel>(`/api/channels/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function verifyChannel(id: number) {
  return api<{ botIsAdmin: boolean }>(`/api/channels/${id}/verify`, { method: 'POST' });
}

export interface ChannelFullStats {
  subscriberCount: number;
  avgViewCount: number;
  language: string | null;
  mtproto: {
    viewsPerPost: number;
    sharesPerPost: number;
    reactionsPerPost: number;
    subscriberCount: number;
  } | null;
  lastUpdated: string;
}

export function getChannelFullStats(id: number) {
  return api<ChannelFullStats>(`/api/channels/${id}/stats/full`);
}

export function setChannelPrices(id: number, prices: Array<{ format: string; priceInTon: number; description?: string }>) {
  return api(`/api/channels/${id}/prices`, {
    method: 'PUT',
    body: JSON.stringify({ prices }),
  });
}

// ── Campaigns ──────────────────────────────────────────────

export function getCampaigns(params?: Record<string, string | number>) {
  const query = params ? '?' + new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)]),
  ).toString() : '';
  return api<PaginatedResponse<Campaign> & { campaigns: Campaign[] }>(`/api/campaigns${query}`);
}

export function getCampaign(id: number) {
  return api<Campaign>(`/api/campaigns/${id}`);
}

export function createCampaign(data: {
  title: string;
  description: string;
  budgetPerPost: number;
  targetLanguage?: string;
  minSubscribers?: number;
}) {
  return api<Campaign>('/api/campaigns', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateCampaign(id: number, data: {
  title?: string;
  description?: string;
  budgetPerPost?: number;
  targetLanguage?: string;
  minSubscribers?: number;
}) {
  return api<Campaign>(`/api/campaigns/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function applyCampaign(campaignId: number, channelId: number, message?: string) {
  return api<Deal>(`/api/campaigns/${campaignId}/apply`, {
    method: 'POST',
    body: JSON.stringify({ channelId, message }),
  });
}

// ── Deals ──────────────────────────────────────────────────

export function getDeals(status?: string) {
  const query = status ? `?status=${status}` : '';
  return api<Deal[]>(`/api/deals${query}`);
}

export function getDeal(id: number) {
  return api<Deal>(`/api/deals/${id}`);
}

export function createDeal(channelId: number, format?: string, brief?: string) {
  return api<Deal>('/api/deals', {
    method: 'POST',
    body: JSON.stringify({ channelId, format, brief }),
  });
}

export function acceptDeal(id: number) {
  return api<Deal>(`/api/deals/${id}/accept`, { method: 'PUT' });
}

export function rejectDeal(id: number) {
  return api<Deal>(`/api/deals/${id}/reject`, { method: 'PUT' });
}

export function cancelDeal(id: number) {
  return api<Deal>(`/api/deals/${id}/cancel`, { method: 'PUT' });
}

export function submitCreative(id: number, text: string, mediaType?: string, mediaFileId?: string) {
  return api<Deal>(`/api/deals/${id}/creative`, {
    method: 'PUT',
    body: JSON.stringify({ text, mediaType, mediaFileId }),
  });
}

export function approveCreative(id: number) {
  return api<Deal>(`/api/deals/${id}/approve`, { method: 'PUT' });
}

export function requestEdit(id: number, comment: string) {
  return api<Deal>(`/api/deals/${id}/request-edit`, {
    method: 'PUT',
    body: JSON.stringify({ comment }),
  });
}

export function scheduleDealPost(id: number, scheduledAt: string) {
  return api<Deal>(`/api/deals/${id}/schedule`, {
    method: 'PUT',
    body: JSON.stringify({ scheduledAt }),
  });
}

export function getEscrowInfo(id: number) {
  return api<EscrowInfo>(`/api/deals/${id}/escrow`);
}

export function getDealEvents(id: number) {
  return api<DealEvent[]>(`/api/deals/${id}/events`);
}
