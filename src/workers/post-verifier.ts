import { Queue, Worker } from 'bullmq';
import { redis } from '../lib/redis.js';
import { prisma } from '../lib/prisma.js';
import { bot } from '../bot/index.js';
import { transitionDeal } from '../services/deals.js';
import { releaseFunds } from '../services/ton.js';
import { notifyUser, formatNotification } from '../services/telegram.js';
import { POST_VERIFIER_INTERVAL, POST_VERIFICATION_HOURS } from '../config.js';

const QUEUE_NAME = 'post-verifier';

export const postVerifierQueue = new Queue(QUEUE_NAME, {
  connection: redis,
});

export const postVerifierWorker = new Worker(
  QUEUE_NAME,
  async () => {
    // Find all deals with POSTED status
    const postedDeals = await prisma.deal.findMany({
      where: {
        status: 'POSTED',
        postMessageId: { not: null },
      },
      include: {
        channel: { select: { telegramId: true, title: true, username: true } },
        advertiser: { select: { telegramId: true, firstName: true } },
        channelOwner: { select: { telegramId: true, firstName: true } },
      },
    });

    for (const deal of postedDeals) {
      try {
        const hoursSincePost = deal.postedAt
          ? (Date.now() - deal.postedAt.getTime()) / 3600_000
          : 0;

        // Check if post still exists using forwardMessage
        const isDeleted = await checkPostDeleted(
          Number(deal.channel.telegramId),
          deal.postMessageId!,
        );

        if (isDeleted) {
          // Post was deleted
          await prisma.deal.update({
            where: { id: deal.id },
            data: { postDeletedAt: new Date() },
          });

          await prisma.dealEvent.create({
            data: {
              dealId: deal.id,
              type: 'post_delete',
              data: {
                detectedAt: new Date().toISOString(),
                hoursSincePost,
              },
            },
          });

          // Notify both parties
          const deleteMsg = formatNotification({
            emoji: '🚨', title: 'Post deleted',
            dealId: deal.id, channel: deal.channel.title,
            hint: 'The ad post was deleted before verification ended. Funds are being held.',
          });

          await Promise.all([
            notifyUser(deal.advertiser.telegramId, deleteMsg),
            notifyUser(deal.channelOwner.telegramId, deleteMsg),
          ]);

          // Move to disputed
          await transitionDeal(deal.id, 'DISPUTED', {}, {
            reason: 'post_deleted',
          });

          continue;
        }

        // If 24 hours have passed and post is intact → VERIFIED
        if (hoursSincePost >= POST_VERIFICATION_HOURS && !deal.postDeletedAt && !deal.postEditedAt) {
          await transitionDeal(deal.id, 'VERIFIED', {
            postVerifiedAt: new Date(),
          });

          // Trigger payout
          try {
            await releaseFunds(deal.id);
          } catch (err) {
            console.error(`Payout failed for deal ${deal.id}:`, err);

            // Notify about payout failure
            await notifyUser(
              deal.channelOwner.telegramId,
              formatNotification({
                emoji: '⚠️', title: 'Payout processing',
                dealId: deal.id, channel: deal.channel.title,
                hint: 'Post verified! Payout is being processed. Contact support if not received within 1 hour.',
              }),
            );
          }
        }
      } catch (err) {
        console.error(`Post verification failed for deal ${deal.id}:`, err);
      }
    }
  },
  {
    connection: redis,
    concurrency: 1,
  },
);

postVerifierWorker.on('failed', (job, err) => {
  console.error(`Post verifier job ${job?.id} failed:`, err);
});

/**
 * Check if a post has been deleted by trying to copy it.
 * copyMessage is better than forwardMessage because it doesn't require
 * the bot to have a chat with itself — we copy to the channel admin (owner).
 * If copying fails with "message not found", the post is deleted.
 */
async function checkPostDeleted(
  channelTelegramId: number,
  messageId: number,
): Promise<boolean> {
  try {
    // Use getChat to verify channel is accessible, then try copyMessage
    // to the same channel (we'll delete the copy immediately)
    const copied = await bot.api.copyMessage(channelTelegramId, channelTelegramId, messageId);

    // Delete the copy to clean up
    try {
      await bot.api.deleteMessage(channelTelegramId, copied.message_id);
    } catch {
      // Ignore cleanup errors
    }

    return false; // Post exists
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '';
    if (
      message.includes('message to copy not found') ||
      message.includes('message to forward not found') ||
      message.includes('MESSAGE_ID_INVALID')
    ) {
      return true; // Post was deleted
    }
    // Other errors (network, rate limit) — assume post exists, don't block
    console.error(`Post check error for channel ${channelTelegramId}, msg ${messageId}:`, err);
    return false;
  }
}

/**
 * Start the repeatable post verifier.
 */
export async function startPostVerifier() {
  const existing = await postVerifierQueue.getRepeatableJobs();
  for (const job of existing) {
    await postVerifierQueue.removeRepeatableByKey(job.key);
  }

  await postVerifierQueue.add(
    'verify-posts',
    {},
    {
      repeat: { every: POST_VERIFIER_INTERVAL },
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 50 },
    },
  );

  console.log(`Post verifier started (every ${POST_VERIFIER_INTERVAL / 60000}min)`);
}
