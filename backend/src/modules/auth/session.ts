/**
 * Session service — Redis-ready interface with in-memory fallback for dev/test.
 *
 * Production wiring: pass a Redis-backed SessionStore. Until then the
 * default InMemorySessionStore keeps the API offline-friendly with TTL sweeps.
 */
import { logger } from '../../common/logging/logger.js';

export interface SessionRecord {
  id: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  userAgent?: string | undefined;
  ip?: string | undefined;
}

export interface SessionStore {
  save(session: SessionRecord): Promise<void>;
  get(id: string): Promise<SessionRecord | null>;
  delete(id: string): Promise<void>;
  deleteByUser(userId: string): Promise<number>;
}

const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7d

export class InMemorySessionStore implements SessionStore {
  private readonly map = new Map<string, SessionRecord>();

  async save(session: SessionRecord): Promise<void> {
    this.sweep();
    this.map.set(session.id, session);
  }

  async get(id: string): Promise<SessionRecord | null> {
    const s = this.map.get(id);
    if (s === undefined) return null;
    if (s.expiresAt <= Date.now()) {
      this.map.delete(id);
      return null;
    }
    return s;
  }

  async delete(id: string): Promise<void> {
    this.map.delete(id);
  }

  async deleteByUser(userId: string): Promise<number> {
    let n = 0;
    for (const [k, v] of this.map) {
      if (v.userId === userId) {
        this.map.delete(k);
        n += 1;
      }
    }
    return n;
  }

  private sweep(): void {
    if (this.map.size < 500) return;
    const now = Date.now();
    for (const [k, v] of this.map) {
      if (v.expiresAt <= now) this.map.delete(k);
    }
  }
}

function randomId(): string {
  // Node 20+: crypto.randomUUID is available; avoid extra deps.
  const g = globalThis.crypto;
  if (typeof g?.randomUUID === 'function') return g.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Redis-backed sessions: shared across backend instances, TTL-enforced by
 * Redis itself (SET EX).
 *
 * A Redis outage must not silently break auth: the Redis client object can
 * exist while being unreachable, so `save()` used to throw *after* the route
 * had already returned 200 with a session cookie the server could never read
 * back ("Invalid session" on every later request). Every operation now falls
 * back to a process-local mirror, which keeps single-instance dev usable and
 * logs loudly instead of failing invisibly. Multi-instance deployments still
 * require Redis — the mirror is per-process.
 */
export class RedisSessionStore implements SessionStore {
  /** Process-local mirror used only while Redis is unreachable. */
  private readonly mirror = new InMemorySessionStore();

  private warned = false;

  private key(id: string): string {
    const prefix = process.env['REDIS_PREFIX'] ?? 'pn';
    return `${prefix}:sess:${id}`;
  }

  private async redis(): Promise<{ get(k: string): Promise<string | null>; set(k: string, v: string, mode: string, ttl: number): Promise<unknown>; del(...k: string[]): Promise<unknown>; scan(c: string, o1: string, o2: string, o3: string, o4: number): Promise<[string, string[]]> } | null> {
    try {
      const { getRedis } = await import('../../database/redis/client.js');
      return getRedis() as unknown as {
        get(k: string): Promise<string | null>;
        set(k: string, v: string, mode: string, ttl: number): Promise<unknown>;
        del(...k: string[]): Promise<unknown>;
        scan(c: string, o1: string, o2: string, o3: string, o4: number): Promise<[string, string[]]>;
      };
    } catch {
      return null;
    }
  }

  /** Log the first Redis failure of this store: loud, but never a 500. */
  private degraded(op: string, err: unknown): void {
    if (this.warned) return;
    this.warned = true;
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), op },
      'Redis session op failed — using process-local sessions (single-instance only)',
    );
  }

  async save(session: SessionRecord): Promise<void> {
    const r = await this.redis();
    if (r === null) {
      this.degraded('save', new Error('redis unavailable'));
      return this.mirror.save(session);
    }
    const ttlSec = Math.max(60, Math.floor((session.expiresAt - Date.now()) / 1000));
    try {
      await r.set(this.key(session.id), JSON.stringify(session), 'EX', ttlSec);
    } catch (err) {
      this.degraded('save', err);
      return this.mirror.save(session);
    }
    await this.mirror.save(session);
  }

  async get(id: string): Promise<SessionRecord | null> {
    const r = await this.redis();
    if (r === null) {
      this.degraded('get', new Error('redis unavailable'));
      return this.mirror.get(id);
    }
    try {
      const raw = await r.get(this.key(id));
      if (raw === null) return this.mirror.get(id);
      const s = JSON.parse(raw) as SessionRecord;
      if (s.expiresAt <= Date.now()) return null;
      return s;
    } catch (err) {
      this.degraded('get', err);
      return this.mirror.get(id);
    }
  }

  async delete(id: string): Promise<void> {
    await this.mirror.delete(id);
    const r = await this.redis();
    if (r === null) return;
    await r.del(this.key(id)).catch(() => undefined);
  }

  async deleteByUser(userId: string): Promise<number> {
    const mirrored = await this.mirror.deleteByUser(userId);
    const r = await this.redis();
    if (r === null) return mirrored;
    // Sessions are keyed by id; scan values to match the owner.
    let cursor = '0';
    let removed = 0;
    const prefix = process.env['REDIS_PREFIX'] ?? 'pn';
    for (let guard = 0; guard < 50; guard++) {
      const [next, keys] = await r.scan(cursor, 'MATCH', `${prefix}:sess:*`, 'COUNT', 100).catch(() => ['0', []] as [string, string[]]);
      cursor = next;
      for (const k of keys) {
        const raw = await r.get(k).catch(() => null);
        if (raw === null) continue;
        try {
          const s = JSON.parse(raw) as SessionRecord;
          if (s.userId === userId) {
            await r.del(k).catch(() => undefined);
            removed++;
          }
        } catch {
          // ignore corrupt entries
        }
      }
      if (cursor === '0') break;
    }
    return removed + mirrored;
  }
}

