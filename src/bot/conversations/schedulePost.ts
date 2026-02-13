import type { Context } from 'grammy';
import type { Conversation } from '@grammyjs/conversations';
import { prisma } from '../../lib/prisma.js';
import { scheduleDeal, transitionDeal } from '../../services/deals.js';
import { publishPost } from '../../services/posting.js';
import { notifyUser, formatNotification } from '../../services/telegram.js';

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

  // Find deals ready for publishing or already scheduled (for rescheduling)
  const deals = await conversation.external(() =>
    prisma.deal.findMany({
      where: {
        channelOwnerId: user.id,
        status: { in: ['CREATIVE_APPROVED', 'SCHEDULED'] },
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

  // List deals (inline keyboard — always visible in the message)
  let text = '📅 <b>Schedule post — select a deal:</b>\n\n';
  const inlineKeyboard: Array<Array<{ text: string; callback_data: string }>> = [];

  for (const deal of deals) {
    text += `#${deal.id} — ${deal.channel.title} (${deal.priceInTon} TON)`;
    if (deal.status === 'SCHEDULED' && deal.scheduledAt) {
      text += ` ⏰ ${deal.scheduledAt.toISOString().replace('T', ' ').slice(0, 16)} UTC`;
    }
    text += '\n';
    inlineKeyboard.push([{ text: `#${deal.id} — ${deal.channel.title}`, callback_data: `sched_${deal.id}` }]);
  }
  inlineKeyboard.push([{ text: '❌ Cancel', callback_data: 'sched_cancel' }]);

  await ctx.reply(text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: inlineKeyboard },
  });

  // Wait for deal selection (inline button tap)
  const response = await conversation.waitFor('callback_query:data');
  await response.answerCallbackQuery();

  if (response.callbackQuery.data === 'sched_cancel') {
    await ctx.reply('Cancelled.');
    return;
  }

  const dealId = parseInt(response.callbackQuery.data.replace('sched_', ''), 10);
  const selectedDeal = deals.find((d) => d.id === dealId);

  if (!selectedDeal) {
    await ctx.reply('Invalid deal.');
    return;
  }

  // Ask when to publish (inline buttons + accept text for custom date)
  const isReschedule = selectedDeal.status === 'SCHEDULED';
  let whenText = isReschedule
    ? `📅 <b>Reschedule post</b>\n\nDeal #${dealId} — ${selectedDeal.channel.title}\nCurrently scheduled for: ${selectedDeal.scheduledAt!.toISOString().replace('T', ' ').slice(0, 16)} UTC\n\n`
    : `📅 <b>When to publish?</b>\n\nDeal #${dealId} — ${selectedDeal.channel.title}\n\n`;
  whenText += `Tap "Publish Now" or send a date/time in <b>UTC</b> (e.g., "2026-02-15 14:00").`;

  await ctx.reply(whenText, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🚀 Publish Now', callback_data: 'sched_now' }],
        [{ text: '❌ Cancel', callback_data: 'sched_time_cancel' }],
      ],
    },
  });

  // Wait for either inline button or text message with date
  const timeCtx = await conversation.waitFor(['callback_query:data', 'message:text']);

  // Check if it's a callback query (inline button)
  const cbData = timeCtx.callbackQuery?.data;
  const msgText = timeCtx.message?.text;

  if (cbData) {
    await timeCtx.answerCallbackQuery();

    if (cbData === 'sched_time_cancel') {
      await ctx.reply('Cancelled.');
      return;
    }

    if (cbData === 'sched_now') {
      // Immediate publishing
      await ctx.reply('Publishing now...');

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
    }
  } else if (msgText) {
    // Parse scheduled time from text
    const scheduledAt = new Date(msgText);

    if (isNaN(scheduledAt.getTime()) || scheduledAt <= new Date()) {
      await ctx.reply(
        '❌ Invalid date/time. Must be in the future. Format: YYYY-MM-DD HH:MM\nTry again with /schedulepost',
      );
      return;
    }

    try {
      await conversation.external(() => scheduleDeal(dealId, scheduledAt));

      const actionWord = isReschedule ? 'rescheduled' : 'scheduled';
      const scheduleTime = scheduledAt.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
      await ctx.reply(
        formatNotification({
          emoji: '📅', title: `Post ${actionWord}`,
          dealId, channel: selectedDeal.channel.title,
          lines: [`Scheduled for: ${scheduleTime}`],
          hint: 'The post will be automatically published at the scheduled time.',
        }),
        { parse_mode: 'HTML' },
      );

      // Notify advertiser
      await conversation.external(() =>
        notifyUser(
          selectedDeal.advertiser.telegramId,
          formatNotification({
            emoji: '📅', title: `Post ${actionWord}`,
            dealId, channel: selectedDeal.channel.title,
            lines: [`Scheduled for: ${scheduleTime}`],
          }),
        ),
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Scheduling failed';
      await ctx.reply(`❌ Error: ${message}`);
    }
  }
}
