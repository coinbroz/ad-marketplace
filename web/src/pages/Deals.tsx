import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Section, Cell, Badge, SegmentedControl, Placeholder } from '@telegram-apps/telegram-ui';
import { getDeals } from '../api/client';
import type { User, Deal, DealStatus } from '../types';

interface Props {
  user: User | null;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: '#FF9500',
  ACCEPTED: '#007AFF',
  AWAITING_PAYMENT: '#FF9500',
  FUNDED: '#34C759',
  CREATIVE_DRAFT: '#007AFF',
  CREATIVE_REVIEW: '#FF9500',
  CREATIVE_APPROVED: '#34C759',
  SCHEDULED: '#007AFF',
  POSTED: '#34C759',
  VERIFIED: '#34C759',
  COMPLETED: '#34C759',
  CANCELLED: '#FF3B30',
  EXPIRED: '#8E8E93',
  REFUNDED: '#8E8E93',
  DISPUTED: '#FF3B30',
};

const ACTIVE_STATUSES = 'PENDING,ACCEPTED,AWAITING_PAYMENT,FUNDED,CREATIVE_DRAFT,CREATIVE_REVIEW,CREATIVE_APPROVED,SCHEDULED,POSTED,VERIFIED,DISPUTED';

export function DealsPage({ user }: Props) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'active' | 'completed'>('active');

  const { data: deals, isLoading } = useQuery({
    queryKey: ['deals', tab],
    queryFn: () => getDeals(tab === 'active' ? ACTIVE_STATUSES : 'COMPLETED,REFUNDED,CANCELLED,EXPIRED'),
  });

  return (
    <div>
      <Section header="My Deals">
        <SegmentedControl>
          <SegmentedControl.Item selected={tab === 'active'} onClick={() => setTab('active')}>
            Active
          </SegmentedControl.Item>
          <SegmentedControl.Item selected={tab === 'completed'} onClick={() => setTab('completed')}>
            Completed
          </SegmentedControl.Item>
        </SegmentedControl>
      </Section>

      <Section>
        {isLoading && <Cell>Loading deals...</Cell>}
        {deals?.length === 0 && (
          <Placeholder description={tab === 'active' ? 'No active deals' : 'No completed deals'} />
        )}
        {deals?.map((deal: Deal) => {
          const role = deal.advertiserId === user?.id ? 'Advertiser' : 'Channel Owner';
          return (
            <Cell
              key={deal.id}
              subtitle={`${role} · ${deal.format} · ${deal.priceInTon} TON`}
              after={
                <span style={{ color: STATUS_COLORS[deal.status] || '#999', fontSize: 12, fontWeight: 600 }}>
                  {deal.status.replace(/_/g, ' ')}
                </span>
              }
              onClick={() => navigate(`/deals/${deal.id}`)}
            >
              {deal.channel?.title || `Deal #${deal.id}`}
            </Cell>
          );
        })}
      </Section>
    </div>
  );
}
