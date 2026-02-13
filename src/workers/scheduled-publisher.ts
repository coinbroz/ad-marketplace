import { Queue, Worker } from 'bullmq';
import { redis } from '../lib/redis.js';
import { prisma } from '../lib/prisma.js';
import { publishPost } from '../services/posting.js';

const QUEUE_NAME = 'scheduled-publisher';

export const scheduledPublisherQueue = new Queue(QUEUE_NAME, {
  connection: redis,
});

export const scheduledPublisherWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { dealId, scheduledAt } = job.data as { dealId: number; scheduledAt?: string };

    const deal = await prisma.deal.findUnique({ where: { id: dealId } });
    if (!deal || deal.status !== 'SCHEDULED') {
      console.log(`Skipping scheduled publish for deal ${dealId}: status is ${deal?.status}`);
      return;
    }

    // If deal was rescheduled, ignore stale jobs
    if (scheduledAt && deal.scheduledAt && deal.scheduledAt.toISOString() !== scheduledAt) {
      console.log(`Skipping stale publish job for deal ${dealId}: rescheduled`);
      return;
    }

    await publishPost(dealId);
    console.log(`Scheduled post published for deal ${dealId}`);
  },
  {
    connection: redis,
    concurrency: 1,
  },
);

scheduledPublisherWorker.on('failed', (job, err) => {
  console.error(`Scheduled publish job ${job?.id} failed:`, err);
});

/**
 * Schedule a post to be published at a specific time.
 */
export async function schedulePublishJob(dealId: number, publishAt: Date) {
  const delay = publishAt.getTime() - Date.now();
  const jobData = { dealId, scheduledAt: publishAt.toISOString() };

  if (delay <= 0) {
    await scheduledPublisherQueue.add('publish', jobData);
  } else {
    await scheduledPublisherQueue.add('publish', jobData, { delay });
  }

  console.log(`Scheduled publish for deal ${dealId} at ${publishAt.toISOString()} (delay: ${Math.round(delay / 1000)}s)`);
}
