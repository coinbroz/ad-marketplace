import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Section, Cell, Badge, Button, Placeholder, Select } from '@telegram-apps/telegram-ui';
import { getCampaign, applyCampaign, getMe } from '../api/client';
import type { User } from '../types';

interface Props {
  user: User | null;
}

export function CampaignPage({ user }: Props) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [selectedChannel, setSelectedChannel] = useState<number | null>(null);

  const { data: campaign, isLoading, error } = useQuery({
    queryKey: ['campaign', id],
    queryFn: () => getCampaign(parseInt(id!, 10)),
    enabled: !!id,
  });

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: getMe,
  });

  if (isLoading) return <Placeholder description="Loading campaign..." />;
  if (error || !campaign) return <Placeholder description="Campaign not found" />;

  const isAdvertiser = user?.id === campaign.advertiserId;
  const myChannels = me?.channels?.filter((c) => c.botIsAdmin && c.isActive) || [];

  const handleApply = async () => {
    if (!selectedChannel) {
      window.Telegram?.WebApp?.showAlert?.('Please select a channel');
      return;
    }

    try {
      const deal = await applyCampaign(campaign.id, selectedChannel);
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
      navigate(`/deals/${deal.id}`);
    } catch (err) {
      window.Telegram?.WebApp?.showAlert?.(err instanceof Error ? err.message : 'Failed to apply');
    }
  };

  return (
    <div>
      <Section header={campaign.title}>
        <Cell subtitle="Budget per post">
          <Badge type="number">{`${campaign.budgetPerPost} TON`}</Badge>
        </Cell>
        <Cell subtitle="Description">{campaign.description}</Cell>
        {campaign.targetLanguage && (
          <Cell subtitle="Target language">{campaign.targetLanguage}</Cell>
        )}
        {campaign.minSubscribers && (
          <Cell subtitle="Min subscribers">{campaign.minSubscribers.toLocaleString()}</Cell>
        )}
        {campaign.advertiser && (
          <Cell subtitle="Advertiser">{campaign.advertiser.firstName}</Cell>
        )}
      </Section>

      {!isAdvertiser && myChannels.length > 0 && (
        <Section header="Apply with your channel">
          <select
            style={{
              width: '100%',
              padding: '12px',
              fontSize: '16px',
              border: '1px solid var(--tg-theme-hint-color, #999)',
              borderRadius: '8px',
              background: 'var(--tg-theme-bg-color, #fff)',
              color: 'var(--tg-theme-text-color, #000)',
            }}
            value={selectedChannel || ''}
            onChange={(e) => setSelectedChannel(parseInt(e.target.value, 10))}
          >
            <option value="">Select a channel...</option>
            {myChannels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.title} ({channel.subscriberCount.toLocaleString()} subs)
              </option>
            ))}
          </select>

          <div style={{ padding: '12px 0' }}>
            <Button
              size="l"
              stretched
              onClick={handleApply}
              disabled={!selectedChannel}
            >
              Apply — {campaign.budgetPerPost} TON
            </Button>
          </div>
        </Section>
      )}

      {!isAdvertiser && myChannels.length === 0 && (
        <Section>
          <Placeholder description="Add a channel to your profile to apply for campaigns" />
        </Section>
      )}
    </div>
  );
}
