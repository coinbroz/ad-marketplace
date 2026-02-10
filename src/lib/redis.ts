import Redis from 'ioredis';
import { config } from '../config.js';

export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null, // Required for BullMQ
});

export const redisSubscriber = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
});
