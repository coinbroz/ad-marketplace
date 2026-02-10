import type { FastifyRequest, FastifyReply } from 'fastify';
import { validateInitData } from '../../utils/telegram-auth.js';
import { prisma } from '../../lib/prisma.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId: number;
    telegramId: bigint;
  }
}

/**
 * POST /api/auth/telegram
 * Validates Telegram WebApp initData, creates/updates user, returns JWT.
 */
export async function telegramAuthHandler(
  request: FastifyRequest<{ Body: { initData: string } }>,
  reply: FastifyReply,
) {
  const { initData } = request.body;

  if (!initData) {
    return reply.status(400).send({ error: 'initData is required' });
  }

  try {
    const validated = validateInitData(initData);
    const tgUser = validated.user;

    // Upsert user in database
    const user = await prisma.user.upsert({
      where: { telegramId: BigInt(tgUser.id) },
      update: {
        username: tgUser.username || null,
        firstName: tgUser.first_name,
        lastName: tgUser.last_name || null,
      },
      create: {
        telegramId: BigInt(tgUser.id),
        username: tgUser.username || null,
        firstName: tgUser.first_name,
        lastName: tgUser.last_name || null,
      },
    });

    // Sign JWT
    const token = request.server.jwt.sign({
      userId: user.id,
      telegramId: tgUser.id.toString(),
    });

    return reply.send({
      token,
      user: {
        id: user.id,
        telegramId: tgUser.id.toString(),
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        tonWalletAddress: user.tonWalletAddress,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Authentication failed';
    request.log.warn({ err }, 'Auth failed');
    return reply.status(401).send({ error: message });
  }
}

/**
 * Fastify preHandler hook: require valid JWT.
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    const payload = await request.jwtVerify<{ userId: number; telegramId: string }>();
    request.userId = payload.userId;
    request.telegramId = BigInt(payload.telegramId);
  } catch {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
}
