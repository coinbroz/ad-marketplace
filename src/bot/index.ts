import { Bot, webhookCallback, GrammyError, HttpError, session } from 'grammy';
import { conversations, createConversation } from '@grammyjs/conversations';
import type { Context, SessionFlavor } from 'grammy';
import type { ConversationFlavor } from '@grammyjs/conversations';
import { config } from '../config.js';
import { prisma } from '../lib/prisma.js';
import { submitBriefConversation } from './conversations/submitBrief.js';
import { submitCreativeConversation } from './conversations/submitCreative.js';
import { schedulePostConversation } from './conversations/schedulePost.js';
import crypto from 'node:crypto';

// ── Types ──────────────────────────────────────────────────

interface SessionData {
  // Empty for now, required by conversations plugin
}

export type BotContext = Context & SessionFlavor<SessionData> & ConversationFlavor<Context>;

export const bot = new Bot<BotContext>(config.BOT_TOKEN);

// ── Middleware ──────────────────────────────────────────────

// Session (required for conversations)
bot.use(session({ initial: (): SessionData => ({}) }));

// Conversations plugin
bot.use(conversations());
bot.use(createConversation(submitBriefConversation, 'submitBrief'));
bot.use(createConversation(submitCreativeConversation, 'submitCreative'));
bot.use(createConversation(schedulePostConversation, 'schedulePost'));

// Error handler
bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`Error while handling update ${ctx.update.update_id}:`);
  const e = err.error;
  if (e instanceof GrammyError) {
    console.error('Grammy error:', e.description);
  } else if (e instanceof HttpError) {
    console.error('HTTP error:', e);
  } else {
    console.error('Unknown error:', e);
  }
});

// ── Commands ───────────────────────────────────────────────

bot.command('start', async (ctx) => {
  // Deep link support: /start submitbrief → enter submitBrief conversation
  const param = ctx.match?.trim().toLowerCase();
  const conversationMap: Record<string, string> = {
    submitbrief: 'submitBrief',
    submitcreative: 'submitCreative',
    schedulepost: 'schedulePost',
  };
  if (param && conversationMap[param]) {
    await ctx.conversation.enter(conversationMap[param]);
    return;
  }

  const webAppUrl = config.WEBAPP_URL;
  await ctx.reply(
    '👋 Welcome to Ad Marketplace!\n\n' +
    'Connect with channel owners or advertisers for seamless ad deals with TON escrow.\n\n' +
    'Use the button below to open the marketplace:',
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🏪 Open Marketplace', web_app: { url: webAppUrl } }],
        ],
      },
    },
  );
});

bot.command('help', async (ctx) => {
  await ctx.reply(
    '📖 Available commands:\n\n' +
    '/start — Open the marketplace\n' +
    '/help — Show this help message\n' +
    '/mydeals — View your active deals\n' +
    '/addchannel — Add your channel to the marketplace\n' +
    '/mycampaigns — View your campaigns\n' +
    '/submitbrief — Send your ad brief/materials (advertiser)\n' +
    '/submitcreative — Submit ad creative for a deal (channel owner)\n' +
    '/schedulepost — Schedule, reschedule, or publish a post\n\n' +
    'Use the Mini App for full marketplace experience!',
  );
});

bot.command('mydeals', async (ctx) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
  });

  if (!user) {
    await ctx.reply('Please use the Mini App first to register.');
    return;
  }

  const deals = await prisma.deal.findMany({
    where: {
      OR: [
        { advertiserId: user.id },
        { channelOwnerId: user.id },
      ],
      status: { notIn: ['COMPLETED', 'CANCELLED', 'EXPIRED', 'REFUNDED'] },
    },
    include: {
      channel: { select: { title: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 10,
  });

  if (deals.length === 0) {
    await ctx.reply('No active deals.', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🏪 Open Marketplace', web_app: { url: config.WEBAPP_URL } }],
        ],
      },
    });
    return;
  }

  let text = '📋 <b>Your active deals:</b>\n\n';
  for (const deal of deals) {
    const role = deal.advertiserId === user.id ? '📢 Advertiser' : '📺 Channel Owner';
    text += `#${deal.id} — ${deal.channel.title}\n`;
    text += `  ${role} | ${deal.status} | ${deal.priceInTon} TON\n\n`;
  }

  await ctx.reply(text, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '📋 View in App', web_app: { url: `${config.WEBAPP_URL}/deals` } }],
      ],
    },
  });
});

