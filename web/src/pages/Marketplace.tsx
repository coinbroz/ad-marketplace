import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Section, Cell, Badge, Input, SegmentedControl, Button } from '@telegram-apps/telegram-ui';
import { getChannels, getCampaigns, getMe } from '../api/client';
import { LanguageInput } from '../components/LanguageInput';
import type { User, Channel, Campaign } from '../types';

interface Props {
  user: User | null;
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: 'rgba(0,0,0,0.5)',
  zIndex: 1000,
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'center',
};

const panelStyle: React.CSSProperties = {
  width: '100%',
  maxHeight: '70vh',
  background: 'var(--tg-theme-bg-color, #fff)',
  borderRadius: '16px 16px 0 0',
  overflow: 'auto',
  paddingBottom: 16,
};

const chipStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 10px',
  fontSize: 12,
  borderRadius: 12,
  background: 'var(--tg-theme-button-color, #3390ec)',
  color: 'var(--tg-theme-button-text-color, #fff)',
  whiteSpace: 'nowrap',
};

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

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: getMe,
  });

  // Filter campaigns: only show ones where at least one user's channel qualifies
  const myChannels = meQuery.data?.channels?.filter((c) => c.botIsAdmin && c.isActive) || [];
  const filteredCampaigns = campaignsQuery.data?.campaigns?.filter((campaign: Campaign) => {
    // No requirements → show to everyone
    if (!campaign.minSubscribers && !campaign.minAvgViews) return true;
    // User has no channels → show all (they might be advertisers or plan to add a channel)
    if (myChannels.length === 0) return true;
    // User is the campaign owner → always show
    if (campaign.advertiserId === user?.id) return true;
    // At least one channel must qualify
    return myChannels.some((ch) => {
      if (campaign.minSubscribers && ch.subscriberCount < campaign.minSubscribers) return false;
      if (campaign.minAvgViews && ch.avgViewCount < (campaign.minAvgViews ?? 0)) return false;
      return true;
    });
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

  const sortLabels: Record<string, string> = {
    subscribers: 'Most Subs',
    views: 'Most Views',
    price_asc: 'Cheapest',
    price_desc: 'Expensive',
  };

  // Active filter chips for channels
  const channelChips: string[] = [];
  if (minSubs) channelChips.push(`${Number(minSubs).toLocaleString()}+ subs`);
  if (maxPrice) channelChips.push(`≤${maxPrice} TON`);
  if (language) channelChips.push(language);
  if (sortBy && sortLabels[sortBy]) channelChips.push(sortLabels[sortBy]);

  // Active filter chips for campaigns
  const campaignChips: string[] = [];
  if (minBudget) campaignChips.push(`≥${minBudget} TON`);
  if (campLanguage) campaignChips.push(campLanguage);

  const activeChips = tab === 'channels' ? channelChips : campaignChips;

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
        <div style={{ display: 'flex', gap: 8, padding: '4px 16px 8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <Button
            size="s"
            mode={hasActiveFilters ? 'filled' : 'outline'}
            onClick={() => setShowFilters(true)}
          >
            Filters
          </Button>
          {hasActiveFilters && (
            <Button size="s" mode="outline" onClick={clearFilters}>
              Clear
            </Button>
          )}
          {activeChips.map((chip, i) => (
            <span key={i} style={chipStyle}>{chip}</span>
          ))}
        </div>
      </Section>

      {/* Filter Modal Overlay */}
      {showFilters && (
        <div style={overlayStyle} onClick={() => setShowFilters(false)}>
          <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
            {tab === 'channels' ? (
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
                  step="0.1"
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)}
                />
                <LanguageInput
                  header="Language"
                  placeholder="e.g. English, Russian"
                  value={language}
                  onChange={setLanguage}
                />
                <div style={{ padding: '8px 16px' }}>
                  <select
                    style={{
                      width: '100%', padding: '10px', fontSize: '14px',
                      border: '1px solid var(--tg-theme-hint-color, #999)',
                      borderRadius: '8px',
                      background: 'var(--tg-theme-secondary-bg-color, #f0f0f0)',
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
            ) : (
              <Section header="Filter Campaigns">
                <Input
                  header="Min Budget (TON)"
                  placeholder="e.g. 5"
                  type="number"
                  step="0.1"
                  value={minBudget}
                  onChange={(e) => setMinBudget(e.target.value)}
                />
                <LanguageInput
                  header="Language"
                  placeholder="e.g. English, Russian"
                  value={campLanguage}
                  onChange={setCampLanguage}
                />
              </Section>
            )}
            <div style={{ display: 'flex', gap: 8, padding: '8px 16px' }}>
              <Button size="l" stretched onClick={() => setShowFilters(false)}>
                Apply
              </Button>
              <Button size="l" stretched mode="outline" onClick={() => { clearFilters(); setShowFilters(false); }}>
                Reset
              </Button>
            </div>
          </div>
        </div>
      )}

      {tab === 'channels' && (
        <Section header={`Available Channels${channelsQuery.data?.total != null ? ` (${channelsQuery.data.total})` : ''}`}>
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
          {filteredCampaigns?.length === 0 && !campaignsQuery.isLoading && <Cell>No campaigns found</Cell>}
          {filteredCampaigns?.map((campaign: Campaign) => (
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
