import { Address } from '@ton/ton';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import {
  getWalletBalance,
  decryptSecretKey,
  sendFromEscrow,
  fromNano,
  toNano,
} from '../utils/ton-wallet.js';
import { config, GAS_RESERVE_TON, TON_ENDPOINT } from '../config.js';
import { transitionDeal } from './deals.js';
import { notifyUser } from './telegram.js';

// Payment tolerance: accept payments within 0.01 TON of required amount.
// Covers TON message forwarding fees and minor rounding differences.
const PAYMENT_TOLERANCE = toNano(0.01);

/**
 * Format TON amounts to a clean string (no scientific notation, trim trailing zeros).
 */
function formatTon(amount: number): string {
  if (amount <= 0) return '0';
  // Use fixed 4 decimals, then trim trailing zeros
  return amount.toFixed(4).replace(/\.?0+$/, '');
}

/**
 * Check if a string is a valid TON address.
 */
function isValidTonAddress(address: string): boolean {
  if (!address || address === 'pending') return false;
  try {
    Address.parse(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a TX hash is a real blockchain hash (not a placeholder).
 * Placeholder hashes start with 'payout_', 'refund_', etc.
 */
function isRealTxHash(hash: string | null | undefined): boolean {
  if (!hash) return false;
  return !hash.startsWith('payout_') && !hash.startsWith('refund_');
}

/**
 * Build a TON explorer link for a transaction hash.
 */
function txExplorerUrl(hash: string): string {
  const base = config.TON_NETWORK === 'mainnet'
    ? 'https://tonscan.org'
    : 'https://testnet.tonscan.org';
  return `${base}/tx/${encodeURIComponent(hash)}`;
}

/**
 * Build a TON explorer link for an address.
 */
function addressExplorerUrl(address: string): string {
  const base = config.TON_NETWORK === 'mainnet'
    ? 'https://tonscan.org'
    : 'https://testnet.tonscan.org';
  return `${base}/${address}`;
}

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

  if (balance >= requiredAmount - PAYMENT_TOLERANCE) {
    // Payment received (full or within tolerance) — get transaction hash
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

    // Clear partial payment notification key
    await redis.del(`partial_notified:${dealId}`);

    // Notify both parties with next-step hints
    const txLine = isRealTxHash(txHash)
      ? `\n🔗 <a href="${txExplorerUrl(txHash!)}">View transaction on TON Explorer</a>`
      : '';
    const advertiserMsg = `💰 <b>Payment received!</b>\n\nDeal #${dealId}\nChannel: ${deal.channel.title}\nAmount: ${formatTon(fromNano(balance))} TON${txLine}\n\n📋 Now send your ad brief and materials: use /submitbrief`;
    const ownerMsg = `💰 <b>Payment received!</b>\n\nDeal #${dealId}\nChannel: ${deal.channel.title}\nAmount: ${formatTon(fromNano(balance))} TON${txLine}\n\n⏳ Waiting for the advertiser to send their ad brief.`;

    await Promise.all([
      notifyUser(deal.advertiser.telegramId, advertiserMsg),
      notifyUser(deal.channelOwner.telegramId, ownerMsg),
    ]);

    return true;
  }

  // Check partial payment (real underpayment, not within tolerance)
  if (balance > 0n) {
    const receivedTon = formatTon(fromNano(balance));
    const requiredTon = formatTon(deal.priceInTon);
    const remainingNano = requiredAmount - balance;
    const remainingTon = formatTon(fromNano(remainingNano));

    // Throttle: only notify if balance changed OR 10 minutes passed since last notification
    const redisKey = `partial_notified:${dealId}`;
    const lastNotifiedBalance = await redis.get(redisKey);
    const currentBalanceStr = balance.toString();

    if (lastNotifiedBalance !== currentBalanceStr) {
      // Balance changed (new partial payment) or first time — notify and set 10min TTL
      await redis.set(redisKey, currentBalanceStr, 'EX', 600);

      await notifyUser(
        deal.advertiser.telegramId,
        `⚠️ <b>Partial payment detected</b>\n\nDeal #${dealId}\nReceived: ${receivedTon} TON\nRequired: ${requiredTon} TON\n\nPlease send the remaining <b>${remainingTon} TON</b> to complete the payment.`,
      );
    }
    // else: same balance, within 10min cooldown — skip notification
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

  // Send real TON transaction if we have a valid address
  let txHash: string;
  if (isValidTonAddress(payoutToAddress)) {
    const publicKey = Buffer.from(deal.escrowWallet.publicKey, 'hex');
    const onChainHash = await sendFromEscrow({
      publicKey,
      secretKey,
      toAddress: payoutToAddress,
      amount: ownerAmount,
    });
    txHash = onChainHash || `payout_pending_${dealId}_${Date.now()}`;
  } else {
    console.warn(`Deal ${dealId}: no valid payout address, skipping TON transfer`);
    txHash = `payout_no_address_${dealId}_${Date.now()}`;
  }

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
  const txLine = isRealTxHash(txHash)
    ? `\n🔗 <a href="${txExplorerUrl(txHash)}">View transaction on TON Explorer</a>`
    : '';
  const payoutMsg = `✅ <b>Payout completed!</b>\n\nDeal #${dealId}\nChannel: ${deal.channel.title}\nAmount: ${fromNano(ownerAmount)} TON${txLine}`;

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

  // Use refundAddress (entered after cancel) > profile wallet > 'pending'
  const refundToAddress = deal.refundAddress || deal.advertiser.tonWalletAddress || 'pending';

  // Decrypt secret key
  const secretKey = decryptSecretKey({
    encrypted: deal.escrowWallet.secretKeyEnc,
    iv: deal.escrowWallet.secretKeyIv,
    tag: deal.escrowWallet.secretKeyTag,
  });

  const gasReserve = toNano(GAS_RESERVE_TON);
  const refundAmount = balance > gasReserve ? balance - gasReserve : balance;

  // Send real TON transaction if we have a valid address
  let txHash: string;
  if (isValidTonAddress(refundToAddress)) {
    const publicKey = Buffer.from(deal.escrowWallet.publicKey, 'hex');
    const onChainHash = await sendFromEscrow({
      publicKey,
      secretKey,
      toAddress: refundToAddress,
      amount: refundAmount,
    });
    txHash = onChainHash || `refund_pending_${dealId}_${Date.now()}`;
  } else {
    console.warn(`Deal ${dealId}: no valid refund address, skipping TON transfer (address will be collected later)`);
    txHash = `refund_awaiting_address_${dealId}_${Date.now()}`;
  }

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
  const hasRealAddress = isValidTonAddress(refundToAddress);
  const hasRealTx = isRealTxHash(txHash);
  const txLine = hasRealTx
    ? `\n🔗 <a href="${txExplorerUrl(txHash)}">View transaction on TON Explorer</a>`
    : '';

  let refundMsg: string;
  if (hasRealAddress && hasRealTx) {
    refundMsg = `🔄 <b>Refund sent!</b>\n\nDeal #${dealId}\nChannel: ${deal.channel.title}\nAmount: ${fromNano(refundAmount)} TON\nTo: <code>${refundToAddress}</code>${txLine}`;
  } else if (hasRealAddress) {
    refundMsg = `🔄 <b>Refund sent!</b>\n\nDeal #${dealId}\nChannel: ${deal.channel.title}\nAmount: ${fromNano(refundAmount)} TON\nTo: <code>${refundToAddress}</code>\n\n⏳ Transaction is being processed on the blockchain.`;
  } else {
    refundMsg = `🔄 <b>Refund initiated</b>\n\nDeal #${dealId}\nChannel: ${deal.channel.title}\nAmount: ${fromNano(refundAmount)} TON\n\n📝 Please open the deal in Mini App and enter your refund wallet address.`;
  }

  await Promise.all([
    notifyUser(deal.advertiser.telegramId, refundMsg),
    notifyUser(deal.channelOwner.telegramId, `🔄 <b>Refund processed</b>\n\nDeal #${dealId}\nChannel: ${deal.channel.title}\nAmount: ${fromNano(refundAmount)} TON${txLine}`),
  ]);

  return txHash;
}

/**
 * Execute a pending refund — retry the actual TON transfer for a REFUNDED deal
 * where the on-chain transaction wasn't completed (placeholder hash).
 * Called when advertiser saves/updates refund address on an already-REFUNDED deal.
 */
export async function executePendingRefund(dealId: number): Promise<string | null> {
  const deal = await prisma.deal.findUniqueOrThrow({
    where: { id: dealId },
    include: {
      escrowWallet: true,
      advertiser: { select: { telegramId: true, tonWalletAddress: true, firstName: true } },
      channel: { select: { title: true } },
    },
  });

  if (deal.status !== 'REFUNDED' || !deal.escrowWallet || !deal.escrowAddress) {
    return null;
  }

  // Only retry if current txHash is a placeholder
  if (isRealTxHash(deal.refundTxHash)) {
    return deal.refundTxHash; // Already sent
  }

  const refundToAddress = deal.refundAddress || deal.advertiser.tonWalletAddress;
  if (!refundToAddress || !isValidTonAddress(refundToAddress)) {
    return null; // No valid address to send to
  }

  // Check if escrow still has balance
  let balance: bigint;
  try {
    balance = await getWalletBalance(deal.escrowAddress);
    if (balance === 0n) {
      console.log(`Deal ${dealId}: escrow balance is 0, refund may have already been sent`);
      return null;
    }
  } catch (err) {
    console.error(`Balance check failed for pending refund deal ${dealId}:`, err);
    balance = toNano(deal.priceInTon);
  }

  const secretKey = decryptSecretKey({
    encrypted: deal.escrowWallet.secretKeyEnc,
    iv: deal.escrowWallet.secretKeyIv,
    tag: deal.escrowWallet.secretKeyTag,
  });

  const gasReserve = toNano(GAS_RESERVE_TON);
  const refundAmount = balance > gasReserve ? balance - gasReserve : balance;
  const publicKey = Buffer.from(deal.escrowWallet.publicKey, 'hex');

  console.log(`Executing pending refund for deal ${dealId}: ${fromNano(refundAmount)} TON → ${refundToAddress}`);
  console.log(`  escrowAddress: ${deal.escrowAddress}`);
  console.log(`  publicKey (hex): ${deal.escrowWallet.publicKey}`);
  console.log(`  balance: ${fromNano(balance)} TON, gasReserve: ${GAS_RESERVE_TON} TON, refundAmount: ${fromNano(refundAmount)} TON`);

  const onChainHash = await sendFromEscrow({
    publicKey,
    secretKey,
    toAddress: refundToAddress,
    amount: refundAmount,
  });

  if (onChainHash) {
    // Update the deal with the real tx hash
    await prisma.deal.update({
      where: { id: dealId },
      data: { refundTxHash: onChainHash },
    });

    await prisma.dealEvent.create({
      data: {
        dealId,
        type: 'payment',
        data: {
          action: 'refund_executed',
          amount: fromNano(refundAmount),
          txHash: onChainHash,
          toAddress: refundToAddress,
        },
      },
    });

    const txLine = `\n🔗 <a href="${txExplorerUrl(onChainHash)}">View transaction on TON Explorer</a>`;
    await notifyUser(
      deal.advertiser.telegramId,
      `✅ <b>Refund sent!</b>\n\nDeal #${dealId}\nAmount: ${fromNano(refundAmount)} TON\nTo: <code>${refundToAddress}</code>${txLine}`,
    );

    console.log(`Pending refund executed for deal ${dealId}: ${onChainHash}`);
  } else {
    console.warn(`Pending refund for deal ${dealId}: transaction sent but hash not confirmed`);
  }

  return onChainHash;
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
    explorerUrl: displayAddress ? addressExplorerUrl(displayAddress) : null,
    paymentTx: isRealTxHash(deal.paidTxHash) ? txExplorerUrl(deal.paidTxHash!) : null,
    payoutTx: isRealTxHash(deal.payoutTxHash) ? txExplorerUrl(deal.payoutTxHash!) : null,
    refundTx: isRealTxHash(deal.refundTxHash) ? txExplorerUrl(deal.refundTxHash!) : null,
    // Raw status for UI to show appropriate messages
    payoutPending: deal.payoutTxHash && !isRealTxHash(deal.payoutTxHash),
    refundPending: deal.refundTxHash && !isRealTxHash(deal.refundTxHash),
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
