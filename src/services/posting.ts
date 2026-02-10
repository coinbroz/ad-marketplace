import crypto from 'node:crypto';
import { bot } from '../bot/index.js';
import { prisma } from '../lib/prisma.js';
import { transitionDeal } from './deals.js';
import { notifyUser } from './telegram.js';
import { isUserAdmin, isBotAdmin } from './telegram.js';

/**
 * Publish the approved creative to the channel.
 */
export async function publishPost(dealId: number) {
  const deal = await prisma.deal.findUniqueOrThrow({
    where: { id: dealId },
    include: {
      channel: { select: { telegramId: true, title: true, username: true } },
      channelOwner: { select: { telegramId: true } },
      advertiser: { select: { telegramId: true } },
    },
  });

  if (!deal.creativeText && !deal.creativeMediaFileId) {
    throw new Error('No creative content to publish');
  }

  // Pre-publish checks
  // 1. Check bot is still admin
  const botAdmin = await isBotAdmin(Number(deal.channel.telegramId));
  if (!botAdmin) {
    throw new Error('Bot is no longer an admin of the channel');
  }

  // 2. Check channel owner is still admin
  const ownerAdmin = await isUserAdmin(
    Number(deal.channel.telegramId),
    Number(deal.channelOwner.telegramId),
  );
  if (!ownerAdmin) {
    throw new Error('Channel owner is no longer an admin of the channel');
  }

  const channelId = Number(deal.channel.telegramId);
  let messageId: number;

  // Publish based on media type
  if (deal.creativeMediaFileId && deal.creativeMediaType) {
    switch (deal.creativeMediaType) {
      case 'photo':
        const photoMsg = await bot.api.sendPhoto(channelId, deal.creativeMediaFileId, {
          caption: deal.creativeText || undefined,
          parse_mode: 'HTML',
        });
        messageId = photoMsg.message_id;
        break;

      case 'video':
        const videoMsg = await bot.api.sendVideo(channelId, deal.creativeMediaFileId, {
          caption: deal.creativeText || undefined,
          parse_mode: 'HTML',
        });
        messageId = videoMsg.message_id;
        break;

      case 'document':
        const docMsg = await bot.api.sendDocument(channelId, deal.creativeMediaFileId, {
          caption: deal.creativeText || undefined,
          parse_mode: 'HTML',
        });
        messageId = docMsg.message_id;
        break;

      default:
        const textMsg = await bot.api.sendMessage(channelId, deal.creativeText!, {
          parse_mode: 'HTML',
        });
        messageId = textMsg.message_id;
    }
  } else {
    const textMsg = await bot.api.sendMessage(channelId, deal.creativeText!, {
      parse_mode: 'HTML',
    });
    messageId = textMsg.message_id;
  }

  // Generate content hash for edit detection
  const contentHash = generateContentHash(deal.creativeText, deal.creativeMediaFileId);

  // Update deal
  await transitionDeal(dealId, 'POSTED', {
    postedAt: new Date(),
    postMessageId: messageId,
    postContentHash: contentHash,
  });

  // Log event
  await prisma.dealEvent.create({
    data: {
      dealId,
      type: 'status_change',
      data: {
        action: 'post_published',
        messageId,
        channelUsername: deal.channel.username,
      },
    },
  });

  // Notify both parties
  const postUrl = deal.channel.username
    ? `https://t.me/${deal.channel.username}/${messageId}`
    : `Message #${messageId}`;

  const publishMsg = `📢 <b>Post published!</b>\n\nDeal #${dealId}\nChannel: ${deal.channel.title}\n\n🔗 ${postUrl}\n\nThe post will be monitored for 24 hours. Funds will be released after verification.`;

  await Promise.all([
    notifyUser(deal.advertiser.telegramId, publishMsg),
    notifyUser(deal.channelOwner.telegramId, publishMsg),
  ]);

  return { messageId, postUrl };
}

/**
 * Generate SHA-256 hash of content for edit detection.
 */
function generateContentHash(text?: string | null, mediaFileId?: string | null): string {
  const content = `${text || ''}|${mediaFileId || ''}`;
  return crypto.createHash('sha256').update(content).digest('hex');
}