bot.command('mycampaigns', async (ctx) => {
  await ctx.reply('📢 Use the Mini App to manage your campaigns.', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📢 Campaigns', web_app: { url: config.WEBAPP_URL } }],
      ],
    },
  });
});

bot.command('addchannel', async (ctx) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
  });

  if (!user) {
    await ctx.reply('Please open the Mini App first to register.');
    return;
  }

  const args = ctx.match?.trim().split(/\s+/) || [];
  const username = args[0]?.replace('@', '');
  const language = args.slice(1).join(' ') || undefined;

  if (!username) {
    await ctx.reply(
      '📺 <b>Add a channel</b>\n\n' +
      '1. Add @channelescrow_bot as <b>admin</b> to your channel\n' +
      '2. Send: /addchannel @yourchannel [language]\n\n' +
      'Examples:\n' +
      '<code>/addchannel @mychannel</code>\n' +
      '<code>/addchannel @mychannel English</code>\n' +
      '<code>/addchannel @mychannel Russian</code>',
      { parse_mode: 'HTML' },
    );
    return;
  }

  try {
    const { addChannel } = await import('../services/channels.js');
    const channel = await addChannel({ ownerId: user.id, username, language });
    await ctx.reply(
      `✅ Channel <b>${channel.title}</b> added!\n` +
      `Subscribers: ${channel.subscriberCount.toLocaleString()}\n` +
      `Bot is admin: ${channel.botIsAdmin ? 'Yes ✅' : 'No ❌'}\n\n` +
      `${!channel.botIsAdmin ? '⚠️ Please add the bot as admin to enable auto-posting.' : 'You can now set prices in the Mini App.'}`,
      { parse_mode: 'HTML' },
    );
  } catch (err: any) {
    await ctx.reply(`❌ Error: ${err.message}`);
  }
});

// ── Conversation commands ──────────────────────────────────

bot.command('submitbrief', async (ctx) => {
  await ctx.conversation.enter('submitBrief');
});

bot.command('submitcreative', async (ctx) => {
  await ctx.conversation.enter('submitCreative');
});

bot.command('schedulepost', async (ctx) => {
  await ctx.conversation.enter('schedulePost');
});

// ── Callback query handlers (inline buttons in notifications) ──

bot.callbackQuery('cmd_submitbrief', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.conversation.enter('submitBrief');
});

bot.callbackQuery('cmd_submitcreative', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.conversation.enter('submitCreative');
});

bot.callbackQuery('cmd_schedulepost', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.conversation.enter('schedulePost');
});

// ── Edited channel post handler (post edit detection) ──────

bot.on('edited_channel_post', async (ctx) => {
  const post = ctx.editedChannelPost;
  const channelTelegramId = post.chat.id;
  const messageId = post.message_id;

  // Find deal for this channel + message
  const deal = await prisma.deal.findFirst({
    where: {
      postMessageId: messageId,
      channel: { telegramId: BigInt(channelTelegramId) },
      status: 'POSTED',
    },
    include: {
      channel: { select: { title: true } },
      advertiser: { select: { telegramId: true } },
      channelOwner: { select: { telegramId: true } },
    },
  });

  if (!deal) return; // Not a tracked post

  // Generate hash of the edited content
  const editedText = post.text || post.caption || '';
  const editedHash = crypto.createHash('sha256')
    .update(`${editedText}|`)
    .digest('hex');

  // Compare with original hash
  if (deal.postContentHash && editedHash !== deal.postContentHash) {
    // Content was modified
    await prisma.deal.update({
      where: { id: deal.id },
      data: { postEditedAt: new Date() },
    });

    await prisma.dealEvent.create({
      data: {
        dealId: deal.id,
        type: 'post_edit',
        data: {
          detectedAt: new Date().toISOString(),
          originalHash: deal.postContentHash,
          newHash: editedHash,
        },
      },
    });

    // Notify advertiser
    const { notifyUser, formatNotification } = await import('../services/telegram.js');
    await notifyUser(
      deal.advertiser.telegramId,
      formatNotification({
        emoji: '⚠️', title: 'Post edited',
        dealId: deal.id, channel: deal.channel.title,
        hint: 'The published ad post was modified. Please review.',
      }),
    );

    // Also notify channel owner
    await notifyUser(
      deal.channelOwner.telegramId,
      formatNotification({
        emoji: '⚠️', title: 'Post edit detected',
        dealId: deal.id, channel: deal.channel.title,
        hint: 'Editing published posts may affect fund release.',
      }),
    );
  }
});

// ── Webhook callback for Fastify ──────────────────────────

export const botWebhookCallback = webhookCallback(bot, 'fastify');
