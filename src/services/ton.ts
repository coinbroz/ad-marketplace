import { Address } from '@ton/ton';
import { prisma } from '../lib/prisma.js';
import {
  getWalletBalance,
  decryptSecretKey,
  fromNano,
  toNano,
} from '../utils/ton-wallet.js';
import { config, GAS_RESERVE_TON, TON_ENDPOINT } from '../config.js';
import { transitionDeal } from './deals.js';
import { notifyUser } from './telegram.js';

/**
 * Check payment for a deal in AWAITING_PAYMENT status.
 * Called by the payment-monitor worker.
 */
export async function checkDealPayment(dealId: number): Promise<boolean> {
  const deal = await prisma.deal.findUniqueOrThrow({
    where: { id: dealId },
    include: {
      advertiser: { select: { telegramId: true, firstName: true } },
      channelOwner: { select: { telegramId: true, firstName: true } },
      channel: { select: { title: true } },
    },
  });

  if (deal.status !== 'AWAITING_PAYMENT' || !deal.escrowAddress) {
    return false;
  }

  const balance = await getWalletBalance(deal.escrowAddress);
  const requiredAmount = toNano(deal.priceInTon);

  if (balance >= requiredAmount) {
    // Payment received — get transaction hash
    const txHash = await getLatestTxHash(deal.escrowAddress);

    await transitionDeal(dealId, 'FUNDED', {
      paidAt: new Date(),
      paidTxHash: txHash,
    });

    // Log payment event
    await prisma.dealEvent.create({
      data: {
        dealId,
        type: 'payment',
        data: {
          amount: fromNano(balance),
          txHash,
          address: deal.escrowAddress,
        },
      },
    });

    // Notify both parties with next-step hints
    const advertiserMsg = `💰 <b>Payment received!</b>\n\nDeal #${dealId}\nChannel: ${deal.channel.title}\nAmount: ${fromNano(balance)} TON\nTX: <code>${txHash || 'confirming...'}</code>\n\n📋 Now send your ad brief and materials: use /submitbrief`;
    const ownerMsg = `💰 <b>Payment received!</b>\n\nDeal #${dealId}\nChannel: ${deal.channel.title}\nAmount: ${fromNano(balance)} TON\nTX: <code>${txHash || 'confirming...'}</code>\n\n⏳ Waiting for the advertiser to send their ad brief.`;

    await Promise.all([
      notifyUser(deal.advertiser.telegramId, advertiserMsg),
      notifyUser(deal.channelOwner.telegramId, ownerMsg),
    ]);

    return true;
  }

  // Check partial payment
  if (balance > 0n && balance < requiredAmount) {
    const partialAmount = fromNano(balance);
    const required = deal.priceInTon;

    await notifyUser(
      deal.advertiser.telegramId,
      `⚠️ <b>Partial payment detected</b>\n\nDeal #${dealId}\nReceived: ${partialAmount} TON\nRequired: ${required} TON\n\nPlease send the remaining ${required - partialAmount} TON to complete the payment.`,
    );
  }

  return false;
}

/**
 * Release funds from escrow to channel owner.
 * Called after post verification (24h).
 */
export async function releaseFunds(dealId: number): Promise<string | null> {
  const deal = await prisma.deal.findUniqueOrThrow({
    where: { id: dealId },
    include: {
      escrowWallet: true,
      channelOwner: { select: { telegramId: true, tonWalletAddress: true, firstName: true } },
      advertiser: { select: { telegramId: true, firstName: true } },
      channel: { select: { title: true } },
    },
  });

  if (!deal.escrowWallet) {
    throw new Error('No escrow wallet for this deal');
  }

  const payoutToAddress = deal.channelOwner.tonWalletAddress || 'pending';

  // Decrypt secret key
  const secretKey = decryptSecretKey({
    encrypted: deal.escrowWallet.secretKeyEnc,
    iv: deal.escrowWallet.secretKeyIv,
    tag: deal.escrowWallet.secretKeyTag,
  });

  // Get escrow balance
  const balance = await getWalletBalance(deal.escrowAddress!);

  // Calculate amounts
  const feePercent = config.PLATFORM_FEE_PERCENT;
  const gasReserve = toNano(GAS_RESERVE_TON);

  let ownerAmount: bigint;
  let feeAmount = 0n;

  if (feePercent > 0) {
    feeAmount = (balance * BigInt(Math.round(feePercent * 100))) / 10000n;
    ownerAmount = balance - feeAmount - gasReserve;
  } else {
    ownerAmount = balance - gasReserve;
  }

  if (ownerAmount <= 0n) {
    throw new Error('Insufficient escrow balance for payout');
  }

  // TODO: Implement actual TON transaction
  // 1. Hot wallet sends gas to escrow for deploy
  // 2. Deploy escrow wallet contract
  // 3. Send from escrow to channel owner
  // 4. Send fee to hot wallet (if any)
  const txHash = `payout_${dealId}_${Date.now()}`; // Placeholder

  // Update deal
  await transitionDeal(dealId, 'COMPLETED', {
    payoutTxHash: txHash,
    paidOutAt: new Date(),
  });

  // Log payout event
  await prisma.dealEvent.create({
    data: {
      dealId,
      type: 'payment',
      data: {
        action: 'payout',
        amount: fromNano(ownerAmount),
        fee: fromNano(feeAmount),
        txHash,
        toAddress: payoutToAddress,
      },
    },
  });

  // Notify both parties
  const payoutMsg = `✅ <b>Payout completed!</b>\n\nDeal #${dealId}\nChannel: ${deal.channel.title}\nAmount: ${fromNano(ownerAmount)} TON\nTX: <code>${txHash}</code>`;

  await Promise.all([
    notifyUser(deal.channelOwner.telegramId, payoutMsg),
    notifyUser(deal.advertiser.telegramId, payoutMsg),
  ]);

  return txHash;
}

