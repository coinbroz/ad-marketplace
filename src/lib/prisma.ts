import { PrismaClient } from '@prisma/client';
import { isDev } from '../config.js';

export const prisma = new PrismaClient({
  log: isDev ? ['query', 'error', 'warn'] : ['error'],
});
