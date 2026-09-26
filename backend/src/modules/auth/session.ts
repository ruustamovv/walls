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
