/**
 * Session service — Redis-ready interface with in-memory fallback for dev/test.
 *
 * Production wiring: pass a Redis-backed SessionStore. Until then the
 * default InMemorySessionStore keeps the API offline-friendly with TTL sweeps.
 */

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
 * Redis itself (SET EX). Falls back to memory when Redis is unreachable —
 * see createSessionStore().
 */
export class RedisSessionStore implements SessionStore {
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

  async save(session: SessionRecord): Promise<void> {
    const r = await this.redis();
    if (r === null) throw new Error('redis unavailable');
    const ttlSec = Math.max(60, Math.floor((session.expiresAt - Date.now()) / 1000));
    await r.set(this.key(session.id), JSON.stringify(session), 'EX', ttlSec);
  }

  async get(id: string): Promise<SessionRecord | null> {
    const r = await this.redis();
    if (r === null) throw new Error('redis unavailable');
    const raw = await r.get(this.key(id));
    if (raw === null) return null;
    try {
      const s = JSON.parse(raw) as SessionRecord;
      if (s.expiresAt <= Date.now()) return null;
      return s;
    } catch {
      return null;
    }
  }

  async delete(id: string): Promise<void> {
    const r = await this.redis();
    if (r === null) return;
    await r.del(this.key(id)).catch(() => undefined);
  }

  async deleteByUser(userId: string): Promise<number> {
    const r = await this.redis();
    if (r === null) return 0;
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
    return removed;
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
