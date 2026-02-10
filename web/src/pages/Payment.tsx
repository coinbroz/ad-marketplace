import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Section, Cell, Button, Placeholder } from '@telegram-apps/telegram-ui';
import { QRCodeSVG } from 'qrcode.react';
import { getDeal, getEscrowInfo } from '../api/client';

export function PaymentPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const dealId = parseInt(id!, 10);

  const { data: deal } = useQuery({
    queryKey: ['deal', dealId],
    queryFn: () => getDeal(dealId),
    refetchInterval: 5000,
  });

  const { data: escrow } = useQuery({
    queryKey: ['escrow', dealId],
    queryFn: () => getEscrowInfo(dealId),
    enabled: !!deal?.escrowAddress,
    refetchInterval: 5000,
  });

  // Auto-redirect when payment received
  if (deal?.status === 'FUNDED') {
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
    navigate(`/deals/${dealId}`);
    return null;
  }

  if (!deal || !escrow) return <Placeholder description="Loading payment..." />;

  const tonkeeperUrl = `ton://transfer/${escrow.address}?amount=${Math.round(deal.priceInTon * 1e9)}&text=Deal%23${dealId}`;
  const tonSpaceUrl = `https://app.tonkeeper.com/transfer/${escrow.address}?amount=${Math.round(deal.priceInTon * 1e9)}`;

  const copyAddress = () => {
    if (escrow.address) {
      navigator.clipboard.writeText(escrow.address);
      window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light');
      window.Telegram?.WebApp?.showAlert?.('Address copied!');
    }
  };

  return (
    <div>
      <Section header={`Pay ${deal.priceInTon} TON`}>
        <div style={{ textAlign: 'center', padding: '20px' }}>
          <div style={{ marginBottom: 16, fontSize: 14, color: 'var(--tg-theme-hint-color)' }}>
            Scan QR or use the address below
          </div>

          <div style={{
            display: 'inline-block',
            padding: 16,
            background: '#fff',
            borderRadius: 12,
          }}>
            <QRCodeSVG
              value={tonkeeperUrl}
              size={200}
              level="M"
            />
          </div>
        </div>
      </Section>

      <Section header="Escrow Address">
        <Cell
          onClick={copyAddress}
          subtitle="Tap to copy"
        >
          <span style={{ fontSize: 12, wordBreak: 'break-all', fontFamily: 'monospace' }}>
            {escrow.address}
          </span>
        </Cell>
        <Cell subtitle="Amount">{deal.priceInTon} TON</Cell>
        <Cell subtitle="Current balance">{escrow.currentBalance} TON</Cell>
      </Section>

      <Section header="Quick Pay">
        <Button
          size="l"
          stretched
          onClick={() => window.open(tonkeeperUrl, '_blank')}
        >
          Open in Tonkeeper
        </Button>
        <div style={{ padding: '8px 0' }}>
          <Button
            size="l"
            stretched
            mode="outline"
            onClick={() => window.open(tonSpaceUrl, '_blank')}
          >
            Open in TON Space
          </Button>
        </div>
      </Section>

      {escrow.explorerUrl && (
        <Section>
          <Cell
            onClick={() => window.open(escrow.explorerUrl!, '_blank')}
            subtitle="Track on blockchain"
          >
            View in Explorer
          </Cell>
        </Section>
      )}

      <Section>
        <div style={{ padding: '12px 16px', textAlign: 'center', fontSize: 13, color: 'var(--tg-theme-hint-color)' }}>
          Waiting for payment confirmation...
          <br />
          Checking every 30 seconds.
        </div>
      </Section>
    </div>
  );
}
