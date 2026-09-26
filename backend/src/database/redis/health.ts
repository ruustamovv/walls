/**
 * Redis health probe + lightweight pub/sub helpers.
 */
import { getRedis } from './client.js';

export interface RedisHealth {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

export async function checkRedisHealth(): Promise<RedisHealth> {
  const started = Date.now();
  try {
    await getRedis().ping();
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' };
  }
}

export async function publish(channel: string, message: string): Promise<void> {
  await getRedis().publish(channel, message).catch(() => undefined);
}
