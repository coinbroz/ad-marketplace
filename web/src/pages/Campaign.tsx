import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Section, Cell, Badge, Button, Placeholder, Input } from '@telegram-apps/telegram-ui';
import { getCampaign, applyCampaign, updateCampaign, getMe } from '../api/client';
import { LanguageInput } from '../components/LanguageInput';
import type { User } from '../types';

interface Props {
  user: User | null;
}

const statusColors: Record<string, string> = {
  ACTIVE: '#34C759',
  PAUSED: '#FF9500',
  COMPLETED: '#8E8E93',
  CANCELLED: '#FF3B30',
};

export function CampaignPage({ user }: Props) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedChannel, setSelectedChannel] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);

  // Edit form state
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editBudget, setEditBudget] = useState('');
  const [editLanguage, setEditLanguage] = useState('');
  const [editMinSubs, setEditMinSubs] = useState('');
  const [saving, setSaving] = useState(false);

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

  const isOwner = user?.id === campaign.advertiserId;
  const myChannels = me?.channels?.filter((c) => c.botIsAdmin && c.isActive) || [];

  const startEditing = () => {
    setEditTitle(campaign.title);
    setEditDescription(campaign.description);
    setEditBudget(String(campaign.budgetPerPost));
    setEditLanguage(campaign.targetLanguage || '');
    setEditMinSubs(campaign.minSubscribers ? String(campaign.minSubscribers) : '');
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateCampaign(campaign.id, {
        title: editTitle.trim(),
        description: editDescription.trim(),
        budgetPerPost: parseFloat(editBudget),
        targetLanguage: editLanguage.trim() || undefined,
        minSubscribers: editMinSubs ? parseInt(editMinSubs, 10) : undefined,
      });
      queryClient.invalidateQueries({ queryKey: ['campaign', id] });
      setEditing(false);
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
    } catch (err) {
      window.Telegram?.WebApp?.showAlert?.(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

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

  // Edit mode
  if (editing) {
    return (
      <div>
        <Section header="Edit Campaign">
          <Input
            header="Title"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
          />
          <Input
            header="Description"
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
          />
          <Input
            header="Budget per post (TON)"
            type="number"
            step="0.1"
            value={editBudget}
            onChange={(e) => setEditBudget(e.target.value)}
          />
          <LanguageInput
            header="Target Language"
            placeholder="e.g. English, Russian"
            value={editLanguage}
            onChange={setEditLanguage}
          />
          <Input
            header="Min Subscribers"
            placeholder="e.g. 1000"
            type="number"
            value={editMinSubs}
            onChange={(e) => setEditMinSubs(e.target.value)}
          />
        </Section>
        <Section>
          <div style={{ display: 'flex', gap: 8, padding: '8px 16px' }}>
            <Button size="l" stretched onClick={handleSave} loading={saving}>
              Save
            </Button>
            <Button size="l" stretched mode="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </Section>
      </div>
    );
  }

  // View mode
  return (
    <div>
      <Section header={campaign.title}>
        <Cell
          subtitle="Status"
          after={
            <span style={{
              color: statusColors[campaign.status] || '#8E8E93',
              fontWeight: 600,
              fontSize: 14,
            }}>
              {campaign.status}
            </span>
          }
        >
          Campaign
        </Cell>
        <Cell subtitle="Budget per post">
          <Badge type="number">{`${campaign.budgetPerPost} TON`}</Badge>
        </Cell>
        <Cell subtitle="Description">{campaign.description}</Cell>
        <Cell subtitle="Target Language">
          {campaign.targetLanguage || '—  not specified'}
        </Cell>
        <Cell subtitle="Min Subscribers">
          {campaign.minSubscribers ? campaign.minSubscribers.toLocaleString() : '— any'}
        </Cell>
        {campaign.advertiser && (
          <Cell subtitle="Advertiser">{campaign.advertiser.firstName}</Cell>
        )}
        {campaign._count?.deals != null && (
          <Cell subtitle="Applications">{campaign._count.deals}</Cell>
        )}
      </Section>

      {/* Owner actions */}
      {isOwner && campaign.status === 'ACTIVE' && (
        <Section>
          <div style={{ padding: '8px 16px' }}>
            <Button size="l" stretched mode="outline" onClick={startEditing}>
              Edit Campaign
            </Button>
          </div>
        </Section>
      )}

      {/* Apply section for non-owners */}
      {!isOwner && campaign.status === 'ACTIVE' && myChannels.length > 0 && (
        <Section header="Apply with your channel">
          <div style={{ padding: '0 16px' }}>
            <select
              style={{
                width: '100%',
                padding: '12px',
                fontSize: '16px',
                border: '1px solid var(--tg-theme-hint-color, #999)',
                borderRadius: '8px',
                background: 'var(--tg-theme-secondary-bg-color, #f0f0f0)',
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
          </div>

          <div style={{ padding: '12px 16px' }}>
            <Button
              size="l"
              stretched
              onClick={handleApply}
              disabled={!selectedChannel}
            >
              Apply — {(() => {
                if (!selectedChannel) return `${campaign.budgetPerPost} TON`;
                const ch = myChannels.find((c) => c.id === selectedChannel);
                const postPrice = ch?.prices?.find((p) => p.format === 'post');
                return `${postPrice?.priceInTon ?? campaign.budgetPerPost} TON`;
              })()}
            </Button>
          </div>
        </Section>
      )}

      {!isOwner && campaign.status === 'ACTIVE' && myChannels.length === 0 && (
        <Section>
          <Placeholder description="Add a channel in Profile to apply for campaigns" />
        </Section>
      )}

      {campaign.status !== 'ACTIVE' && !isOwner && (
        <Section>
          <Placeholder description={`Campaign is ${campaign.status.toLowerCase()}`} />
        </Section>
      )}
    </div>
  );
}
