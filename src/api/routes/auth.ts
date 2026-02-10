import type { FastifyInstance } from 'fastify';
import { telegramAuthHandler } from '../middleware/auth.js';

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/telegram', telegramAuthHandler);
}
