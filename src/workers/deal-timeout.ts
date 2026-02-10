import { Queue, Worker } from 'bullmq';
import { redis } from '../lib/redis.js';
import { prisma } from '../lib/prisma.js';
import { transitionDeal } from '../services/deals.js';
import { refundFunds } from '../services/ton.js';
import { notifyUser } from '../services/telegram.js';
import { DEAL_TIMEOUT_INTERVAL } from '../config.js';

const QUEUE_NAME = 'deal-timeout';

export const dealTimeoutQueue = new Queue(QUEUE_NAME, {
  connection: redis,
});

const TERMINAL_STATUSES = ['COMPLETED', 'REFUNDED', 'CANCELLED', 'EXPIRED'];

export const dealTimeoutWorker = new Worker(
  QUEUE_NAME,
  async () => {
    // Find expired deals
    const expiredDeals = await prisma.deal.findMany({
      where: {
        expiresAt: { lte: new Date() },
        status: { notIn: TERMINAL_STATUSES as any },
      },
      include: {
        advertiser: { select: { telegramId: true, firstName: true } },
        channelOwner: { select: { telegramId: true, firstName: true } },
        channel: { select: { title: true } },
      },
    });

    for (const deal of expiredDeals) {
      try {
        // If funded, refund first
        if (['FUNDED', 'CREATIVE_DRAFT', 'CREATIVE_REVIEW', 'CREATIVE_APPROVED', 'SCHEDULED'].includes(deal.status)) {
          try {
            await refundFunds(deal.id);
          } catch (err) {
            console.error(`Refund failed for expired deal ${deal.id}:`, err);
          }
        }

        // If not yet refunded/cancelled, expire
        const currentDeal = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
        if (!TERMINAL_STATUSES.includes(currentDeal.status)) {
          const targetStatus = deal.status === 'AWAITING_PAYMENT' || deal.status === 'PENDING'
            ? 'EXPIRED' as const
            : 'CANCELLED' as const;

          await transitionDeal(deal.id, targetStatus, {}, {
            reason: 'timeout',
            previousStatus: deal.status,
          });

          // Notify both parties
          const timeoutMsg = `⏰ <b>Deal expired</b>\n\nDeal #${deal.id}\nChannel: ${deal.channel.title}\n\nThe deal has been automatically ${targetStatus.toLowerCase()} due to inactivity.`;

          await Promise.all([
            notifyUser(deal.advertiser.telegramId, timeoutMsg),
            notifyUser(deal.channelOwner.telegramId, timeoutMsg),
          ]);
        }
      } catch (err) {
        console.error(`Timeout handling failed for deal ${deal.id}:`, err);
      }
    }
  },
  {
    connection: redis,
    concurrency: 1,
  },
);

dealTimeoutWorker.on('failed', (job, err) => {
  console.error(`Deal timeout job ${job?.id} failed:`, err);
});

/**
 * Start the repeatable deal timeout checker.
 */
export async function startDealTimeout() {
  const existing = await dealTimeoutQueue.getRepeatableJobs();
  for (const job of existing) {
    await dealTimeoutQueue.removeRepeatableByKey(job.key);
  }

  await dealTimeoutQueue.add(
    'check-timeouts',
    {},
    {
      repeat: { every: DEAL_TIMEOUT_INTERVAL },
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 50 },
    },
  );

  console.log(`Deal timeout checker started (every ${DEAL_TIMEOUT_INTERVAL / 60000}min)`);
}
