import type { Context } from 'grammy';
import type { Conversation } from '@grammyjs/conversations';
import { prisma } from '../../lib/prisma.js';
import { scheduleDeal, transitionDeal } from '../../services/deals.js';
import { publishPost } from '../../services/posting.js';
import { notifyUser } from '../../services/telegram.js';

/**
 * Grammy conversation: schedule or immediately publish an approved post.
 * Available after creative is approved (CREATIVE_APPROVED status).
 */
export async function schedulePostConversation(
  conversation: Conversation<Context>,
  ctx: Context,
) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await conversation.external(() =>
    prisma.user.findUnique({ where: { telegramId: BigInt(telegramId) } }),
  );

  if (!user) {
    await ctx.reply('You need to register first.');
    return;
  }

  // Find deals ready for publishing
  const deals = await conversation.external(() =>
    prisma.deal.findMany({
      where: {
        channelOwnerId: user.id,
        status: 'CREATIVE_APPROVED',
      },
      include: {
        channel: { select: { title: true, username: true } },
        advertiser: { select: { firstName: true, telegramId: true } },
      },
    }),
  );

  if (deals.length === 0) {
    await ctx.reply('No deals ready for publishing. Creative must be approved first.');
    return;
  }

  // List deals
  let text = '📅 <b>Schedule post — select a deal:</b>\n\n';
  const keyboard: Array<Array<{ text: string }>> = [];

  for (const deal of deals) {
    text += `#${deal.id} — ${deal.channel.title} (${deal.priceInTon} TON)\n`;
    keyboard.push([{ text: `#${deal.id}` }]);
  }
  keyboard.push([{ text: 'Cancel' }]);

  await ctx.reply(text, {
    parse_mode: 'HTML',
    reply_markup: { keyboard, one_time_keyboard: true, resize_keyboard: true },
  });

  // Wait for selection
  const response = await conversation.waitFor('message:text');
  if (response.message.text === 'Cancel') {
    await ctx.reply('Cancelled.', { reply_markup: { remove_keyboard: true } });
    return;
  }

  const dealId = parseInt(response.message.text.replace('#', ''), 10);
  const selectedDeal = deals.find((d) => d.id === dealId);

  if (!selectedDeal) {
    await ctx.reply('Invalid deal.', { reply_markup: { remove_keyboard: true } });
    return;
  }

  // Ask when to publish
  await ctx.reply(
    `📅 <b>When to publish?</b>\n\n` +
    `Deal #${dealId} — ${selectedDeal.channel.title}\n\n` +
    `Send a date and time (e.g., "2026-02-15 14:00") or press "Now" for immediate publishing.`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        keyboard: [[{ text: '🚀 Now' }], [{ text: 'Cancel' }]],
        one_time_keyboard: true,
        resize_keyboard: true,
      },
    },
  );

  const timeResponse = await conversation.waitFor('message:text');
  const timeText = timeResponse.message.text;

  if (timeText === 'Cancel') {
    await ctx.reply('Cancelled.', { reply_markup: { remove_keyboard: true } });
    return;
  }

  if (timeText === '🚀 Now') {
    // Immediate publishing
    await ctx.reply('Publishing now...', { reply_markup: { remove_keyboard: true } });

    try {
      const result = await conversation.external(() => publishPost(dealId));

      await ctx.reply(
        `✅ <b>Post published!</b>\n\n` +
        `Deal #${dealId}\n` +
        `Channel: ${selectedDeal.channel.title}\n` +
        `🔗 ${result.postUrl}\n\n` +
        `The post will be monitored for 24 hours.`,
        { parse_mode: 'HTML' },
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Publishing failed';
      await ctx.reply(`❌ Error: ${message}`);
    }
  } else {
    // Parse scheduled time
    const scheduledAt = new Date(timeText);

    if (isNaN(scheduledAt.getTime()) || scheduledAt <= new Date()) {
      await ctx.reply(
        '❌ Invalid date/time. Must be in the future. Format: YYYY-MM-DD HH:MM\nTry again with /schedulepost',
        { reply_markup: { remove_keyboard: true } },
      );
      return;
    }

    try {
      await conversation.external(() => scheduleDeal(dealId, scheduledAt));

      await ctx.reply(
        `📅 <b>Post scheduled!</b>\n\n` +
        `Deal #${dealId}\n` +
        `Channel: ${selectedDeal.channel.title}\n` +
        `Scheduled for: ${scheduledAt.toLocaleString()}\n\n` +
        `The post will be automatically published at the scheduled time.`,
        { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } },
      );

      // Notify advertiser
      await conversation.external(() =>
        notifyUser(
          selectedDeal.advertiser.telegramId,
          `📅 <b>Post scheduled</b>\n\n` +
          `Deal #${dealId}\n` +
          `Channel: ${selectedDeal.channel.title}\n` +
          `Scheduled for: ${scheduledAt.toLocaleString()}`,
        ),
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Scheduling failed';
      await ctx.reply(`❌ Error: ${message}`, { reply_markup: { remove_keyboard: true } });
    }
  }
}
