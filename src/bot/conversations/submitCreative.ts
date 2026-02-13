import type { Context } from 'grammy';
import type { Conversation } from '@grammyjs/conversations';
import { prisma } from '../../lib/prisma.js';
import { submitCreative } from '../../services/deals.js';
import { notifyUser, formatNotification } from '../../services/telegram.js';
import { preselectedDeals } from '../state.js';

/**
 * Grammy conversation: channel owner submits creative for a deal.
 * Flow: select deal → send text + optional media → preview → confirm
 */
export async function submitCreativeConversation(
  conversation: Conversation<Context>,
  ctx: Context,
) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  // Find user
  const user = await conversation.external(() =>
    prisma.user.findUnique({ where: { telegramId: BigInt(telegramId) } }),
  );

  if (!user) {
    await ctx.reply('You need to register first. Use the Mini App to get started.');
    return;
  }

  // Find active deals where user is channel owner and creative is needed
  // For FUNDED deals, only show those where advertiser has already submitted a brief
  const deals = await conversation.external(() =>
    prisma.deal.findMany({
      where: {
        channelOwnerId: user.id,
        OR: [
          { status: 'FUNDED', brief: { not: null } },
          { status: 'FUNDED', briefMediaFileId: { not: null } },
          { status: 'CREATIVE_DRAFT' },
        ],
      },
      include: {
        channel: { select: { title: true, username: true } },
        advertiser: { select: { firstName: true, username: true, telegramId: true } },
      },
      orderBy: { updatedAt: 'desc' },
    }),
  );

  if (deals.length === 0) {
    await ctx.reply('No deals waiting for creative submission. Your deals must be in "Funded" or "Creative Draft" status.');
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
    let dealListText = '📝 <b>Select a deal to submit creative:</b>\n\n';
    const inlineKeyboard: Array<Array<{ text: string; callback_data: string }>> = [];

    for (const deal of deals) {
      const fmt = deal.format === 'forward' ? 'Forward' : deal.format === 'story' ? 'Story' : 'Post';
      dealListText += `#${deal.id} — ${deal.channel.title} (${fmt} · ${deal.priceInTon} TON)\n`;
      dealListText += `  Advertiser: ${deal.advertiser.firstName}\n`;
      if (deal.editComment) {
        dealListText += `  ✏️ Edit requested: ${deal.editComment}\n`;
      }
      dealListText += '\n';
      inlineKeyboard.push([{ text: `#${deal.id} — ${deal.channel.title}`, callback_data: `creative_${deal.id}` }]);
    }

    inlineKeyboard.push([{ text: '❌ Cancel', callback_data: 'creative_cancel' }]);

    await ctx.reply(dealListText, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: inlineKeyboard },
    });

    // Wait for deal selection (inline button tap)
    const dealResponse = await conversation.waitFor('callback_query:data');
    await dealResponse.answerCallbackQuery();
    const dealCallback = dealResponse.callbackQuery.data;

    if (dealCallback === 'creative_cancel') {
      await ctx.reply('Cancelled.');
      return;
    }

    dealId = parseInt(dealCallback.replace('creative_', ''), 10);
    selectedDeal = deals.find((d) => d.id === dealId) ?? null;

    if (!selectedDeal) {
      await ctx.reply('Invalid deal. Please try again.');
      return;
    }
  }

  // Show brief from advertiser
  const formatLabel = selectedDeal.format === 'forward' ? 'Forward/Repost'
    : selectedDeal.format === 'story' ? 'Story' : 'Post';
  let briefInfo = `📝 <b>Deal #${dealId} — ${selectedDeal.channel.title}</b>\n📌 Format: ${formatLabel}\n\n`;
  if (selectedDeal.brief) {
    briefInfo += `📋 <b>Advertiser's brief:</b>\n${selectedDeal.brief}\n\n`;
  }
  if (selectedDeal.editComment) {
    briefInfo += `✏️ <b>Edit comment:</b> ${selectedDeal.editComment}\n\n`;
  }

  await ctx.reply(briefInfo, { parse_mode: 'HTML' });

  // If advertiser attached media, forward it to the channel owner for reference
  if (selectedDeal.briefMediaFileId && selectedDeal.briefMediaType) {
    try {
      const chatId = ctx.chat?.id;
      if (chatId) {
        if (selectedDeal.briefMediaType === 'photo') {
          await ctx.api.sendPhoto(chatId, selectedDeal.briefMediaFileId, { caption: '📎 Advertiser\'s reference material' });
        } else if (selectedDeal.briefMediaType === 'video') {
          await ctx.api.sendVideo(chatId, selectedDeal.briefMediaFileId, { caption: '📎 Advertiser\'s reference material' });
        } else if (selectedDeal.briefMediaType === 'document') {
          await ctx.api.sendDocument(chatId, selectedDeal.briefMediaFileId, { caption: '📎 Advertiser\'s reference material' });
        }
      }
    } catch {
      // Media might have expired, continue without it
    }
  }

  // Clear instruction AFTER all materials are shown (format-specific)
  let creativeInstruction: string;
  if (selectedDeal.format === 'forward') {
    creativeInstruction =
      '✏️ <b>Prepare the message for forwarding.</b>\n\n' +
      'Send the exact message that will be forwarded/reposted to the channel. ' +
      'You can attach a photo or video.\n\n' +
      'This will be sent to the advertiser for approval.';
  } else if (selectedDeal.format === 'story') {
    creativeInstruction =
      '✏️ <b>Create the Story content.</b>\n\n' +
      'Send a photo or video for the Telegram Story. ' +
      'You can add a caption.\n\n' +
      'This will be sent to the advertiser for approval.';
  } else {
    creativeInstruction =
      '✏️ <b>Now create the ad post.</b>\n\n' +
      'Send a message with the post text exactly as it should appear in the channel. ' +
      'You can attach a photo or video to your message.\n\n' +
      'This will be sent to the advertiser for approval.';
  }

  await ctx.reply(creativeInstruction, { parse_mode: 'HTML' });

  // Wait for creative content (text, photo, video, or document)
  const creativeResponse = await conversation.waitFor([
    'message:text',
    'message:photo',
    'message:video',
    'message:document',
  ]);

  const msg = creativeResponse.message;
  let creativeText = '';
  let mediaType: string | undefined;
  let mediaFileId: string | undefined;

  if (msg.photo) {
    // Photo — get the largest version
    const photo = msg.photo[msg.photo.length - 1];
    mediaType = 'photo';
    mediaFileId = photo.file_id;
    creativeText = msg.caption || '';
  } else if (msg.video) {
    mediaType = 'video';
    mediaFileId = msg.video.file_id;
    creativeText = msg.caption || '';
  } else if (msg.document) {
    mediaType = 'document';
    mediaFileId = msg.document.file_id;
    creativeText = msg.caption || '';
  } else if (msg.text) {
    creativeText = msg.text;
  }

  if (!creativeText && !mediaFileId) {
    await ctx.reply('No content received. Please try again with /submitcreative');
    return;
  }

  // Show preview with inline confirmation buttons
  let previewText = '👁 <b>Preview of your ad post:</b>\n\n';
  previewText += creativeText || '(no text)';
  if (mediaType) {
    previewText += `\n\n📎 Media: ${mediaType} attached`;
  }
  previewText += '\n\n<b>Confirm submission?</b>';

  await ctx.reply(previewText, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Submit', callback_data: 'creative_confirm' },
          { text: '❌ Cancel', callback_data: 'creative_reject' },
        ],
      ],
    },
  });

  // Wait for confirmation
  const confirmResponse = await conversation.waitFor('callback_query:data');
  await confirmResponse.answerCallbackQuery();

  if (confirmResponse.callbackQuery.data !== 'creative_confirm') {
    await ctx.reply('Creative submission cancelled.');
    return;
  }

  // Submit creative
  try {
    const deal = await conversation.external(() =>
      submitCreative(dealId, user.id, {
        text: creativeText,
        mediaType,
        mediaFileId,
      }),
    );

    await ctx.reply(
      formatNotification({
        emoji: '✅', title: 'Creative submitted',
        dealId, channel: selectedDeal.channel.title,
        hint: 'The advertiser will review your submission.',
      }),
      { parse_mode: 'HTML' },
    );

    // Notify advertiser — send creative preview with media
    const advertiserTgId = Number(deal.advertiser.telegramId);
    await conversation.external(async () => {
      const { bot: botInstance } = await import('../index.js');

      // Send the actual media with creative text as caption (if media exists)
      if (mediaFileId && mediaType) {
        const caption = (creativeText || '') +
          `\n\n—\n📝 <b>Creative for Deal #${dealId}</b>\nChannel: ${deal.channel.title}`;
        if (mediaType === 'photo') {
          await botInstance.api.sendPhoto(advertiserTgId, mediaFileId, { caption, parse_mode: 'HTML' });
        } else if (mediaType === 'video') {
          await botInstance.api.sendVideo(advertiserTgId, mediaFileId, { caption, parse_mode: 'HTML' });
        } else if (mediaType === 'document') {
          await botInstance.api.sendDocument(advertiserTgId, mediaFileId, { caption, parse_mode: 'HTML' });
        }
      } else {
        // Text-only creative
        await notifyUser(
          deal.advertiser.telegramId,
          formatNotification({
            emoji: '📝', title: 'Creative preview',
            dealId, channel: deal.channel.title,
            lines: [`<b>Post preview:</b>`, creativeText],
          }),
        );
      }

      // Follow-up with clear action instructions
      await notifyUser(
        deal.advertiser.telegramId,
        formatNotification({
          emoji: '👆', title: 'Review creative',
          dealId, channel: deal.channel.title,
          lines: [
            `✅ <b>Approve</b> — post goes to the channel`,
            `✏️ <b>Request Edits</b> — send feedback`,
          ],
        }),
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '📋 Open Deal', web_app: { url: `${(await import('../../config.js')).config.WEBAPP_URL}/deals/${dealId}` } }],
            ],
          },
        },
      );
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Submission failed';
    await ctx.reply(`❌ Error: ${message}`);
  }
}
