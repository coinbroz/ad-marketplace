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

  const channelsQuery = useQuery({
    queryKey: ['channels', search],
    queryFn: () => getChannels(search ? { search, limit: 50 } : { limit: 50 }),
    enabled: tab === 'channels',
  });

  const campaignsQuery = useQuery({
    queryKey: ['campaigns', search],
    queryFn: () => getCampaigns(search ? { search, limit: 50 } : { limit: 50 }),
    enabled: tab === 'campaigns',
  });

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
      </Section>

      {tab === 'channels' && (
        <Section header="Available Channels">
          {channelsQuery.isLoading && <Cell>Loading channels...</Cell>}
          {channelsQuery.error && <Cell>Failed to load channels</Cell>}
          {channelsQuery.data?.channels?.length === 0 && <Cell>No channels found</Cell>}
          {channelsQuery.data?.channels?.map((channel: Channel) => (
            <Cell
              key={channel.id}
              subtitle={`${channel.subscriberCount.toLocaleString()} subscribers`}
              after={
                channel.prices[0] ? (
                  <Badge type="number">{`${channel.prices[0].priceInTon} TON`}</Badge>
                ) : undefined
              }
              onClick={() => navigate(`/channels/${channel.id}`)}
            >
              {channel.title}
              {channel.username && ` @${channel.username}`}
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
              subtitle={campaign.description.substring(0, 100)}
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
