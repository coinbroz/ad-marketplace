import type { FastifyInstance } from 'fastify';
import { authRoutes } from './routes/auth.js';
import { channelRoutes } from './routes/channels.js';
import { campaignRoutes } from './routes/campaigns.js';
import { dealRoutes } from './routes/deals.js';
import { requireAuth } from './middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { config } from '../config.js';

export async function registerRoutes(app: FastifyInstance) {
  // Health check (no auth)
  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

  // App config (public, needed by frontend for TON network)
  app.get('/api/config', async () => ({
    tonNetwork: config.TON_NETWORK,
  }));

  // Auth routes (no auth required)
  await app.register(authRoutes);

  // Protected API routes
  await app.register(channelRoutes);
  await app.register(campaignRoutes);
  await app.register(dealRoutes);

  // User profile
  app.get('/api/user/me', { preHandler: [requireAuth] }, async (request) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: request.userId },
      include: {
        channels: {
          where: { isActive: true },
          include: { prices: true },
        },
        campaigns: {
          where: { status: { not: 'CANCELLED' } },
        },
      },
    });

    return JSON.parse(
      JSON.stringify(user, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value,
      ),
    );
  });

  // Update TON wallet address
  app.put('/api/user/me/wallet', { preHandler: [requireAuth] }, async (request) => {
    const { address } = request.body as { address: string };

    return prisma.user.update({
      where: { id: request.userId },
      data: { tonWalletAddress: address },
      select: { id: true, tonWalletAddress: true },
    });
  });
}
