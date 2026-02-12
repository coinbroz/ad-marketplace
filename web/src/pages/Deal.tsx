import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Section, Cell, Button, Placeholder } from '@telegram-apps/telegram-ui';
import { useState } from 'react';
import { Input } from '@telegram-apps/telegram-ui';
import {
  getDeal,
  getEscrowInfo,
  acceptDeal,
  rejectDeal,
  cancelDeal,
  approveCreative,
  requestEdit,
  setRefundAddress,
  getDealEvents,
} from '../api/client';
import type { User, DealEvent, EscrowInfo } from '../types';

interface Props {
  user: User | null;
}

const statusColors: Record<string, string> = {
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

const statusLabels: Record<string, string> = {
  PENDING: 'Pending Approval',
  ACCEPTED: 'Accepted',
  AWAITING_PAYMENT: 'Awaiting Payment',
  FUNDED: 'Payment Received',
  CREATIVE_DRAFT: 'Creative in Progress',
  CREATIVE_REVIEW: 'Creative Under Review',
  CREATIVE_APPROVED: 'Creative Approved',
  SCHEDULED: 'Scheduled',
  POSTED: 'Posted — Verifying',
  VERIFIED: 'Verified',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
  REFUNDED: 'Refunded',
  DISPUTED: 'Disputed',
};

function formatTimeLeft(expiresAt: string | null): string | null {
  if (!expiresAt) return null;
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 'Expiring soon...';
  const hours = Math.floor(diff / 3600_000);
  const minutes = Math.floor((diff % 3600_000) / 60_000);
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${minutes}m left`;
}

export function DealPage({ user }: Props) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const dealId = parseInt(id!, 10);

  const { data: deal, isLoading } = useQuery({
    queryKey: ['deal', dealId],
    queryFn: () => getDeal(dealId),
    refetchInterval: 10000,
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
  const canCancel = !['COMPLETED', 'REFUNDED', 'CANCELLED', 'EXPIRED', 'POSTED', 'VERIFIED'].includes(deal.status);
  const canApproveCreative = deal.status === 'CREATIVE_REVIEW' && isAdvertiser;
  const showPayment = deal.status === 'AWAITING_PAYMENT' && isAdvertiser;

  const timeLeft = formatTimeLeft(deal.expiresAt);

  return (
    <div>
      {/* Status Banner */}
      <div style={{
        padding: '16px',
        background: `${statusColors[deal.status] || '#8E8E93'}15`,
        borderBottom: `2px solid ${statusColors[deal.status] || '#8E8E93'}`,
      }}>
        <div style={{ fontSize: 13, color: 'var(--tg-theme-hint-color, #999)' }}>
          Deal #{deal.id} · {deal.channel?.title}
        </div>
        <div style={{
          fontSize: 20,
          fontWeight: 700,
          color: statusColors[deal.status] || '#8E8E93',
          marginTop: 4,
        }}>
          {statusLabels[deal.status] || deal.status}
        </div>
        {timeLeft && (
          <div style={{ fontSize: 13, color: 'var(--tg-theme-hint-color, #999)', marginTop: 4 }}>
            Auto-cancel in {timeLeft}
          </div>
        )}
      </div>

      {/* Primary Actions — shown right after status for visibility */}
      {(canAccept || showPayment || canApproveCreative) && (
        <div style={{ padding: '12px 16px' }}>
          {canAccept && (
            <>
              <Button size="l" stretched onClick={() => acceptMutation.mutate()} loading={acceptMutation.isPending}>
                Accept Deal
              </Button>
              <div style={{ height: 8 }} />
              <Button size="l" stretched mode="outline" onClick={() => rejectMutation.mutate()} loading={rejectMutation.isPending}>
                Reject
              </Button>
            </>
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
              <div style={{ height: 8 }} />
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
            </>
          )}
        </div>
      )}

      {/* Waiting hints for the party who can't act right now */}
      {deal.status === 'AWAITING_PAYMENT' && isOwner && (
        <div style={{
          padding: '12px 16px',
          background: 'var(--tg-theme-secondary-bg-color, #f0f0f0)',
          borderRadius: 8,
          margin: '0 16px 12px',
          fontSize: 14,
          color: 'var(--tg-theme-hint-color, #999)',
        }}>
          Waiting for the advertiser to pay. The deal will auto-cancel if not paid in time. You can also cancel it manually below.
        </div>
      )}

      {deal.status === 'PENDING' && !canAccept && (
        <div style={{
          padding: '12px 16px',
          background: 'var(--tg-theme-secondary-bg-color, #f0f0f0)',
          borderRadius: 8,
          margin: '0 16px 12px',
          fontSize: 14,
          color: 'var(--tg-theme-hint-color, #999)',
        }}>
          Waiting for the other party to accept. The deal will expire automatically if not accepted in time.
        </div>
      )}

      {deal.status === 'FUNDED' && isAdvertiser && !deal.brief && (
        <div style={{
          padding: '12px 16px',
          background: 'var(--tg-theme-secondary-bg-color, #f0f0f0)',
          borderRadius: 8,
          margin: '0 16px 12px',
          fontSize: 14,
          color: 'var(--tg-theme-hint-color, #999)',
        }}>
          Payment confirmed! Now send your ad brief and materials: use /submitbrief in the bot.
        </div>
      )}

      {deal.status === 'FUNDED' && isAdvertiser && deal.brief && (
        <div style={{
          padding: '12px 16px',
          background: 'var(--tg-theme-secondary-bg-color, #f0f0f0)',
          borderRadius: 8,
          margin: '0 16px 12px',
          fontSize: 14,
          color: 'var(--tg-theme-hint-color, #999)',
        }}>
          Brief sent! Waiting for the channel owner to create the ad post.
        </div>
      )}

      {deal.status === 'FUNDED' && isOwner && !deal.brief && (
        <div style={{
          padding: '12px 16px',
          background: 'var(--tg-theme-secondary-bg-color, #f0f0f0)',
          borderRadius: 8,
          margin: '0 16px 12px',
          fontSize: 14,
          color: 'var(--tg-theme-hint-color, #999)',
        }}>
          Payment received! Waiting for the advertiser to send their brief.
        </div>
      )}

      {deal.status === 'FUNDED' && isOwner && deal.brief && (
        <div style={{
          padding: '12px 16px',
          background: 'var(--tg-theme-secondary-bg-color, #f0f0f0)',
          borderRadius: 8,
          margin: '0 16px 12px',
          fontSize: 14,
          color: 'var(--tg-theme-hint-color, #999)',
        }}>
          Brief received! Create the ad post: send /submitcreative to the bot.
        </div>
      )}

      {deal.status === 'CREATIVE_REVIEW' && isOwner && (
        <div style={{
          padding: '12px 16px',
          background: 'var(--tg-theme-secondary-bg-color, #f0f0f0)',
          borderRadius: 8,
          margin: '0 16px 12px',
          fontSize: 14,
          color: 'var(--tg-theme-hint-color, #999)',
        }}>
          Your creative is under review by the advertiser.
        </div>
      )}

      {deal.status === 'CREATIVE_APPROVED' && isOwner && (
        <div style={{
          padding: '12px 16px',
          background: 'var(--tg-theme-secondary-bg-color, #f0f0f0)',
          borderRadius: 8,
          margin: '0 16px 12px',
          fontSize: 14,
          color: 'var(--tg-theme-hint-color, #999)',
        }}>
          Creative approved! Use the bot to schedule posting: send /schedulepost to @channelescrow_bot
        </div>
      )}

      {deal.status === 'POSTED' && (
        <div style={{
          padding: '12px 16px',
          background: '#34C75915',
          borderRadius: 8,
          margin: '0 16px 12px',
          fontSize: 14,
          color: 'var(--tg-theme-text-color, #333)',
        }}>
          Post published! Verifying it stays in the channel for 24 hours before releasing funds.
        </div>
      )}

      {/* Deal Details */}
      <Section header="Details">
        <Cell subtitle="Price">{deal.priceInTon} TON</Cell>
        <Cell subtitle="Format">{deal.format}</Cell>
        <Cell subtitle="Your role">{isAdvertiser ? 'Advertiser' : 'Channel Owner'}</Cell>
        {deal.brief && <Cell subtitle="Brief">{deal.brief}</Cell>}
        {deal.campaign && <Cell subtitle="Campaign">{deal.campaign.title}</Cell>}
      </Section>

      {/* Escrow Info */}
      {escrow && (
        <Section header="Escrow">
          <Cell
            subtitle="Tap to copy address"
            onClick={() => {
              if (escrow.address) {
                navigator.clipboard.writeText(escrow.address);
                window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light');
                window.Telegram?.WebApp?.showAlert?.('Address copied!');
              }
            }}
          >
            <span style={{ fontFamily: 'monospace', fontSize: 13 }}>
              {escrow.address && escrow.address.length > 20
                ? `${escrow.address.slice(0, 10)}...${escrow.address.slice(-10)}`
                : escrow.address}
            </span>
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
            <Cell subtitle="View on Explorer" onClick={() => window.open(escrow.paymentTx!, '_blank')}>
              Payment Transaction
            </Cell>
          )}
          {escrow.payoutTx && (
            <Cell subtitle="View on Explorer" onClick={() => window.open(escrow.payoutTx!, '_blank')}>
              Payout Transaction
            </Cell>
          )}
          {escrow.payoutPending && !escrow.payoutTx && (
            <Cell subtitle="Processing on blockchain">
              Payout Transaction
            </Cell>
          )}
          {escrow.refundTx && (
            <Cell subtitle="View on Explorer" onClick={() => window.open(escrow.refundTx!, '_blank')}>
              Refund Transaction
            </Cell>
          )}
          {escrow.refundPending && !escrow.refundTx && (
            <Cell subtitle="Processing on blockchain">
              Refund Transaction
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
            <Cell subtitle="Edit requested" style={{ color: '#f0ad4e' }}>
              {deal.editComment}
            </Cell>
          )}
        </Section>
      )}

      {/* Cancel — always visible when possible, separated from primary actions */}
      {canCancel && !canAccept && (
        <div style={{ padding: '8px 16px' }}>
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

      {/* Refund address — shown to advertiser only when escrow has funds or refund in progress */}
      {(deal.status === 'REFUNDED' || (deal.status === 'CANCELLED' && deal.escrowAddress && escrow &&
        (escrow.currentBalance > 0 || escrow.refundTx || escrow.refundPending)
      )) && isAdvertiser && (
        <RefundAddressSection dealId={deal.id} deal={deal} escrow={escrow || null} queryClient={queryClient} />
      )}

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

function RefundAddressSection({ dealId, deal, escrow, queryClient }: {
  dealId: number;
  deal: { refundAddress: string | null; refundMemo: string | null; priceInTon: number };
  escrow: EscrowInfo | null;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const [address, setAddress] = useState(deal.refundAddress || '');
  const [memo, setMemo] = useState(deal.refundMemo || '');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  const isPending = escrow?.refundPending && !escrow?.refundTx;
  const isCompleted = !!escrow?.refundTx;

  const handleSave = async () => {
    if (!address.trim()) {
      window.Telegram?.WebApp?.showAlert?.('Please enter your wallet address');
      return;
    }
    setSaving(true);
    try {
      await setRefundAddress(dealId, address.trim(), memo.trim() || undefined);
      queryClient.invalidateQueries({ queryKey: ['deal', dealId] });
      queryClient.invalidateQueries({ queryKey: ['escrow', dealId] });
      setEditing(false);
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
    } catch (err) {
      window.Telegram?.WebApp?.showAlert?.(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  // Retry: re-sends the same address to trigger executePendingRefund on backend
  const handleRetry = async () => {
    if (!deal.refundAddress) return;
    setSaving(true);
    try {
      await setRefundAddress(dealId, deal.refundAddress, deal.refundMemo || undefined);
      queryClient.invalidateQueries({ queryKey: ['deal', dealId] });
      queryClient.invalidateQueries({ queryKey: ['escrow', dealId] });
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
      window.Telegram?.WebApp?.showAlert?.('Refund retry initiated. Please wait 30-60 seconds for the blockchain transaction.');
    } catch (err) {
      window.Telegram?.WebApp?.showAlert?.(err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setSaving(false);
    }
  };

  // Address already saved — show status + retry/edit buttons
  if (deal.refundAddress && !editing) {
    return (
      <Section header="Refund">
        <Cell subtitle="Refund address">{deal.refundAddress}</Cell>
        {deal.refundMemo && <Cell subtitle="Memo">{deal.refundMemo}</Cell>}
        <Cell subtitle="Amount">{deal.priceInTon} TON</Cell>

        {isCompleted && (
          <div style={{ padding: '8px 16px', fontSize: 13, color: '#34C759' }}>
            Refund sent successfully.
            {escrow?.refundTx && (
              <> <a href={escrow.refundTx} target="_blank" rel="noreferrer" style={{ color: '#007AFF' }}>View on Explorer</a></>
            )}
          </div>
        )}

        {isPending && (
          <>
            <div style={{ padding: '8px 16px', fontSize: 13, color: '#FF9500' }}>
              Refund pending — TON transfer has not been confirmed on the blockchain yet.
            </div>
            <div style={{ padding: '8px 16px', display: 'flex', gap: 8 }}>
              <Button size="l" stretched onClick={handleRetry} loading={saving}>
                Retry Refund
              </Button>
              <Button size="l" mode="outline" onClick={() => setEditing(true)}>
                Edit
              </Button>
            </div>
          </>
        )}

        {!isCompleted && !isPending && (
          <div style={{ padding: '8px 16px', fontSize: 13, color: 'var(--tg-theme-hint-color, #999)' }}>
            Refund will be processed to this address.
          </div>
        )}
      </Section>
    );
  }

  // Address input form (new or editing)
  return (
    <Section header={editing ? 'Refund — Update Address' : 'Refund — Enter Your Wallet'}>
      <div style={{
        padding: '12px 16px',
        fontSize: 13,
        color: 'var(--tg-theme-hint-color, #999)',
        lineHeight: 1.4,
      }}>
        {editing
          ? 'Update your refund wallet address. Saving will also retry the TON transfer.'
          : `The deal has been cancelled. Please enter your TON wallet address for the refund of ${deal.priceInTon} TON.\n\nIf you sent from an exchange, enter your exchange deposit address and memo. If you sent from a personal wallet (Tonkeeper, TonHub, etc.), just enter the wallet address.`
        }
      </div>
      <Input
        header="TON Wallet Address"
        placeholder="Your TON wallet address"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
      />
      <Input
        header="Memo (optional)"
        placeholder="Memo for exchange deposits"
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
      />
      <div style={{ padding: '8px 16px', display: 'flex', gap: 8 }}>
        <Button size="l" stretched onClick={handleSave} loading={saving}>
          {editing ? 'Save & Retry Refund' : 'Save Refund Address'}
        </Button>
        {editing && (
          <Button size="l" mode="outline" onClick={() => { setEditing(false); setAddress(deal.refundAddress || ''); setMemo(deal.refundMemo || ''); }}>
            Cancel
          </Button>
        )}
      </div>
    </Section>
  );
}

function formatEventType(type: string, data: Record<string, unknown> | null): string {
  switch (type) {
    case 'status_change': {
      const from = data?.from as string;
      const to = data?.to as string;
      const label = to ? (statusLabels[to] || to) : type;
      return from ? `${statusLabels[from] || from} → ${label}` : `Created`;
    }
    case 'payment':
      return `Payment: ${data?.amount} TON`;
    case 'post_edit':
      return 'Post was edited';
    case 'post_delete':
      return 'Post was deleted!';
    case 'refund_address':
      return `Refund address set: ${(data?.address as string)?.slice(0, 12)}...`;
    default:
      return type;
  }
}
