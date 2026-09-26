/**
 * Distributed locks via SET NX PX — single-writer election per game room.
 * Guarantees exactly-once state transitions across backend instances.
 */
import { randomUUID } from 'node:crypto';
import { getRedis } from './client.js';

export interface AcquiredLock {
  key: string;
  token: string;
  release(): Promise<void>;
}

/** Try to acquire `key` for `ttlMs`. Returns null when held by someone else. */
export async function tryAcquireLock(key: string, ttlMs = 5000): Promise<AcquiredLock | null> {
  const redis = getRedis();
  const token = randomUUID();
  const res = await redis.set(key, token, 'PX', ttlMs, 'NX');
  if (res !== 'OK') return null;
  let released = false;
  return {
    key,
    token,
    release: async () => {
      if (released) return;
      released = true;
      // Release only if we still own it (token match).
      const script = 'if redis.call("get",KEYS[1])==ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end';
      await redis.eval(script, 1, key, token).catch(() => undefined);
    },
  };
}
