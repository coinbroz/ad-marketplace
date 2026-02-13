import type { Context } from 'grammy';
import type { Conversation } from '@grammyjs/conversations';
import { prisma } from '../../lib/prisma.js';
import { notifyUser, formatNotification } from '../../services/telegram.js';
import { preselectedDeals } from '../state.js';

/**
 * Grammy conversation: advertiser submits ad brief/materials for a deal.
 * Flow: select deal → send text + optional media → confirm → notify channel owner
 */
export async function submitBriefConversation(
  conversation: Conversation<Context>,
  ctx: Context,
) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const user = await conversation.external(() =>
    prisma.user.findUnique({ where: { telegramId: BigInt(telegramId) } }),
  );

  if (!user) {
    await ctx.reply('You need to register first. Use the Mini App to get started.');
    return;
  }

  // Find funded deals where user is advertiser
  const deals = await conversation.external(() =>
    prisma.deal.findMany({
      where: {
        advertiserId: user.id,
        status: 'FUNDED',
      },
      include: {
        channel: { select: { title: true, username: true } },
        channelOwner: { select: { telegramId: true, firstName: true } },
      },
      orderBy: { updatedAt: 'desc' },
    }),
  );

  if (deals.length === 0) {
    await ctx.reply('No funded deals waiting for your brief. Your deals must be in "Funded" status.');
    return;
  }

  // Check for preselected deal from deep link (Mini App → bot)
  const preselectedId = await conversation.external(() => {
    const id = preselectedDeals.get(telegramId!);
    if (id !== undefined) preselectedDeals.delete(telegramId!);
    return id ?? null;
  });

  let dealId: number;
  let selectedDeal = preselectedId ? deals.find((d) => d.id === preselectedId) : null;

  if (selectedDeal) {
    dealId = preselectedId!;
  } else {
    // List deals for selection (inline keyboard — always visible in the message)
    let dealListText = '📋 <b>Select a deal to submit your ad brief:</b>\n\n';
    const inlineKeyboard: Array<Array<{ text: string; callback_data: string }>> = [];

    for (const deal of deals) {
      dealListText += `#${deal.id} — ${deal.channel.title} (${deal.priceInTon} TON)\n`;
      if (deal.brief) {
        dealListText += `  Current brief: ${deal.brief.slice(0, 50)}...\n`;
      }
      dealListText += '\n';
      inlineKeyboard.push([{ text: `#${deal.id} — ${deal.channel.title}`, callback_data: `brief_${deal.id}` }]);
    }

    inlineKeyboard.push([{ text: '❌ Cancel', callback_data: 'brief_cancel' }]);

    await ctx.reply(dealListText, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: inlineKeyboard },
    });

    // Wait for deal selection (inline button tap)
    const dealResponse = await conversation.waitFor('callback_query:data');
    await dealResponse.answerCallbackQuery();
    const dealCallback = dealResponse.callbackQuery.data;

    if (dealCallback === 'brief_cancel') {
      await ctx.reply('Cancelled.');
      return;
    }

    dealId = parseInt(dealCallback.replace('brief_', ''), 10);
    selectedDeal = deals.find((d) => d.id === dealId) ?? null;

    if (!selectedDeal) {
      await ctx.reply('Invalid deal. Please try again.');
      return;
    }
  }

  // Ask for brief content
  await ctx.reply(
    `📋 <b>Deal #${dealId} — ${selectedDeal.channel.title}</b>\n\n` +
    'Send your ad brief below: describe what you want to advertise, key messages, requirements.\n\n' +
    'You can attach a photo, video, or document with your materials.',
    { parse_mode: 'HTML' },
  );

  // Wait for brief content
  const briefResponse = await conversation.waitFor([
    'message:text',
    'message:photo',
    'message:video',
    'message:document',
  ]);

  const msg = briefResponse.message;
  let briefText = '';
  let mediaType: string | undefined;
  let mediaFileId: string | undefined;

  if (msg.photo) {
    const photo = msg.photo[msg.photo.length - 1];
    mediaType = 'photo';
    mediaFileId = photo.file_id;
    briefText = msg.caption || '';
  } else if (msg.video) {
    mediaType = 'video';
    mediaFileId = msg.video.file_id;
    briefText = msg.caption || '';
  } else if (msg.document) {
    mediaType = 'document';
    mediaFileId = msg.document.file_id;
    briefText = msg.caption || '';
  } else if (msg.text) {
    briefText = msg.text;
  }

  if (!briefText && !mediaFileId) {
    await ctx.reply('No content received. Please try again with /submitbrief');
    return;
  }

  // Show preview with inline confirmation buttons
  let previewText = '👁 <b>Preview of your ad brief:</b>\n\n';
  previewText += briefText || '(no text)';
  if (mediaType) {
    previewText += `\n\n📎 Media: ${mediaType} attached`;
  }
  previewText += '\n\n<b>Send this to the channel owner?</b>';

  await ctx.reply(previewText, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Send', callback_data: 'brief_confirm' },
          { text: '❌ Cancel', callback_data: 'brief_reject' },
        ],
      ],
    },
  });

  // Wait for confirmation
  const confirmResponse = await conversation.waitFor('callback_query:data');
  await confirmResponse.answerCallbackQuery();

  if (confirmResponse.callbackQuery.data !== 'brief_confirm') {
    await ctx.reply('Brief submission cancelled.');
    return;
  }

  // Save brief to deal
  try {
    await conversation.external(() =>
      prisma.deal.update({
        where: { id: dealId },
        data: {
          brief: briefText || selectedDeal.brief,
          briefMediaType: mediaType || null,
          briefMediaFileId: mediaFileId || null,
        },
      }),
    );

    await ctx.reply(
      formatNotification({
        emoji: '✅', title: 'Brief sent',
        dealId, channel: selectedDeal.channel.title,
        hint: 'The channel owner will create a post based on your brief.',
      }),
      { parse_mode: 'HTML' },
    );

    // Notify channel owner with brief
    const notifyText = formatNotification({
      emoji: '📋', title: 'Ad brief received',
      dealId, channel: selectedDeal.channel.title,
      lines: [
        `From: ${user.firstName}`,
        '',
        `<b>Brief:</b>`,
        briefText,
        ...(mediaType ? [``, `📎 ${mediaType} attached`] : []),
      ],
      hint: 'Please create the ad post: use /submitcreative',
    });

    await conversation.external(() =>
      notifyUser(selectedDeal.channelOwner.telegramId, notifyText),
    );

    // If media was attached, forward it to the channel owner
    if (mediaFileId && mediaType) {
      const ownerTgId = Number(selectedDeal.channelOwner.telegramId);
      await conversation.external(async () => {
        const { bot } = await import('../index.js');
        if (mediaType === 'photo') {
          await bot.api.sendPhoto(ownerTgId, mediaFileId!, { caption: `📎 Brief media for Deal #${dealId}` });
        } else if (mediaType === 'video') {
          await bot.api.sendVideo(ownerTgId, mediaFileId!, { caption: `📎 Brief media for Deal #${dealId}` });
        } else if (mediaType === 'document') {
          await bot.api.sendDocument(ownerTgId, mediaFileId!, { caption: `📎 Brief media for Deal #${dealId}` });
        }
      });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Submission failed';
    await ctx.reply(`❌ Error: ${message}`);
  }
}
