import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Section, Cell, Badge, Button, Placeholder } from '@telegram-apps/telegram-ui';
import { getChannel, createDeal } from '../api/client';
import type { User } from '../types';

interface Props {
  user: User | null;
}

export function ChannelPage({ user }: Props) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: channel, isLoading, error } = useQuery({
    queryKey: ['channel', id],
    queryFn: () => getChannel(parseInt(id!, 10)),
    enabled: !!id,
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
              tg.showAlert?.(err instanceof Error ? err.message : 'Failed to create deal');
            }
          }
        },
      );
    }
  };

  return (
    <div>
      <Section header={channel.title}>
        {channel.username && (
          <Cell subtitle="Username">@{channel.username}</Cell>
        )}
        <Cell subtitle="Subscribers">{channel.subscriberCount.toLocaleString()}</Cell>
        {channel.avgViewCount > 0 && (
          <Cell subtitle="Avg Views">{channel.avgViewCount.toLocaleString()}</Cell>
        )}
        {channel.language && (
          <Cell subtitle="Language">{channel.language}</Cell>
        )}
        {channel.description && (
          <Cell subtitle="Description">{channel.description}</Cell>
        )}
      </Section>

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
    </div>
  );
}
