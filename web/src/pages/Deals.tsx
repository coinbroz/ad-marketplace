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
  PENDING: '#f0ad4e',
  ACCEPTED: '#5bc0de',
  AWAITING_PAYMENT: '#f0ad4e',
  FUNDED: '#5cb85c',
  CREATIVE_DRAFT: '#5bc0de',
  CREATIVE_REVIEW: '#f0ad4e',
  CREATIVE_APPROVED: '#5cb85c',
  SCHEDULED: '#5bc0de',
  POSTED: '#5cb85c',
  VERIFIED: '#5cb85c',
  COMPLETED: '#5cb85c',
  REFUNDED: '#999',
  CANCELLED: '#d9534f',
  DISPUTED: '#d9534f',
  EXPIRED: '#999',
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