let redisSessionsOk: boolean | null = null;
let redisSessionsCheckedAt = 0;

/** Prefer shared Redis sessions; memory fallback keeps offline dev usable. */
export async function createSessionStore(): Promise<SessionStore> {
  if (redisSessionsOk !== null && Date.now() - redisSessionsCheckedAt < 30000) {
    return redisSessionsOk ? new RedisSessionStore() : new InMemorySessionStore();
  }
  try {
    const { connectRedis } = await import('../../database/redis/client.js');
    redisSessionsOk = await connectRedis();
  } catch {
    redisSessionsOk = false;
  }
  redisSessionsCheckedAt = Date.now();
  return redisSessionsOk ? new RedisSessionStore() : new InMemorySessionStore();
}

export class SessionService {
  private readonly store: SessionStore;
  private readonly ttlMs: number;

  constructor(store: SessionStore = new InMemorySessionStore(), ttlMs: number = DEFAULT_TTL_MS) {
    this.store = store;
    this.ttlMs = ttlMs;
  }

  async create(userId: string, meta: { userAgent?: string; ip?: string } = {}): Promise<SessionRecord> {
    const now = Date.now();
    const session: SessionRecord = {
      id: randomId(),
      userId,
      createdAt: now,
      expiresAt: now + this.ttlMs,
      ...(meta.userAgent !== undefined ? { userAgent: meta.userAgent } : {}),
      ...(meta.ip !== undefined ? { ip: meta.ip } : {}),
    };
    await this.store.save(session);
    return session;
  }

  async get(sessionId: string): Promise<SessionRecord | null> {
    return this.store.get(sessionId);
  }

  async revoke(sessionId: string): Promise<void> {
    await this.store.delete(sessionId);
  }

  async revokeAllForUser(userId: string): Promise<number> {
    return this.store.deleteByUser(userId);
  }
}
