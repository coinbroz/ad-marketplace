import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Section, Cell, Button, Placeholder } from '@telegram-apps/telegram-ui';
import { useTonConnectUI, useTonWallet } from '@tonconnect/ui-react';
import { CHAIN } from '@tonconnect/sdk';
import { QRCodeSVG } from 'qrcode.react';
import { getDeal, getEscrowInfo } from '../api/client';

export function PaymentPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const dealId = parseInt(id!, 10);
  const [tonConnectUI] = useTonConnectUI();
  const wallet = useTonWallet();
  const [sending, setSending] = useState(false);

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

  const amountNano = Math.round(deal.priceInTon * 1e9).toString();
  const tonTransferUrl = `ton://transfer/${escrow.address}?amount=${amountNano}&text=Deal%23${dealId}`;
  const tonkeeperUrl = `https://app.tonkeeper.com/transfer/${escrow.address}?amount=${amountNano}&text=Deal%23${dealId}`;

  const copyAddress = () => {
    if (escrow.address) {
      navigator.clipboard.writeText(escrow.address);
      window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light');
      window.Telegram?.WebApp?.showAlert?.('Address copied!');
    }
  };

  const handleTonConnect = async () => {
    if (!wallet) {
      await tonConnectUI.openModal();
      return;
    }

    setSending(true);
    try {
      await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 600,
        network: CHAIN.TESTNET,
        messages: [
          {
            address: escrow.address!,
            amount: amountNano,
          },
        ],
      });
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
    } catch (err) {
      if ((err as Error).message?.includes('Interrupted') || (err as Error).message?.includes('Cancelled')) {
        // User cancelled — do nothing
      } else {
        window.Telegram?.WebApp?.showAlert?.(`Payment error: ${(err as Error).message}`);
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <Section header={`Pay ${deal.priceInTon} TON`}>
        <div style={{ textAlign: 'center', padding: '20px' }}>
          <div style={{ marginBottom: 16, fontSize: 14, color: 'var(--tg-theme-hint-color)' }}>
            Scan QR or pay with connected wallet
          </div>

          <div style={{
            display: 'inline-block',
            padding: 16,
            background: '#fff',
            borderRadius: 12,
          }}>
            <QRCodeSVG
              value={tonTransferUrl}
              size={200}
              level="M"
            />
          </div>
        </div>
      </Section>

      <Section header="Pay with Wallet">
        <div style={{ padding: '0 16px 8px' }}>
          <Button
            size="l"
            stretched
            onClick={handleTonConnect}
            loading={sending}
          >
            {wallet ? `Pay ${deal.priceInTon} TON` : 'Connect Wallet & Pay'}
          </Button>
        </div>
        <div style={{ padding: '0 16px 8px' }}>
          <Button
            size="l"
            stretched
            mode="outline"
            onClick={() => window.open(tonkeeperUrl, '_blank')}
          >
            Open in Tonkeeper
          </Button>
        </div>
      </Section>

      <Section header="Escrow Address">
        <Cell
          onClick={copyAddress}
          subtitle="Tap to copy full address"
        >
          <span style={{ fontSize: 13, fontFamily: 'monospace' }}>
            {escrow.address && escrow.address.length > 20
              ? `${escrow.address.slice(0, 10)}...${escrow.address.slice(-10)}`
              : escrow.address}
          </span>
        </Cell>
        <Cell subtitle="Amount">{deal.priceInTon} TON</Cell>
        <Cell subtitle="Current balance">{escrow.currentBalance} TON</Cell>
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
