import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Section, Cell, Button, Placeholder } from '@telegram-apps/telegram-ui';
import { useTonConnectUI, useTonWallet } from '@tonconnect/ui-react';
import { QRCodeSVG } from 'qrcode.react';
import { getDeal, getEscrowInfo, getAppConfig } from '../api/client';

/** Format TON cleanly: no scientific notation, trim trailing zeros */
function formatTon(amount: number): string {
  if (amount <= 0) return '0';
  return amount.toFixed(4).replace(/\.?0+$/, '');
}

export function PaymentPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const dealId = parseInt(id!, 10);
  const [tonConnectUI] = useTonConnectUI();
  const wallet = useTonWallet();
  const [paymentInitiated, setPaymentInitiated] = useState(false);

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

  const { data: appConfig } = useQuery({
    queryKey: ['appConfig'],
    queryFn: getAppConfig,
    staleTime: Infinity,
  });

  // Auto-redirect when payment received
  if (deal?.status === 'FUNDED') {
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
    navigate(`/deals/${dealId}`);
    return null;
  }

  if (!deal || !escrow) return <Placeholder description="Loading payment..." />;

  const isTestnet = appConfig?.tonNetwork !== 'mainnet';
  const currentBalance = escrow.currentBalance || 0;
  const hasPartialPayment = currentBalance > 0 && currentBalance < deal.priceInTon;

  // Calculate remaining amount (what the user still needs to send)
  const remaining = Math.max(0, deal.priceInTon - currentBalance);
  const payAmountTon = hasPartialPayment ? remaining : deal.priceInTon;
  const payAmountNano = Math.round(payAmountTon * 1e9).toString();

  const tonTransferUrl = `ton://transfer/${escrow.address}?amount=${payAmountNano}&text=Deal%23${dealId}`;
  const tonkeeperUrl = `https://app.tonkeeper.com/transfer/${escrow.address}?amount=${payAmountNano}&text=Deal%23${dealId}${isTestnet ? '&network=testnet' : ''}`;

  const copyAddress = () => {
    if (escrow.address) {
      navigator.clipboard.writeText(escrow.address);
      window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light');
      window.Telegram?.WebApp?.showAlert?.('Address copied!');
    }
  };

  const openInWallet = () => {
    setPaymentInitiated(true);
    const tg = window.Telegram?.WebApp as Record<string, unknown> | undefined;
    if (tg && typeof tg.openLink === 'function') {
      (tg.openLink as (url: string) => void)(tonkeeperUrl);
    } else {
      window.open(tonkeeperUrl, '_blank');
    }
  };

  const handlePay = async () => {
    if (!wallet) {
      await tonConnectUI.openModal();
      return;
    }

    // Try TonConnect sendTransaction first (proper method, handles bounce correctly).
    // Fall back to deeplink if bridge is unreliable in Telegram WebView.
    try {
      setPaymentInitiated(true);
      await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 300, // 5 min
        messages: [
          {
            address: escrow.address!,
            amount: payAmountNano,
          },
        ],
      });
      return; // Transaction sent via TonConnect
    } catch (err) {
      console.warn('TonConnect sendTransaction failed, falling back to deeplink:', err);
    }

    // Fallback: open wallet via deeplink
    openInWallet();
  };

  const headerText = hasPartialPayment
    ? `Pay remaining ${formatTon(remaining)} TON`
    : `Pay ${formatTon(deal.priceInTon)} TON`;

  return (
    <div>
      {/* Payment processing banner — shown after user clicked Pay */}
      {paymentInitiated && !hasPartialPayment && (
        <div style={{
          padding: '16px',
          background: '#007AFF15',
          borderBottom: '2px solid #007AFF',
        }}>
          <div style={{
            fontSize: 17,
            fontWeight: 700,
            color: '#007AFF',
          }}>
            Confirming payment...
          </div>
          <div style={{
            fontSize: 14,
            color: 'var(--tg-theme-hint-color)',
            marginTop: 6,
            lineHeight: 1.4,
          }}>
            Transaction sent to the blockchain. Confirmation usually takes 10–30 seconds.
            This page will update automatically.
          </div>
        </div>
      )}

      <Section header={headerText}>
        {hasPartialPayment && (
          <div style={{ padding: '8px 16px', fontSize: 13, color: 'var(--tg-theme-hint-color)' }}>
            Received {formatTon(currentBalance)} of {formatTon(deal.priceInTon)} TON.
            Please send the remaining {formatTon(remaining)} TON to complete.
          </div>
        )}
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
        {wallet && (
          <Cell
            subtitle="Connected wallet"
            after={
              <Button
                size="s"
                mode="outline"
                onClick={() => tonConnectUI.disconnect()}
              >
                Disconnect
              </Button>
            }
          >
            <span style={{ fontSize: 12, fontFamily: 'monospace' }}>
              {wallet.account.address
                ? `${wallet.account.address.slice(0, 6)}...${wallet.account.address.slice(-4)}`
                : 'Connected'}
            </span>
          </Cell>
        )}
        <div style={{ padding: '0 16px 8px' }}>
          <Button
            size="l"
            stretched
            onClick={handlePay}
          >
            {paymentInitiated
              ? 'Pay Again (if previous failed)'
              : wallet
                ? `Pay ${formatTon(payAmountTon)} TON`
                : 'Connect Wallet & Pay'}
          </Button>
        </div>
        {wallet && (
          <div style={{ padding: '0 16px 8px' }}>
            <Button
              size="s"
              mode="outline"
              stretched
              onClick={() => tonConnectUI.openModal()}
            >
              Switch Wallet
            </Button>
          </div>
        )}
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
        <Cell subtitle="Required">{formatTon(deal.priceInTon)} TON</Cell>
        <Cell subtitle="Received">{formatTon(currentBalance)} TON</Cell>
        {hasPartialPayment && (
          <Cell subtitle="Remaining">
            <span style={{ color: '#FF9500', fontWeight: 600 }}>
              {formatTon(remaining)} TON
            </span>
          </Cell>
        )}
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
        <div style={{ padding: '12px 16px', fontSize: 13, color: 'var(--tg-theme-hint-color)', lineHeight: 1.5 }}>
          <b>Refund policy:</b> If the deal is cancelled, you'll be asked for your refund wallet address. If paying from an exchange, make sure you can receive TON back to a wallet you control.
        </div>
      </Section>

      {!paymentInitiated && (
        <Section>
          <div style={{ padding: '12px 16px', textAlign: 'center', fontSize: 13, color: 'var(--tg-theme-hint-color)' }}>
            Waiting for payment confirmation...
            <br />
            Page refreshes automatically.
          </div>
        </Section>
      )}

      {paymentInitiated && (
        <Section>
          <div style={{ padding: '12px 16px', textAlign: 'center', fontSize: 13, color: 'var(--tg-theme-hint-color)' }}>
            Already paid but nothing happened?
          </div>
          <div style={{ padding: '0 16px 12px' }}>
            <Button
              size="s"
              mode="outline"
              stretched
              onClick={() => setPaymentInitiated(false)}
            >
              Show payment details again
            </Button>
          </div>
        </Section>
      )}
    </div>
  );
}
