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
    const { dealId } = job.data as { dealId: number };

    const deal = await prisma.deal.findUnique({ where: { id: dealId } });
    if (!deal || deal.status !== 'SCHEDULED') {
      console.log(`Skipping scheduled publish for deal ${dealId}: status is ${deal?.status}`);
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

  if (delay <= 0) {
    // Publish immediately
    await scheduledPublisherQueue.add('publish', { dealId });
  } else {
    await scheduledPublisherQueue.add('publish', { dealId }, { delay });
  }

  console.log(`Scheduled publish for deal ${dealId} at ${publishAt.toISOString()} (delay: ${Math.round(delay / 1000)}s)`);
}
