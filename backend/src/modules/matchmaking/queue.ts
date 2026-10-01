/**
 * Matchmaking queue — in-memory implementation behind a Redis-ready interface.
 *
 * Pairing rule: narrow rating window at join, expanding linearly with wait
 * time (initialWindow + waitedSec * expandPerSec, capped at maxWindow).
 * Anti-duplicate: one ticket per user (join replaces the old ticket).
 *
 * Production swap: implement QueueStore on top of Redis Sorted Set
 * (score = join time, member = userId) + Hash for ticket payloads.
 */
import { appConfig } from '../../config/app.js';

export interface MatchTicket {
  userId: string;
  mode: string;
  timeControl: string;
  /** Server-side stored rating — never accept client-provided rating. */
  rating: number;
  joinedAt: number;
  /** Fair-play conduct 0–100 (server-resolved, default 100 unknown). */
  behavior?: number;
  /** Coarse client-declared locality (e.g. timezone); preference only. */
  region?: string;
}

export interface MatchPair {
  a: MatchTicket;
  b: MatchTicket;
}

export interface QueueStore {
  set(ticket: MatchTicket): Promise<void>;
  remove(userId: string): Promise<boolean>;
  list(): Promise<MatchTicket[]>;
  clear(): Promise<void>;
}

export class InMemoryQueueStore implements QueueStore {
  private readonly map = new Map<string, MatchTicket>();

  async set(ticket: MatchTicket): Promise<void> {
    this.map.set(ticket.userId, ticket);
  }

  async remove(userId: string): Promise<boolean> {
    return this.map.delete(userId);
  }

  async list(): Promise<MatchTicket[]> {
    return [...this.map.values()].sort((a, b) => a.joinedAt - b.joinedAt);
  }

  async clear(): Promise<void> {
    this.map.clear();
  }
}

export function ratingWindowFor(waitedMs: number): number {
  const cfg = appConfig.matchmaking;
  const waitedSec = Math.max(0, waitedMs / 1000);
  return Math.min(cfg.maxWindow, Math.round(cfg.initialWindow + waitedSec * cfg.windowExpandPerSec));
}

export class MatchmakingQueue {
  private readonly store: QueueStore;
  /** Recent pairings (pairKey -> matchedAt) for rematch avoidance. */
  private readonly recentPairs = new Map<string, number>();

  constructor(store: QueueStore = new InMemoryQueueStore()) {
    this.store = store;
  }

  /** Join (idempotent per user — replaces any existing ticket). */
  async join(ticket: MatchTicket): Promise<void> {
    await this.store.set(ticket);
  }

  async cancel(userId: string): Promise<boolean> {
    return this.store.remove(userId);
  }

  async size(): Promise<number> {
    return (await this.store.list()).length;
  }

  async clear(): Promise<void> {
    await this.store.clear();
  }

  /**
   * Try to pair the longest-waiting ticket with the best partner.
   * Scoring order: rating window (expanding) → behavior compatibility
   * (trust gap widens with wait) → same-region preference (soft, falls
   * back cross-region after 20s) → rematch avoidance (10min, bypassed
   * after 60s of waiting). Returns null when nobody fits yet.
   */
  async tryMatch(now: number = Date.now()): Promise<MatchPair | null> {
    const tickets = await this.store.list();
    if (tickets.length < 2) return null;
    const head = tickets[0];
    if (head === undefined) return null;
    const waitedMs = now - head.joinedAt;
    const window = ratingWindowFor(waitedMs);
    const { behaviorGapAllowed } = await import('../fairplay/service.js');
    const gapAllowed = behaviorGapAllowed(waitedMs);
    const headBehavior = head.behavior ?? 100;

    this.sweepPairs(now);
    const rematchBlocked = (otherId: string): boolean => {
      if (waitedMs > 60_000) return false;
      const at = this.recentPairs.get(pairKey(head.userId, otherId));
      return at !== undefined && now - at < 10 * 60_000;
    };

    const fits = (cand: MatchTicket): boolean => {
      if (cand.mode !== head.mode || cand.timeControl !== head.timeControl) return false;
      if (Math.abs(cand.rating - head.rating) > window) return false;
      if (Math.abs((cand.behavior ?? 100) - headBehavior) > gapAllowed) return false;
      if (rematchBlocked(cand.userId)) return false;
      return true;
    };

    // Prefer same-region partners early; go cross-region after 20s.
    // An empty local pool before that means WAIT (return null), not an
    // immediate cross-region pair.
    const sameRegion = (cand: MatchTicket): boolean =>
      head.region === undefined || cand.region === undefined || head.region === cand.region;
    let pool = tickets.slice(1).filter(fits);
    if (waitedMs < 20_000) {
      pool = pool.filter(sameRegion);
      if (pool.length === 0) return null;
    }

    let best: MatchTicket | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const cand of pool) {
      // Composite: rating gap dominates, behavior gap breaks ties.
      const score = Math.abs(cand.rating - head.rating) * 100 + Math.abs((cand.behavior ?? 100) - headBehavior);
      if (score < bestScore) {
        best = cand;
        bestScore = score;
      }
    }
    if (best === null) return null;
    await this.store.remove(head.userId);
    await this.store.remove(best.userId);
    this.recentPairs.set(pairKey(head.userId, best.userId), now);
    return { a: head, b: best };
  }

  /** Test hook: pretend two users just met (rematch-avoidance checks). */
  markPaired(a: string, b: string, now: number = Date.now()): void {
    this.recentPairs.set(pairKey(a, b), now);
  }

  private sweepPairs(now: number): void {
    if (this.recentPairs.size < 200) return;
    for (const [k, at] of this.recentPairs) {
      if (now - at > 10 * 60_000) this.recentPairs.delete(k);
    }
  }
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
