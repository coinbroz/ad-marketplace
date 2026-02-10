import { Queue, Worker } from 'bullmq';
import { redis } from '../lib/redis.js';
import { prisma } from '../lib/prisma.js';
import { checkDealPayment } from '../services/ton.js';
import { PAYMENT_MONITOR_INTERVAL } from '../config.js';

const QUEUE_NAME = 'payment-monitor';

export const paymentMonitorQueue = new Queue(QUEUE_NAME, {
  connection: redis,
});

export const paymentMonitorWorker = new Worker(
  QUEUE_NAME,
  async () => {
    // Find all deals awaiting payment
    const deals = await prisma.deal.findMany({
      where: { status: 'AWAITING_PAYMENT' },
      select: { id: true, escrowAddress: true },
    });

    for (const deal of deals) {
      try {
        await checkDealPayment(deal.id);
      } catch (err) {
        console.error(`Payment check failed for deal ${deal.id}:`, err);
      }
    }
  },
  {
    connection: redis,
    concurrency: 1,
  },
);

paymentMonitorWorker.on('failed', (job, err) => {
  console.error(`Payment monitor job ${job?.id} failed:`, err);
});

/**
 * Start the repeatable payment monitor job.
 */
export async function startPaymentMonitor() {
  // Remove existing repeatable jobs
  const existing = await paymentMonitorQueue.getRepeatableJobs();
  for (const job of existing) {
    await paymentMonitorQueue.removeRepeatableByKey(job.key);
  }

  // Add new repeatable job
  await paymentMonitorQueue.add(
    'check-payments',
    {},
    {
      repeat: { every: PAYMENT_MONITOR_INTERVAL },
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 50 },
    },
  );

  console.log(`Payment monitor started (every ${PAYMENT_MONITOR_INTERVAL / 1000}s)`);
}
