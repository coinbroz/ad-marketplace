import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { config, isDev } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { prisma } from './lib/prisma.js';
import { redis } from './lib/redis.js';
import { bot, botWebhookCallback } from './bot/index.js';
import { registerRoutes } from './api/index.js';
import { startPaymentMonitor, paymentMonitorWorker } from './workers/payment-monitor.js';
import { startDealTimeout, dealTimeoutWorker } from './workers/deal-timeout.js';
import { startPostVerifier, postVerifierWorker } from './workers/post-verifier.js';
import { disconnectMTProto } from './services/mtproto.js';

const isProd = config.NODE_ENV === 'production';

async function main() {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport: isDev
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
      redact: ['headers.authorization'],
    },
  });

  // ── Handle empty JSON body gracefully ────────────────
  // PUT/POST with Content-Type: application/json but no body
  // should not cause 400 Bad Request.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    try {
      const str = (body as string).trim();
      done(null, str ? JSON.parse(str) : undefined);
    } catch (err) {
      done(err as Error, undefined);
    }
  });
  app.addContentTypeParser('*', (_req, _payload, done) => {
    done(null, undefined);
  });

  // ── Global BigInt serializer ──────────────────────────
  // Prisma returns BigInt for telegramId fields. JSON.stringify
  // fails on BigInt, so we override the serializer globally.
  app.setReplySerializer((payload) => {
    return JSON.stringify(payload, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
  });

  // ── Plugins ────────────────────────────────────────────

  await app.register(cors, {
    origin: isDev ? true : config.WEBAPP_URL,
  });

  await app.register(jwt, {
    secret: config.BOT_TOKEN,
  });

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    redis,
  });

  // ── Bot Webhook ────────────────────────────────────────

  app.post('/webhook', botWebhookCallback);

  // ── API Routes ─────────────────────────────────────────

  await registerRoutes(app);

  // ── Static files (Mini App) ────────────────────────────

  const webDistPath = path.join(__dirname, '../web/dist');
  await app.register(fastifyStatic, {
    root: webDistPath,
    prefix: '/',
    wildcard: false,
  });

  // SPA fallback: serve index.html for non-API routes
  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/') || request.url === '/webhook' || request.url === '/health') {
      return reply.status(404).send({ error: 'Not found' });
    }
    return reply.sendFile('index.html');
  });

  // ── Start BullMQ Workers ──────────────────────────────

  await startPaymentMonitor();
  await startDealTimeout();
  await startPostVerifier();

  // ── Graceful Shutdown ──────────────────────────────────

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down gracefully...`);

    // 1. Stop accepting new requests
    await app.close();

    // 2. Close BullMQ workers
    await paymentMonitorWorker.close();
    await postVerifierWorker.close();
    await dealTimeoutWorker.close();

    // 3. Disconnect MTProto
    await disconnectMTProto();

    // 4. Close Redis connections
    await redis.quit();

    // 5. Close Prisma connection
    await prisma.$disconnect();

    app.log.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // ── Set Webhook ────────────────────────────────────────

  if (isProd) {
    const webhookUrl = `${config.WEBAPP_URL}/webhook`;
    await bot.api.setWebhook(webhookUrl);
    app.log.info(`Bot webhook set to ${webhookUrl}`);
  }

  // Register bot commands in Telegram menu
  await bot.api.setMyCommands([
    { command: 'start', description: 'Open the marketplace' },
    { command: 'mydeals', description: 'View your active deals' },
    { command: 'addchannel', description: 'Add your channel to marketplace' },
    { command: 'submitbrief', description: 'Send ad brief (advertiser)' },
    { command: 'submitcreative', description: 'Submit creative (channel owner)' },
    { command: 'schedulepost', description: 'Schedule/publish post' },
    { command: 'help', description: 'Show help' },
  ]);

  // ── Start Server ───────────────────────────────────────

  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    app.log.info(`Server running on port ${config.PORT}`);
    app.log.info(`Environment: ${config.NODE_ENV}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
