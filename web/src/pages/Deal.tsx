import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Section, Cell, Badge, Button, Placeholder } from '@telegram-apps/telegram-ui';
import {
  getDeal,
  getEscrowInfo,
  acceptDeal,
  rejectDeal,
  cancelDeal,
  approveCreative,
  requestEdit,
  getDealEvents,
} from '../api/client';
import type { User, DealEvent } from '../types';

interface Props {
  user: User | null;
}

export function DealPage({ user }: Props) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const dealId = parseInt(id!, 10);

  const { data: deal, isLoading } = useQuery({
    queryKey: ['deal', dealId],
    queryFn: () => getDeal(dealId),
    refetchInterval: 10000, // Poll every 10s
  });

  const { data: escrow } = useQuery({
    queryKey: ['escrow', dealId],
    queryFn: () => getEscrowInfo(dealId),
    enabled: !!deal && !!deal.escrowAddress,
    refetchInterval: 15000,
  });

  const { data: events } = useQuery({
    queryKey: ['events', dealId],
    queryFn: () => getDealEvents(dealId),
  });

  const mutate = (fn: () => Promise<unknown>) => ({
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deal', dealId] });
      queryClient.invalidateQueries({ queryKey: ['events', dealId] });
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
    },
    onError: (err: Error) => {
      window.Telegram?.WebApp?.showAlert?.(err.message);
    },
  });

  const acceptMutation = useMutation(mutate(() => acceptDeal(dealId)));
  const rejectMutation = useMutation(mutate(() => rejectDeal(dealId)));
  const cancelMutation = useMutation(mutate(() => cancelDeal(dealId)));
  const approveMutation = useMutation(mutate(() => approveCreative(dealId)));

  if (isLoading || !deal) return <Placeholder description="Loading deal..." />;

  const isAdvertiser = user?.id === deal.advertiserId;
  const isOwner = user?.id === deal.channelOwnerId;

  // Determine available actions
  const canAccept = deal.status === 'PENDING' && (
    (deal.initiatedBy === 'advertiser' && isOwner) ||
    (deal.initiatedBy === 'channel_owner' && isAdvertiser)
  );
  const canReject = deal.status === 'PENDING';
  const canCancel = !['COMPLETED', 'REFUNDED', 'CANCELLED', 'EXPIRED', 'POSTED', 'VERIFIED'].includes(deal.status);
  const canApproveCreative = deal.status === 'CREATIVE_REVIEW' && isAdvertiser;
  const canRequestEdit = deal.status === 'CREATIVE_REVIEW' && isAdvertiser;
  const showPayment = deal.status === 'AWAITING_PAYMENT' && isAdvertiser;

  return (
    <div>
      <Section header={`Deal #${deal.id}`}>
        <Cell subtitle="Channel">{deal.channel?.title}</Cell>
        <Cell subtitle="Status">
          <span style={{ fontWeight: 600 }}>{deal.status.replace(/_/g, ' ')}</span>
        </Cell>
        <Cell subtitle="Price">{deal.priceInTon} TON</Cell>
        <Cell subtitle="Format">{deal.format}</Cell>
        <Cell subtitle="Role">{isAdvertiser ? 'Advertiser' : 'Channel Owner'}</Cell>
        {deal.brief && <Cell subtitle="Brief">{deal.brief}</Cell>}
        {deal.campaign && <Cell subtitle="Campaign">{deal.campaign.title}</Cell>}
      </Section>

      {/* Escrow Info */}
      {escrow && (
        <Section header="Escrow">
          <Cell subtitle="Address" style={{ wordBreak: 'break-all' }}>
            {escrow.address}
          </Cell>
          <Cell subtitle="Balance">{escrow.currentBalance} / {escrow.requiredAmount} TON</Cell>
          {escrow.explorerUrl && (
            <Cell
              subtitle="Explorer"
              onClick={() => window.open(escrow.explorerUrl!, '_blank')}
            >
              View on TON Explorer
            </Cell>
          )}
          {escrow.paymentTx && (
            <Cell onClick={() => window.open(escrow.paymentTx!, '_blank')}>
              Payment TX
            </Cell>
          )}
          {escrow.payoutTx && (
            <Cell onClick={() => window.open(escrow.payoutTx!, '_blank')}>
              Payout TX
            </Cell>
          )}
          {escrow.refundTx && (
            <Cell onClick={() => window.open(escrow.refundTx!, '_blank')}>
              Refund TX
            </Cell>
          )}
        </Section>
      )}

      {/* Creative Preview */}
      {deal.creativeText && (
        <Section header="Creative">
          <div style={{ padding: '12px 16px', whiteSpace: 'pre-wrap' }}>
            {deal.creativeText}
          </div>
          {deal.creativeMediaType && (
            <Cell subtitle="Media">{deal.creativeMediaType} attached</Cell>
          )}
          {deal.editComment && (
            <Cell subtitle="Edit comment" style={{ color: '#f0ad4e' }}>
              {deal.editComment}
            </Cell>
          )}
        </Section>
      )}

      {/* Actions */}
      <Section>
        {canAccept && (
          <Button size="l" stretched onClick={() => acceptMutation.mutate()} loading={acceptMutation.isPending}>
            Accept Deal
          </Button>
        )}

        {canReject && (
          <div style={{ padding: '8px 0' }}>
            <Button size="l" stretched mode="outline" onClick={() => rejectMutation.mutate()} loading={rejectMutation.isPending}>
              Reject
            </Button>
          </div>
        )}

        {showPayment && (
          <Button size="l" stretched onClick={() => navigate(`/deals/${deal.id}/pay`)}>
            Pay {deal.priceInTon} TON
          </Button>
        )}

        {canApproveCreative && (
          <>
            <Button size="l" stretched onClick={() => approveMutation.mutate()} loading={approveMutation.isPending}>
              Approve Creative
            </Button>
            <div style={{ padding: '8px 0' }}>
              <Button
                size="l"
                stretched
                mode="outline"
                onClick={() => {
                  const comment = prompt('Enter edit comment:');
                  if (comment) {
                    requestEdit(dealId, comment).then(() => {
                      queryClient.invalidateQueries({ queryKey: ['deal', dealId] });
                    });
                  }
                }}
              >
                Request Edits
              </Button>
            </div>
          </>
        )}

        {canCancel && (
          <div style={{ padding: '8px 0' }}>
            <Button
              size="l"
              stretched
              mode="outline"
              onClick={() => {
                window.Telegram?.WebApp?.showConfirm?.('Cancel this deal?', (ok: boolean) => {
                  if (ok) cancelMutation.mutate();
                });
              }}
              loading={cancelMutation.isPending}
            >
              Cancel Deal
            </Button>
          </div>
        )}
      </Section>

      {/* Timeline */}
      {events && events.length > 0 && (
        <Section header="Timeline">
          {events.map((event: DealEvent) => (
            <Cell
              key={event.id}
              subtitle={new Date(event.createdAt).toLocaleString()}
            >
              {formatEventType(event.type, event.data)}
            </Cell>
          ))}
        </Section>
      )}
    </div>
  );
}

function formatEventType(type: string, data: Record<string, unknown> | null): string {
  switch (type) {
    case 'status_change': {
      const from = data?.from as string;
      const to = data?.to as string;
      return from ? `${from} → ${to}` : `Created (${to})`;
    }
    case 'payment':
      return `Payment: ${data?.amount} TON`;
    case 'post_edit':
      return 'Post edited';
    case 'post_delete':
      return 'Post deleted';
    default:
      return type;
  }
}
