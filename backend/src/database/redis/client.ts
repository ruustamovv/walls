/**
 * Shared Redis client (ioredis, lazy connect).
 * Redis is REQUIRED for matchmaking/presence/locks in production, but the
 * backend boots in degraded mode when unreachable (probes report it).
 */
import Redis from 'ioredis';
import { logger } from '../../common/logging/logger.js';

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (redis !== null) return redis;
  const url = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2, enableReadyCheck: true });
  redis.on('error', (err) => logger.warn({ err: String(err) }, 'Redis error'));
  return redis;
}

export async function connectRedis(): Promise<boolean> {
  try {
    const r = getRedis();
    if (r.status === 'ready') return true;
    await r.ping();
    if ((r.status as string) !== 'ready') await r.connect().catch(() => undefined);
    await r.ping();
    return true;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Redis unavailable — degraded mode');
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  if (redis !== null) {
    try {
      redis.disconnect();
    } catch {
      // ignore
    }
    redis = null;
  }
}

/** Test helper. */
export function __resetRedisForTests(): void {
  redis = null;
}
