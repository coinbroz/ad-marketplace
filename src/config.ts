import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  // Telegram Bot
  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN is required'),
  WEBAPP_URL: z.string().url('WEBAPP_URL must be a valid URL'),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  // TON
  TON_NETWORK: z.enum(['mainnet', 'testnet']).default('mainnet'),
  TON_API_KEY: z.string().default(''),
  ESCROW_ENCRYPTION_KEY: z.string().min(32, 'ESCROW_ENCRYPTION_KEY must be at least 32 characters'),
  HOT_WALLET_MNEMONIC: z.string().default(''),

  // Telegram MTProto
  TELEGRAM_API_ID: z.string().default(''),
  TELEGRAM_API_HASH: z.string().default(''),
  TELEGRAM_SESSION: z.string().default(''),

  // App
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PLATFORM_FEE_PERCENT: z.coerce.number().min(0).max(100).default(0),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

function loadConfig() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Invalid environment variables:');
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }

  return result.data;
}

export const config = loadConfig();

// Derived constants
export const isDev = config.NODE_ENV === 'development';
export const isProd = config.NODE_ENV === 'production';

// TON network endpoint
export const TON_ENDPOINT = config.TON_NETWORK === 'mainnet'
  ? 'https://toncenter.com/api/v2'
  : 'https://testnet.toncenter.com/api/v2';

// Deal timeouts (in hours)
export const DEAL_TIMEOUTS: Record<string, number> = {
  PENDING: 24,
  ACCEPTED: 24,
  AWAITING_PAYMENT: 24,
  FUNDED: 24,
  CREATIVE_DRAFT: 24,
  CREATIVE_REVIEW: 24,
  CREATIVE_APPROVED: 24,
  SCHEDULED: 24,
};

// Post verification period (hours)
export const POST_VERIFICATION_HOURS = 24;

// Worker intervals (milliseconds)
export const PAYMENT_MONITOR_INTERVAL = 60_000;     // 60 seconds
export const POST_VERIFIER_INTERVAL = 5 * 60_000;   // 5 minutes
export const DEAL_TIMEOUT_INTERVAL = 5 * 60_000;    // 5 minutes
export const STATS_UPDATER_INTERVAL = 6 * 3600_000; // 6 hours

// Gas reserve for escrow wallet transactions
export const GAS_RESERVE_TON = 0.05;
