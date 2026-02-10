import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Section, Cell, Badge, Input, SegmentedControl, Button } from '@telegram-apps/telegram-ui';
import { getChannels, getCampaigns } from '../api/client';
import type { User, Channel, Campaign } from '../types';

interface Props {
  user: User | null;
}

export function MarketplacePage({ user }: Props) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'channels' | 'campaigns'>('channels');
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Channel filters
  const [minSubs, setMinSubs] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [language, setLanguage] = useState('');
  const [sortBy, setSortBy] = useState('');

  // Campaign filters
  const [minBudget, setMinBudget] = useState('');
  const [campLanguage, setCampLanguage] = useState('');

  const channelParams: Record<string, string | number> = { limit: 50 };
  if (search) channelParams.search = search;
  if (minSubs) channelParams.minSubscribers = parseInt(minSubs, 10);
  if (maxPrice) channelParams.maxPrice = parseFloat(maxPrice);
  if (language) channelParams.language = language;
  if (sortBy) channelParams.sortBy = sortBy;

  const campaignParams: Record<string, string | number> = { limit: 50 };
  if (search) campaignParams.search = search;
  if (minBudget) campaignParams.minBudget = parseFloat(minBudget);
  if (campLanguage) campaignParams.language = campLanguage;

  const channelsQuery = useQuery({
    queryKey: ['channels', search, minSubs, maxPrice, language, sortBy],
    queryFn: () => getChannels(channelParams),
    enabled: tab === 'channels',
  });

  const campaignsQuery = useQuery({
    queryKey: ['campaigns', search, minBudget, campLanguage],
    queryFn: () => getCampaigns(campaignParams),
    enabled: tab === 'campaigns',
  });

  const clearFilters = () => {
    setMinSubs('');
    setMaxPrice('');
    setLanguage('');
    setSortBy('');
    setMinBudget('');
    setCampLanguage('');
  };

  const hasActiveFilters = !!(minSubs || maxPrice || language || sortBy || minBudget || campLanguage);

  return (
    <div>
      <Section header="Ad Marketplace">
        <SegmentedControl>
          <SegmentedControl.Item
            selected={tab === 'channels'}
            onClick={() => setTab('channels')}
          >
            Channels
          </SegmentedControl.Item>
          <SegmentedControl.Item
            selected={tab === 'campaigns'}
            onClick={() => setTab('campaigns')}
          >
            Campaigns
          </SegmentedControl.Item>
        </SegmentedControl>
      </Section>

      <Section>
        <Input
          placeholder={tab === 'channels' ? 'Search channels...' : 'Search campaigns...'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div style={{ display: 'flex', gap: 8, padding: '4px 16px 8px' }}>
          <Button
            size="s"
            mode={showFilters ? 'filled' : 'outline'}
            onClick={() => setShowFilters(!showFilters)}
          >
            Filters{hasActiveFilters ? ' *' : ''}
          </Button>
          {hasActiveFilters && (
            <Button size="s" mode="outline" onClick={clearFilters}>
              Clear
            </Button>
          )}
        </div>
      </Section>

      {/* Channel Filters */}
      {showFilters && tab === 'channels' && (
        <Section header="Filter Channels">
          <Input
            header="Min Subscribers"
            placeholder="e.g. 1000"
            type="number"
            value={minSubs}
            onChange={(e) => setMinSubs(e.target.value)}
          />
          <Input
            header="Max Price (TON)"
            placeholder="e.g. 10"
            type="number"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
          />
          <Input
            header="Language"
            placeholder="e.g. English, Russian"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          />
          <div style={{ padding: '8px 16px' }}>
            <select
              style={{
                width: '100%', padding: '10px', fontSize: '14px',
                border: '1px solid var(--tg-theme-hint-color, #999)',
                borderRadius: '8px',
                background: 'var(--tg-theme-bg-color, #fff)',
                color: 'var(--tg-theme-text-color, #000)',
              }}
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
            >
              <option value="">Sort by: Default</option>
              <option value="subscribers">Most Subscribers</option>
              <option value="views">Most Views</option>
              <option value="price_asc">Cheapest First</option>
              <option value="price_desc">Most Expensive First</option>
            </select>
          </div>
        </Section>
      )}

      {/* Campaign Filters */}
      {showFilters && tab === 'campaigns' && (
        <Section header="Filter Campaigns">
          <Input
            header="Min Budget (TON)"
            placeholder="e.g. 5"
            type="number"
            value={minBudget}
            onChange={(e) => setMinBudget(e.target.value)}
          />
          <Input
            header="Language"
            placeholder="e.g. English, Russian"
            value={campLanguage}
            onChange={(e) => setCampLanguage(e.target.value)}
          />
        </Section>
      )}

      {tab === 'channels' && (
        <Section header="Available Channels">
          {channelsQuery.isLoading && <Cell>Loading channels...</Cell>}
          {channelsQuery.error && <Cell>Failed to load channels</Cell>}
          {channelsQuery.data?.channels?.length === 0 && <Cell>No channels found</Cell>}
          {channelsQuery.data?.channels?.map((channel: Channel) => (
            <Cell
              key={channel.id}
              subtitle={
                `${channel.subscriberCount.toLocaleString()} subs` +
                (channel.language ? ` · ${channel.language}` : '') +
                (channel.avgViewCount > 0 ? ` · ${channel.avgViewCount.toLocaleString()} views` : '')
              }
              after={
                channel.prices[0] ? (
                  <Badge type="number">{`${channel.prices[0].priceInTon} TON`}</Badge>
                ) : undefined
              }
              onClick={() => navigate(`/channels/${channel.id}`)}
            >
              {channel.title}
            </Cell>
          ))}
        </Section>
      )}

      {tab === 'campaigns' && (
        <Section header="Active Campaigns">
          <div style={{ padding: '8px 16px' }}>
            <Button
              size="l"
              stretched
              onClick={() => navigate('/campaigns/create')}
            >
              + Create Campaign
            </Button>
          </div>
          {campaignsQuery.isLoading && <Cell>Loading campaigns...</Cell>}
          {campaignsQuery.error && <Cell>Failed to load campaigns</Cell>}
          {campaignsQuery.data?.campaigns?.length === 0 && <Cell>No campaigns found</Cell>}
          {campaignsQuery.data?.campaigns?.map((campaign: Campaign) => (
            <Cell
              key={campaign.id}
              subtitle={
                campaign.description.substring(0, 80) +
                (campaign.targetLanguage ? ` · ${campaign.targetLanguage}` : '')
              }
              after={<Badge type="number">{`${campaign.budgetPerPost} TON`}</Badge>}
              onClick={() => navigate(`/campaigns/${campaign.id}`)}
            >
              {campaign.title}
            </Cell>
          ))}
        </Section>
      )}
    </div>
  );
}
