import crypto from 'node:crypto';
import { config } from '../config.js';

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
}

interface ValidatedInitData {
  user: TelegramUser;
  authDate: number;
  hash: string;
  queryId?: string;
}

/**
 * Validate Telegram WebApp initData using HMAC-SHA256.
 * See: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateInitData(initData: string): ValidatedInitData {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');

  if (!hash) {
    throw new Error('Missing hash in initData');
  }

  // Remove hash from params and sort alphabetically
  params.delete('hash');
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  // HMAC-SHA256 validation
  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(config.BOT_TOKEN)
    .digest();

  const computedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  if (computedHash !== hash) {
    throw new Error('Invalid initData signature');
  }

  // Check auth_date is not too old (allow 1 hour)
  const authDate = parseInt(params.get('auth_date') || '0', 10);
  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > 3600) {
    throw new Error('initData is expired');
  }

  const userStr = params.get('user');
  if (!userStr) {
    throw new Error('Missing user in initData');
  }

  const user: TelegramUser = JSON.parse(userStr);

  return {
    user,
    authDate,
    hash,
    queryId: params.get('query_id') || undefined,
  };
}
