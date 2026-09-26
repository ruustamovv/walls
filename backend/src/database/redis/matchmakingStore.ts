/**
 * Redis-backed matchmaking store (Sorted Set + ticket Hash).
 * - ZSET score = join timestamp → longest-waiting ticket first.
 * - Ticket payloads in a sibling Hash (field = userId).
 * - One queue key per (mode, timeControl); ticket key global per user
 *   so a user can only hold ONE ticket across all queues (anti-duplicate).
 *
 * Falls back to NO-OP null when Redis is unreachable — callers keep the
 * in-memory MatchmakingQueue in that case (documented degraded mode).
 */
import type { MatchTicket, QueueStore } from '../../modules/matchmaking/queue.js';
import { getRedis } from './client.js';
import { redisKeys } from './keys.js';

export class RedisQueueStore implements QueueStore {
  async set(ticket: MatchTicket): Promise<void> {
    const redis = getRedis();
    const qkey = redisKeys.matchmakingQueue(ticket.mode, ticket.timeControl);
    const tkey = redisKeys.matchmakingTicket(ticket.userId);
    const prev = await redis.hget(tkey, 'queue');
    if (prev !== null && prev !== qkey) {
      await redis.zrem(prev, ticket.userId);
    }
    await redis.hset(tkey, {
      queue: qkey, mode: ticket.mode, timeControl: ticket.timeControl,
      rating: String(ticket.rating), joinedAt: String(ticket.joinedAt),
    });
    await redis.expire(tkey, 600);
    await redis.zadd(qkey, ticket.joinedAt, ticket.userId);
  }

  async remove(userId: string): Promise<boolean> {
    const redis = getRedis();
    const tkey = redisKeys.matchmakingTicket(userId);
    const qkey = await redis.hget(tkey, 'queue');
    let removed = false;
    if (qkey !== null) {
      removed = (await redis.zrem(qkey, userId)) > 0;
      await redis.del(tkey);
    }
    return removed;
  }

  async list(): Promise<MatchTicket[]> {
    // NOTE: single-queue listing is ambiguous across modes; this lists the
    // default ranked-blitz queue. MatchmakingQueue instances should be
    // constructed per (mode, timeControl) when backed by Redis.
    return this.listQueue('ranked', '3+1');
  }

  async listQueue(mode: string, timeControl: string): Promise<MatchTicket[]> {
    const redis = getRedis();
    const qkey = redisKeys.matchmakingQueue(mode, timeControl);
    const members = await redis.zrange(qkey, 0, -1);
    const out: MatchTicket[] = [];
    for (const userId of members) {
      const h = await redis.hgetall(redisKeys.matchmakingTicket(userId));
      if (h['queue'] !== qkey) continue;
      out.push({
        userId, mode: h['mode'] ?? mode, timeControl: h['timeControl'] ?? timeControl,
        rating: Number(h['rating'] ?? 1500), joinedAt: Number(h['joinedAt'] ?? Date.now()),
      });
    }
    return out;
  }

  async clear(): Promise<void> {
    const redis = getRedis();
    const keys = await redis.keys(`${process.env['REDIS_PREFIX'] ?? 'pn'}:matchmaking:*`);
    if (keys.length > 0) await redis.del(...keys);
  }
}
