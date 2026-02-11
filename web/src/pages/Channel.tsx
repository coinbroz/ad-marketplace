import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Section, Cell, Badge, Button, Placeholder, Input } from '@telegram-apps/telegram-ui';
import { getChannel, createDeal, setChannelPrices, verifyChannel, updateChannel, getChannelFullStats } from '../api/client';
import { LanguageInput } from '../components/LanguageInput';
import type { User } from '../types';

interface Props {
  user: User | null;
}

const AD_FORMATS = [
  { value: 'post', label: 'Post' },
  { value: 'forward', label: 'Forward/Repost' },
  { value: 'story', label: 'Story' },
];

export function ChannelPage({ user }: Props) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showPriceForm, setShowPriceForm] = useState(false);
  const [priceInputs, setPriceInputs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [languageInput, setLanguageInput] = useState('');
  const [editingLanguage, setEditingLanguage] = useState(false);

  const { data: channel, isLoading, error } = useQuery({
    queryKey: ['channel', id],
    queryFn: () => getChannel(parseInt(id!, 10)),
    enabled: !!id,
  });

  const { data: fullStats } = useQuery({
    queryKey: ['channel-stats', id],
    queryFn: () => getChannelFullStats(parseInt(id!, 10)),
    enabled: !!id,
    staleTime: 5 * 60 * 1000, // 5 min cache
  });

  if (isLoading) return <Placeholder description="Loading channel..." />;
  if (error || !channel) return <Placeholder description="Channel not found" />;

  const isOwner = user?.id === channel.ownerId;

  const handleProposeDeal = async () => {
    const tg = window.Telegram?.WebApp;
    if (tg?.showConfirm) {
      tg.showConfirm(
        `Propose a deal with ${channel.title} for ${channel.prices[0]?.priceInTon || '?'} TON?`,
        async (confirmed: boolean) => {
          if (confirmed) {
            try {
              const deal = await createDeal(channel.id);
              tg.HapticFeedback?.notificationOccurred('success');
              navigate(`/deals/${deal.id}`);
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'Failed to create deal';
              tg.showAlert?.(msg.includes('active deal') ? msg + '\n\nCheck the "My Deals" tab below.' : msg);
            }
          }
        },
      );
    }
  };

  const handleSavePrices = async () => {
    const prices = Object.entries(priceInputs)
      .filter(([, val]) => val && parseFloat(val) > 0)
      .map(([format, val]) => ({ format, priceInTon: parseFloat(val) }));

    if (prices.length === 0) {
      window.Telegram?.WebApp?.showAlert?.('Enter at least one price');
      return;
    }

    setSaving(true);
    try {
      await setChannelPrices(channel.id, prices);
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
      queryClient.invalidateQueries({ queryKey: ['channel', id] });
      setShowPriceForm(false);
    } catch (err) {
      window.Telegram?.WebApp?.showAlert?.(err instanceof Error ? err.message : 'Failed to save prices');
    } finally {
      setSaving(false);
    }
  };

  const handleVerifyBot = async () => {
    setVerifying(true);
    try {
      const result = await verifyChannel(channel.id);
      queryClient.invalidateQueries({ queryKey: ['channel', id] });
      window.Telegram?.WebApp?.showAlert?.(
        result.botIsAdmin ? 'Bot is admin! Auto-posting enabled.' : 'Bot is NOT admin. Please add @channelescrow_bot as admin.'
      );
    } catch (err) {
      window.Telegram?.WebApp?.showAlert?.(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setVerifying(false);
    }
  };

  const handleSaveLanguage = async () => {
    try {
      await updateChannel(channel.id, { language: languageInput.trim() });
      queryClient.invalidateQueries({ queryKey: ['channel', id] });
      setEditingLanguage(false);
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
    } catch (err) {
      window.Telegram?.WebApp?.showAlert?.(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  const openPriceForm = () => {
    const initial: Record<string, string> = {};
    for (const p of channel.prices) {
      initial[p.format] = String(p.priceInTon);
    }
    setPriceInputs(initial);
    setShowPriceForm(true);
  };

  // Use MTProto stats if available, fallback to basic
  const stats = {
    subscribers: channel.subscriberCount,
    avgViews: fullStats?.mtproto?.viewsPerPost ?? channel.avgViewCount,
    shares: fullStats?.mtproto?.sharesPerPost ?? 0,
    reactions: fullStats?.mtproto?.reactionsPerPost ?? 0,
  };

  return (
    <div>
      {/* Channel Info */}
      <Section header={channel.title}>
        {channel.username && (
          <Cell subtitle="Username">@{channel.username}</Cell>
        )}
        {channel.description && (
          <Cell subtitle="Description">{channel.description}</Cell>
        )}
      </Section>

      {/* Verified Stats */}
      <Section header="Verified Stats">
        <Cell subtitle="Subscribers">{stats.subscribers.toLocaleString()}</Cell>
        {stats.avgViews > 0 && (
          <Cell subtitle="Avg Views / Post">{Math.round(stats.avgViews).toLocaleString()}</Cell>
        )}
        {stats.shares > 0 && (
          <Cell subtitle="Avg Shares / Post">{Math.round(stats.shares).toLocaleString()}</Cell>
        )}
        {stats.reactions > 0 && (
          <Cell subtitle="Avg Reactions / Post">{Math.round(stats.reactions).toLocaleString()}</Cell>
        )}
        {stats.avgViews > 0 && stats.subscribers > 0 && (
          <Cell subtitle="Reach Rate">
            {((stats.avgViews / stats.subscribers) * 100).toFixed(1)}%
          </Cell>
        )}
        {/* Language */}
        {channel.language && !editingLanguage && (
          <Cell
            subtitle="Language"
            onClick={isOwner ? () => { setLanguageInput(channel.language || ''); setEditingLanguage(true); } : undefined}
          >
            {channel.language}{isOwner ? ' (tap to edit)' : ''}
          </Cell>
        )}
        {!channel.language && !editingLanguage && isOwner && (
          <Cell
            subtitle="Language"
            onClick={() => { setLanguageInput(''); setEditingLanguage(true); }}
          >
            Not set (tap to add)
          </Cell>
        )}
        {editingLanguage && (
          <div style={{ padding: '4px 0' }}>
            <LanguageInput
              placeholder="e.g. English, Russian"
              value={languageInput}
              onChange={setLanguageInput}
            />
            <div style={{ display: 'flex', gap: 8, padding: '8px 16px' }}>
              <Button size="m" stretched onClick={handleSaveLanguage}>Save</Button>
              <Button size="m" stretched mode="outline" onClick={() => setEditingLanguage(false)}>Cancel</Button>
            </div>
          </div>
        )}
        {!channel.language && !isOwner && (
          <Cell subtitle="Language">Not specified</Cell>
        )}
        {isOwner && (
          <Cell subtitle="Bot Admin Status">
            {channel.botIsAdmin ? 'Yes — auto-posting enabled' : 'No — add bot as admin'}
          </Cell>
        )}
      </Section>

      {/* Pricing section */}
      {channel.prices.length > 0 && (
        <Section header="Ad Pricing">
          {channel.prices.map((price) => (
            <Cell
              key={price.id}
              after={<Badge type="number">{`${price.priceInTon} TON`}</Badge>}
              subtitle={price.description || undefined}
            >
              {price.format.charAt(0).toUpperCase() + price.format.slice(1)}
            </Cell>
          ))}
        </Section>
      )}

      {/* Owner: manage channel */}
      {isOwner && (
        <Section header="Manage Channel">
          {!channel.botIsAdmin && (
            <Button
              size="l"
              stretched
              mode="outline"
              onClick={handleVerifyBot}
              loading={verifying}
            >
              Verify Bot Admin
            </Button>
          )}

          {!showPriceForm ? (
            <Button
              size="l"
              stretched
              onClick={openPriceForm}
              style={{ marginTop: 8 }}
            >
              {channel.prices.length > 0 ? 'Edit Prices' : 'Set Prices'}
            </Button>
          ) : (
            <div style={{ padding: '8px 0' }}>
              {AD_FORMATS.map((fmt) => (
                <Input
                  key={fmt.value}
                  header={`${fmt.label} (TON)`}
                  placeholder={`Price for ${fmt.label.toLowerCase()}`}
                  type="number"
                  value={priceInputs[fmt.value] || ''}
                  onChange={(e) =>
                    setPriceInputs((prev) => ({ ...prev, [fmt.value]: e.target.value }))
                  }
                />
              ))}
              <div style={{ display: 'flex', gap: 8, padding: '8px 16px' }}>
                <Button size="l" stretched onClick={handleSavePrices} loading={saving}>
                  Save Prices
                </Button>
                <Button size="l" stretched mode="outline" onClick={() => setShowPriceForm(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </Section>
      )}

      {/* Non-owner: propose deal */}
      {!isOwner && channel.prices.length > 0 && (
        <Section>
          <Button
            size="l"
            stretched
            onClick={handleProposeDeal}
          >
            Propose Deal — {channel.prices[0]?.priceInTon} TON
          </Button>
        </Section>
      )}

      {!isOwner && channel.prices.length === 0 && (
        <Section>
          <Cell>This channel hasn't set prices yet.</Cell>
        </Section>
      )}
    </div>
  );
}
