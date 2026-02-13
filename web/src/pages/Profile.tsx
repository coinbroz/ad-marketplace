import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Section, Cell, Badge, Button, Input, Placeholder } from '@telegram-apps/telegram-ui';
import { getMe, updateWallet, addChannel } from '../api/client';
import { LanguageInput } from '../components/LanguageInput';
import type { User } from '../types';

interface Props {
  user: User | null;
}

export function ProfilePage({ user }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [walletAddress, setWalletAddress] = useState('');
  const [editingWallet, setEditingWallet] = useState(false);
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [newChannelUsername, setNewChannelUsername] = useState('');
  const [newChannelLanguage, setNewChannelLanguage] = useState('');

  const { data: me, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: getMe,
  });

  const walletMutation = useMutation({
    mutationFn: () => updateWallet(walletAddress),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me'] });
      setWalletAddress('');
      setEditingWallet(false);
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
    },
    onError: (err: Error) => {
      window.Telegram?.WebApp?.showAlert?.(err.message);
    },
  });

  const addChannelMutation = useMutation({
    mutationFn: () => addChannel(newChannelUsername.replace('@', ''), newChannelLanguage || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me'] });
      setNewChannelUsername('');
      setNewChannelLanguage('');
      setShowAddChannel(false);
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
    },
    onError: (err: Error) => {
      window.Telegram?.WebApp?.showAlert?.(err.message);
    },
  });

  if (isLoading) return <Placeholder description="Loading profile..." />;
  if (!me) return <Placeholder description="Please authenticate" />;

  return (
    <div>
      <Section header="Profile">
        <Cell subtitle="Name">{me.firstName} {me.lastName || ''}</Cell>
        {me.username && <Cell subtitle="Username">@{me.username}</Cell>}
        <Cell subtitle="Role">{me.role}</Cell>
        <Cell subtitle="Telegram ID">{me.telegramId}</Cell>
      </Section>

      <Section header="TON Wallet">
        {me.tonWalletAddress && !editingWallet ? (
          <>
            <Cell
              subtitle="Connected wallet (tap to edit)"
              onClick={() => {
                setWalletAddress(me.tonWalletAddress || '');
                setEditingWallet(true);
              }}
            >
              <span style={{ fontSize: 13, fontFamily: 'monospace' }}>
                {me.tonWalletAddress && me.tonWalletAddress.length > 20
                  ? `${me.tonWalletAddress.slice(0, 10)}...${me.tonWalletAddress.slice(-10)}`
                  : me.tonWalletAddress}
              </span>
            </Cell>
          </>
        ) : (
          <>
            <Input
              placeholder="Enter TON wallet address"
              value={walletAddress}
              onChange={(e) => setWalletAddress(e.target.value)}
            />
            {editingWallet && (
              <div style={{ padding: '4px 16px', fontSize: 12, color: 'var(--tg-theme-hint-color)' }}>
                Note: Active deals will still use the escrow address assigned at deal creation. Payouts for completed deals will go to this new address.
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, padding: '8px 16px' }}>
              <Button
                size="l"
                stretched
                onClick={() => walletMutation.mutate()}
                disabled={!walletAddress}
                loading={walletMutation.isPending}
              >
                {editingWallet ? 'Save Wallet' : 'Connect Wallet'}
              </Button>
              {editingWallet && (
                <Button
                  size="l"
                  stretched
                  mode="outline"
                  onClick={() => {
                    setEditingWallet(false);
                    setWalletAddress('');
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
          </>
        )}
      </Section>

      <Section header="My Channels">
        {me.channels?.length === 0 && !showAddChannel && (
          <Placeholder description="No channels added yet" />
        )}
        {me.channels?.map((channel) => (
          <Cell
            key={channel.id}
            subtitle={`${channel.subscriberCount.toLocaleString()} subs${channel.language ? ` · ${channel.language}` : ''}`}
            after={
              channel.botIsAdmin
                ? <Badge type="dot" />
                : <span style={{ fontSize: 11, color: '#d9534f' }}>No bot</span>
            }
            onClick={() => navigate(`/channels/${channel.id}`)}
          >
            {channel.title}
          </Cell>
        ))}

        {showAddChannel ? (
          <div style={{ padding: '4px 0' }}>
            <Input
              placeholder="@channel_username"
              value={newChannelUsername}
              onChange={(e) => setNewChannelUsername(e.target.value)}
            />
            <LanguageInput
              placeholder="Language (e.g. English, Russian)"
              value={newChannelLanguage}
              onChange={setNewChannelLanguage}
            />
            <div style={{ display: 'flex', gap: 8, padding: '8px 16px' }}>
              <Button
                size="l"
                stretched
                onClick={() => addChannelMutation.mutate()}
                disabled={!newChannelUsername}
                loading={addChannelMutation.isPending}
              >
                Add
              </Button>
              <Button
                size="l"
                stretched
                mode="outline"
                onClick={() => { setShowAddChannel(false); setNewChannelUsername(''); setNewChannelLanguage(''); }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div style={{ padding: '4px 16px 8px' }}>
            <Button
              size="s"
              mode="outline"
              onClick={() => setShowAddChannel(true)}
            >
              + Add Channel
            </Button>
          </div>
        )}
      </Section>

      <Section header="My Campaigns">
        {me.campaigns?.length === 0 && (
          <Placeholder description="No campaigns created yet" />
        )}
        {me.campaigns?.map((campaign) => (
          <Cell
            key={campaign.id}
            subtitle={`${campaign.budgetPerPost} TON per post`}
            after={<span style={{ fontSize: 12 }}>{campaign.status}</span>}
          >
            {campaign.title}
          </Cell>
        ))}
      </Section>
    </div>
  );
}
