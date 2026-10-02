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
  redis = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    // Short connect timeout + capped backoff: when Redis is simply absent the
    // client must give up in a second or two instead of retrying for ~20s and
    // stalling the whole boot. Redis is optional (sessions fall back to a
    // process-local store), so a fast, quiet degrade beats a slow, loud one.
    connectTimeout: 1500,
    retryStrategy: (times: number): number | null => (times > 2 ? null : Math.min(150 * times, 400)),
  });
  // One quiet warning instead of a storm: an absent Redis is a known,
  // supported state, not an incident worth a log line per retry.
  let warnedUnavailable = false;
  redis.on('error', (err) => {
    if (!warnedUnavailable) {
      warnedUnavailable = true;
      logger.warn({ err: String(err) }, 'Redis unavailable — running degraded');
    }
  });
  return redis;
}

export async function connectRedis(timeoutMs = 2000): Promise<boolean> {
  const r = getRedis();
  if (r.status === 'ready') return true;
  try {
    await Promise.race([
      (async () => {
        await r.ping();
        if ((r.status as string) !== 'ready') await r.connect().catch(() => undefined);
        await r.ping();
      })(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('redis connect timeout')), Math.max(100, timeoutMs));
      }),
    ]);
    return true;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Redis unavailable — degraded mode');
    // Drop the half-open singleton so its retry storm can neither hang
    // probes nor keep test runners alive; the next call starts fresh.
    try {
      r.disconnect();
    } catch {
      // ignore
    }
    redis = null;
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
