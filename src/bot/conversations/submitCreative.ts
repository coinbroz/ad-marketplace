import type { Context } from 'grammy';
import type { Conversation } from '@grammyjs/conversations';
import { prisma } from '../../lib/prisma.js';
import { submitCreative } from '../../services/deals.js';
import { notifyUser } from '../../services/telegram.js';

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
  const deals = await conversation.external(() =>
    prisma.deal.findMany({
      where: {
        channelOwnerId: user.id,
        status: { in: ['FUNDED', 'CREATIVE_DRAFT'] },
      },
      include: {
        channel: { select: { title: true, username: true } },
        advertiser: { select: { firstName: true, username: true } },
      },
      orderBy: { updatedAt: 'desc' },
    }),
  );

  if (deals.length === 0) {
    await ctx.reply('No deals waiting for creative submission. Your deals must be in "Funded" or "Creative Draft" status.');
    return;
  }

  // List deals for selection
  let dealListText = '📝 <b>Select a deal to submit creative:</b>\n\n';
  const keyboard: Array<Array<{ text: string }>> = [];

  for (const deal of deals) {
    dealListText += `#${deal.id} — ${deal.channel.title} (${deal.priceInTon} TON)\n`;
    dealListText += `  Advertiser: ${deal.advertiser.firstName}\n`;
    if (deal.editComment) {
      dealListText += `  ✏️ Edit requested: ${deal.editComment}\n`;
    }
    dealListText += '\n';
    keyboard.push([{ text: `#${deal.id}` }]);
  }

  keyboard.push([{ text: 'Cancel' }]);

  await ctx.reply(dealListText, {
    parse_mode: 'HTML',
    reply_markup: { keyboard, one_time_keyboard: true, resize_keyboard: true },
  });

  // Wait for deal selection
  const dealResponse = await conversation.waitFor('message:text');
  const dealText = dealResponse.message.text;

  if (dealText === 'Cancel') {
    await ctx.reply('Cancelled.', { reply_markup: { remove_keyboard: true } });
    return;
  }

  const dealId = parseInt(dealText.replace('#', ''), 10);
  const selectedDeal = deals.find((d) => d.id === dealId);

  if (!selectedDeal) {
    await ctx.reply('Invalid deal. Please try again.', { reply_markup: { remove_keyboard: true } });
    return;
  }

  // Ask for creative text
  await ctx.reply(
    `📝 <b>Deal #${dealId} — ${selectedDeal.channel.title}</b>\n\n` +
    (selectedDeal.brief ? `Brief: ${selectedDeal.brief}\n\n` : '') +
    (selectedDeal.editComment ? `✏️ Edit comment: ${selectedDeal.editComment}\n\n` : '') +
    'Send the ad post text below.\nYou can also attach a photo or video.',
    { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } },
  );

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

  // Show preview
  let previewText = '👁 <b>Preview of your ad post:</b>\n\n';
  previewText += creativeText || '(no text)';
  if (mediaType) {
    previewText += `\n\n📎 Media: ${mediaType} attached`;
  }
  previewText += '\n\n<b>Confirm submission?</b>';

  await ctx.reply(previewText, {
    parse_mode: 'HTML',
    reply_markup: {
      keyboard: [[{ text: '✅ Submit' }, { text: '❌ Cancel' }]],
      one_time_keyboard: true,
      resize_keyboard: true,
    },
  });

  // Wait for confirmation
  const confirmResponse = await conversation.waitFor('message:text');
  const confirmText = confirmResponse.message.text;

  if (confirmText !== '✅ Submit') {
    await ctx.reply('Creative submission cancelled.', { reply_markup: { remove_keyboard: true } });
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
      `✅ <b>Creative submitted for Deal #${dealId}!</b>\n\n` +
      `Channel: ${selectedDeal.channel.title}\n` +
      `The advertiser will review your submission.`,
      { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } },
    );

    // Notify advertiser
    await conversation.external(() =>
      notifyUser(
        deal.advertiser.telegramId,
        `📝 <b>Creative submitted for review!</b>\n\n` +
        `Deal #${dealId}\n` +
        `Channel: ${deal.channel.title}\n\n` +
        `<b>Preview:</b>\n${creativeText}\n` +
        (mediaType ? `📎 ${mediaType} attached\n` : '') +
        `\nPlease review and approve or request edits.`,
      ),
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Submission failed';
    await ctx.reply(`❌ Error: ${message}`, { reply_markup: { remove_keyboard: true } });
  }
}
