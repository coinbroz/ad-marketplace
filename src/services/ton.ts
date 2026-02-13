import { Address } from '@ton/ton';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import {
  getWalletBalance,
  decryptSecretKey,
  sendFromEscrow,
  fromNano,
  toNano,
  getEscrowStateInitBoc,
} from '../utils/ton-wallet.js';
import { config, GAS_RESERVE_TON, TON_ENDPOINT, PAYMENT_TOLERANCE_NANOTON } from '../config.js';
import { transitionDeal } from './deals.js';
import { notifyUser, formatNotification } from './telegram.js';

/**
 * Format TON amounts to a clean string (no scientific notation, trim trailing zeros).
 */
function formatTon(amount: number): string {
  if (amount <= 0) return '0';
  // Full nanoTON precision (9 decimals), trim trailing zeros — no rounding
  return amount.toFixed(9).replace(/\.?0+$/, '');
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

  // Accept payment within tolerance (handles bounce fees on undeployed wallets)
  if (balance >= requiredAmount - PAYMENT_TOLERANCE_NANOTON) {
    // Payment received — get incoming transaction hash
    const txHash = await getLatestIncomingTxHash(deal.escrowAddress, requiredAmount);

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
    // Always link to the escrow address page (reliable), optionally add tx link
    const isTestnet = config.TON_NETWORK === 'testnet';
    const displayAddr = Address.parse(deal.escrowAddress).toString({ bounceable: false, testOnly: isTestnet });
    const addrLine = `\n🔗 <a href="${addressExplorerUrl(displayAddr)}">View escrow on TON Explorer</a>`;
    // Show the deal price (clean amount), not raw balance
    const amountStr = formatTon(deal.priceInTon);
    const advertiserMsg = formatNotification({
      emoji: '💰', title: 'Payment received',
      dealId, channel: deal.channel.title, price: amountStr,
      lines: [addrLine],
      hint: '📋 Now send your ad brief: use /submitbrief',
    });
    const ownerMsg = formatNotification({
      emoji: '💰', title: 'Payment received',
      dealId, channel: deal.channel.title, price: amountStr,
      lines: [addrLine],
      hint: '⏳ Waiting for the advertiser to send their ad brief.',
    });

    await Promise.all([
      notifyUser(deal.advertiser.telegramId, advertiserMsg),
      notifyUser(deal.channelOwner.telegramId, ownerMsg),
    ]);

    return true;
  }

  // Check partial payment (only if significantly short, not within tolerance)
  if (balance > 0n && balance < requiredAmount - PAYMENT_TOLERANCE_NANOTON) {
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
        formatNotification({
          emoji: '⚠️', title: 'Partial payment detected',
          dealId, channel: deal.channel.title,
          lines: [
            `Received: ${receivedTon} TON`,
            `Required: ${requiredTon} TON`,
          ],
          hint: `Please send the remaining <b>${remainingTon} TON</b> to complete.`,
        }),
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

  // Get escrow balance and use deal price for clean amount calculations.
  // Raw balance may be e.g. 0.509999999 TON due to network fee deductions;
  // using deal.priceInTon gives clean round amounts (e.g. 0.45 instead of 0.449999999).
  const balance = await getWalletBalance(deal.escrowAddress!);
  const dealAmountNano = toNano(deal.priceInTon);

  const feePercent = config.PLATFORM_FEE_PERCENT;
  const gasReserve = toNano(GAS_RESERVE_TON);

  let ownerAmount: bigint;
  let feeAmount = 0n;

  if (feePercent > 0) {
    feeAmount = (dealAmountNano * BigInt(Math.round(feePercent * 100))) / 10000n;
    ownerAmount = dealAmountNano - feeAmount - gasReserve;
  } else {
    ownerAmount = dealAmountNano - gasReserve;
  }

  // Safety: if escrow somehow has less than needed, fall back to balance-based calc
  if (balance < ownerAmount) {
    ownerAmount = balance > gasReserve ? balance - gasReserve : balance;
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

  // Notify both parties with fee breakdown
  const txLine = isRealTxHash(txHash)
    ? `\n🔗 <a href="${txExplorerUrl(txHash)}">View transaction on TON Explorer</a>`
    : '';
  const dealPriceStr = formatTon(deal.priceInTon);
  const gasReserveStr = formatTon(GAS_RESERVE_TON);
  const sentStr = formatTon(fromNano(ownerAmount));
  const feeLine = feeAmount > 0n
    ? `\n💼 Platform fee (${feePercent}%): −${formatTon(fromNano(feeAmount))} TON`
    : '';
  const payoutMsg = formatNotification({
    emoji: '✅', title: 'Payout completed',
    dealId, channel: deal.channel.title,
    lines: [
      `💰 Deal price: ${dealPriceStr} TON`,
      ...(feeLine ? [feeLine] : []),
      `⛽ Gas reserve: −${gasReserveStr} TON`,
      `📤 Sent: ${sentStr} TON`,
      '',
      `<i>Blockchain fee (~0.004 TON) deducted by the network.</i>`,
      ...(txLine ? [txLine] : []),
    ],
  });

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

  // Calculate refund: deal price minus gas reserve, with balance safety check
  const gasReserve = toNano(GAS_RESERVE_TON);
  const dealAmountNano = toNano(deal.priceInTon);
  let refundAmount = dealAmountNano > gasReserve ? dealAmountNano - gasReserve : dealAmountNano;

  // Safety: if escrow has less than needed, fall back to balance-based calc
  if (balance < refundAmount) {
    refundAmount = balance > gasReserve ? balance - gasReserve : balance;
  }

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

  // Update deal — also persist the refund address so UI knows where funds went
  await transitionDeal(dealId, 'REFUNDED', {
    refundTxHash: txHash,
    refundedAt: new Date(),
    ...(isValidTonAddress(refundToAddress) && !deal.refundAddress ? { refundAddress: refundToAddress } : {}),
  });

  const refundTonStr = formatTon(fromNano(refundAmount));

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

  // Notify both parties with fee breakdown
  const hasRealAddress = isValidTonAddress(refundToAddress);
  const hasRealTx = isRealTxHash(txHash);
  const txLine = hasRealTx
    ? `🔗 <a href="${txExplorerUrl(txHash)}">View transaction on TON Explorer</a>`
    : '';

  const dealPriceStr = formatTon(deal.priceInTon);
  const gasReserveStr = formatTon(GAS_RESERVE_TON);
  const breakdownLines = [
    `💰 Deal price: ${dealPriceStr} TON`,
    `⛽ Gas reserve: −${gasReserveStr} TON`,
    `📤 Sent: ${refundTonStr} TON`,
    '',
    `<i>Blockchain fee (~0.004 TON) deducted by the network.</i>`,
  ];

  let refundTitle: string;
  let refundHint: string;
  if (hasRealAddress && hasRealTx) {
    refundTitle = 'Refund sent';
    refundHint = `To: <code>${refundToAddress}</code>\n${txLine}`;
  } else if (hasRealAddress) {
    refundTitle = 'Refund sent';
    refundHint = `To: <code>${refundToAddress}</code>\n⏳ Processing on the blockchain.`;
  } else {
    refundTitle = 'Refund initiated';
    refundHint = '📝 Open the deal in Mini App and enter your refund wallet address.';
  }

  const refundMsg = formatNotification({
    emoji: '🔄', title: refundTitle,
    dealId, channel: deal.channel.title,
    lines: breakdownLines,
    hint: refundHint,
  });

  const ownerRefundMsg = formatNotification({
    emoji: '🔄', title: 'Refund processed',
    dealId, channel: deal.channel.title,
    lines: [
      `💰 Deal price: ${dealPriceStr} TON`,
      `⛽ Gas reserve: −${gasReserveStr} TON`,
      `📤 Refunded: ${refundTonStr} TON`,
      ...(txLine ? ['', txLine] : []),
    ],
  });

  await Promise.all([
    notifyUser(deal.advertiser.telegramId, refundMsg),
    notifyUser(deal.channelOwner.telegramId, ownerRefundMsg),
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

  // Calculate refund: deal price minus gas reserve, with balance safety check
  const gasReserve = toNano(GAS_RESERVE_TON);
  const dealAmountNano = toNano(deal.priceInTon);
  let refundAmount = dealAmountNano > gasReserve ? dealAmountNano - gasReserve : dealAmountNano;
  if (balance < refundAmount) {
    refundAmount = balance > gasReserve ? balance - gasReserve : balance;
  }
  const publicKey = Buffer.from(deal.escrowWallet.publicKey, 'hex');

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

    const txLine = `🔗 <a href="${txExplorerUrl(onChainHash)}">View transaction on TON Explorer</a>`;
    const refundStr = formatTon(fromNano(refundAmount));
    const dealPriceStr = formatTon(deal.priceInTon);
    const gasReserveStr = formatTon(GAS_RESERVE_TON);
    await notifyUser(
      deal.advertiser.telegramId,
      formatNotification({
        emoji: '✅', title: 'Refund sent',
        dealId, channel: deal.channel.title,
        lines: [
          `💰 Deal price: ${dealPriceStr} TON`,
          `⛽ Gas reserve: −${gasReserveStr} TON`,
          `📤 Sent: ${refundStr} TON`,
          '',
          `<i>Blockchain fee (~0.004 TON) deducted by the network.</i>`,
          txLine,
        ],
        hint: `To: <code>${refundToAddress}</code>`,
      }),
    );

  } else {
    console.warn(`Pending refund for deal ${dealId}: tx sent but hash not confirmed`);
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
      escrowWallet: { select: { publicKey: true } },
    },
  });

  let balance = 0;
  if (deal.escrowAddress) {
    try {
      const rawBalance = await getWalletBalance(deal.escrowAddress);
      balance = parseFloat(fromNano(rawBalance).toFixed(4));
    } catch {
      // Address might not exist yet
    }
  }

  // Convert stored address to correct network format for display
  const isTestnet = config.TON_NETWORK === 'testnet';
  const displayAddress = deal.escrowAddress
    ? Address.parse(deal.escrowAddress).toString({ bounceable: false, testOnly: isTestnet })
    : null;

  // Generate stateInit BOC for the deeplink — deploys escrow contract
  // atomically with payment, preventing bounce on undeployed wallets.
  let stateInit: string | null = null;
  if (deal.escrowWallet?.publicKey && deal.status === 'AWAITING_PAYMENT') {
    try {
      stateInit = getEscrowStateInitBoc(deal.escrowWallet.publicKey);
    } catch {
      // Non-critical: payment will still work without stateInit
    }
  }

  return {
    address: displayAddress,
    requiredAmount: deal.priceInTon,
    currentBalance: balance,
    status: deal.status,
    stateInit,
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

/**
 * Find the incoming payment transaction on an escrow address.
 * Searches recent transactions for one with a non-empty source (incoming)
 * and sufficient value (at least 80% of expected to handle fee deductions).
 */
async function getLatestIncomingTxHash(address: string, minAmountNano?: bigint): Promise<string | null> {
  try {
    const url = `${TON_ENDPOINT}/getTransactions?address=${address}&limit=10`;
    const headers: Record<string, string> = {};
    if (config.TON_API_KEY) {
      headers['X-API-Key'] = config.TON_API_KEY;
    }
    const response = await fetch(url, { headers });
    const data = await response.json() as {
      ok: boolean;
      result: Array<{
        transaction_id: { hash: string };
        in_msg: { value: string; source: string };
      }>;
    };

    if (!data.ok || data.result.length === 0) return null;

    // Find first incoming transaction with sufficient value
    const threshold = minAmountNano
      ? (minAmountNano * 80n) / 100n // 80% of expected amount
      : 0n;

    for (const tx of data.result) {
      const inValue = BigInt(tx.in_msg?.value || '0');
      const hasSource = !!tx.in_msg?.source;
      if (hasSource && inValue >= threshold) {
        return tx.transaction_id.hash;
      }
    }

    return null;
  } catch {
    return null;
  }
}