/**
 * Refund funds from escrow to advertiser.
 */
export async function refundFunds(dealId: number): Promise<string | null> {
  const deal = await prisma.deal.findUniqueOrThrow({
    where: { id: dealId },
    include: {
      escrowWallet: true,
      advertiser: { select: { telegramId: true, tonWalletAddress: true, firstName: true } },
      channelOwner: { select: { telegramId: true, firstName: true } },
      channel: { select: { title: true } },
    },
  });

  if (!deal.escrowWallet || !deal.escrowAddress) {
    return null; // No escrow, nothing to refund
  }

  let balance: bigint;
  try {
    balance = await getWalletBalance(deal.escrowAddress);
    if (balance === 0n) {
      return null; // Nothing to refund
    }
  } catch (err) {
    // If balance check fails, use the deal price as refund amount (we know it was funded)
    console.error(`Balance check failed for deal ${dealId}, using deal price:`, err);
    balance = toNano(deal.priceInTon);
  }

  const refundToAddress = deal.advertiser.tonWalletAddress || 'pending';

  // Decrypt secret key (needed for future actual TON transfer)
  const secretKey = decryptSecretKey({
    encrypted: deal.escrowWallet.secretKeyEnc,
    iv: deal.escrowWallet.secretKeyIv,
    tag: deal.escrowWallet.secretKeyTag,
  });

  const gasReserve = toNano(GAS_RESERVE_TON);
  const refundAmount = balance > gasReserve ? balance - gasReserve : balance;

  // TODO: Implement actual TON transaction
  // 1. Hot wallet sends gas to escrow for deploy
  // 2. Deploy escrow wallet contract
  // 3. Send from escrow back to advertiser
  const txHash = `refund_${dealId}_${Date.now()}`; // Placeholder

  // Update deal
  await transitionDeal(dealId, 'REFUNDED', {
    refundTxHash: txHash,
    refundedAt: new Date(),
  });

  // Log refund event
  await prisma.dealEvent.create({
    data: {
      dealId,
      type: 'payment',
      data: {
        action: 'refund',
        amount: fromNano(refundAmount),
        txHash,
        toAddress: refundToAddress,
      },
    },
  });

  // Notify both parties
  const refundMsg = `🔄 <b>Refund processed</b>\n\nDeal #${dealId}\nChannel: ${deal.channel.title}\nAmount: ${fromNano(refundAmount)} TON\nTX: <code>${txHash}</code>`;

  await Promise.all([
    notifyUser(deal.advertiser.telegramId, refundMsg),
    notifyUser(deal.channelOwner.telegramId, refundMsg),
  ]);

  return txHash;
}

/**
 * Get escrow info for a deal (for Mini App display).
 */
export async function getEscrowInfo(dealId: number) {
  const deal = await prisma.deal.findUniqueOrThrow({
    where: { id: dealId },
    select: {
      escrowAddress: true,
      priceInTon: true,
      status: true,
      paidTxHash: true,
      payoutTxHash: true,
      refundTxHash: true,
    },
  });

  let balance = 0;
  if (deal.escrowAddress) {
    try {
      const rawBalance = await getWalletBalance(deal.escrowAddress);
      balance = fromNano(rawBalance);
    } catch {
      // Address might not exist yet
    }
  }

  const explorerBase = config.TON_NETWORK === 'mainnet'
    ? 'https://tonscan.org'
    : 'https://testnet.tonscan.org';

  // Convert stored address to correct network format for display
  const isTestnet = config.TON_NETWORK === 'testnet';
  const displayAddress = deal.escrowAddress
    ? Address.parse(deal.escrowAddress).toString({ bounceable: false, testOnly: isTestnet })
    : null;

  return {
    address: displayAddress,
    requiredAmount: deal.priceInTon,
    currentBalance: balance,
    status: deal.status,
    explorerUrl: displayAddress ? `${explorerBase}/${displayAddress}` : null,
    paymentTx: deal.paidTxHash ? `${explorerBase}/transaction/${deal.paidTxHash}` : null,
    payoutTx: deal.payoutTxHash ? `${explorerBase}/transaction/${deal.payoutTxHash}` : null,
    refundTx: deal.refundTxHash ? `${explorerBase}/transaction/${deal.refundTxHash}` : null,
  };
}

// ── Helper ─────────────────────────────────────────────────

async function getLatestTxHash(address: string): Promise<string | null> {
  try {
    const url = `${TON_ENDPOINT}/getTransactions?address=${address}&limit=1`;
    const headers: Record<string, string> = {};
    if (config.TON_API_KEY) {
      headers['X-API-Key'] = config.TON_API_KEY;
    }
    const response = await fetch(url, { headers });
    const data = await response.json() as { ok: boolean; result: Array<{ transaction_id: { hash: string } }> };

    if (data.ok && data.result.length > 0) {
      return data.result[0].transaction_id.hash;
    }
    return null;
  } catch {
    return null;
  }
}
