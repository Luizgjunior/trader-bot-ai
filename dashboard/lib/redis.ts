import Redis from 'ioredis';

const globalForRedis = globalThis as unknown as { redis?: Redis };

export const redis = globalForRedis.redis ?? new Redis(process.env.REDIS_URL!, {
  tls: process.env.REDIS_URL?.startsWith('rediss://') ? {} : undefined,
  maxRetriesPerRequest: 3,
  lazyConnect: false,
});

if (process.env.NODE_ENV !== 'production') globalForRedis.redis = redis;
