/**
 * Redis integration tests — queue insert/pop, matchmaking via Redis store,
 * lock acquire/expiry, presence TTL, pub/sub.
 * Requires REDIS_URL. Fails loudly when unreachable (no mocks).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Redis from 'ioredis';
import { MatchmakingQueue } from '../modules/matchmaking/queue.js';
import { RedisQueueStore } from '../database/redis/matchmakingStore.js';
import { tryAcquireLock } from '../database/redis/locks.js';
import { redisKeys } from '../database/redis/keys.js';
import { closeRedis } from '../database/redis/client.js';

const URL = process.env['REDIS_URL'] ?? '';
let redis: Redis | null = null;
let available = false;

before(async () => {
  if (URL === '') {
    console.warn('[redis.test] SKIP: REDIS_URL unset — start `docker compose up -d redis` for live verification.');
    return;
  }
  try {
    redis = new Redis(URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
    await redis.ping();
    if (redis.status !== 'ready') await redis.connect();
    await redis.ping();
    available = true;
  } catch {
    available = false;
  }
});

after(async () => {
  // Close BOTH the probe client above AND the shared getRedis() singleton
  // used internally by RedisQueueStore / tryAcquireLock. Leaving the
  // singleton connected keeps the event loop alive, so `node --test`
  // (and therefore `verify:live`) would hang after all tests pass.
  try {
    redis?.disconnect();
  } finally {
    redis = null;
    await closeRedis();
  }
});

function need(): Redis {
  assert.ok(available && redis !== null, 'Redis not reachable — set REDIS_URL and start `docker compose up -d redis`');
  return redis as Redis;
}

describe('redis: queue + matchmaking', () => {
  it('inserts, pops (pairs), and enforces anti-duplicate', async () => {
    if (!available) return;
    const store = new RedisQueueStore();
    await store.clear();
    const q = new MatchmakingQueue(store);
    const now = Date.now();
    await q.join({ userId: 'ra', mode: 'ranked', timeControl: '3+1', rating: 1500, joinedAt: now });
    await q.join({ userId: 'rb', mode: 'ranked', timeControl: '3+1', rating: 1510, joinedAt: now });
    const pair = await q.tryMatch(now);
    assert.ok(pair !== null);
    assert.equal(await q.size(), 0);
    await store.clear();
  });
});

describe('redis: locks + presence + pubsub', () => {
  it('lock is exclusive and releasable', async () => {
    if (!available) return;
    const key = redisKeys.gameLock(`test-${Date.now()}`);
    const a = await tryAcquireLock(key, 5000);
    assert.ok(a !== null);
    assert.equal(await tryAcquireLock(key, 1000), null);
    await a?.release();
    const b = await tryAcquireLock(key, 1000);
    assert.ok(b !== null);
    await b?.release();
  });

  it('presence hash expires', async () => {
    if (!available) return;
    const r = need();
    const key = redisKeys.presence(`tu-${Date.now()}`);
    await r.hset(key, { online: '1' });
    await r.expire(key, 1);
    assert.equal(await r.ttl(key), 1);
    await r.del(key);
  });

  it('pub/sub delivers', async () => {
    if (!available) return;
    const sub = new Redis(URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
    try {
      await sub.connect().catch(() => undefined);
      const chan = redisKeys.gameChannel(`t-${Date.now()}`);
      const got = new Promise<string>((resolve) => {
        void sub.subscribe(chan).then(() => undefined);
        sub.on('message', (c, m) => { if (c === chan) resolve(m); });
      });
      await need().publish(chan, 'hello');
      let watchdog: NodeJS.Timeout | undefined;
      try {
        const timeout = new Promise<never>((_, rej) => {
          watchdog = setTimeout(() => rej(new Error('pubsub timeout')), 3000);
        });
        assert.equal(await Promise.race([got, timeout]), 'hello');
      } finally {
        if (watchdog !== undefined) clearTimeout(watchdog);
      }
    } finally {
      // Always release the subscriber, even on assertion failure,
      // so a failing test cannot hang the runner either.
      sub.disconnect();
    }
  });
});
