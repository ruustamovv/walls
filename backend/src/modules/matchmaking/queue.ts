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
   * Returns null when no partner is within the (expanded) window yet.
   */
  async tryMatch(now: number = Date.now()): Promise<MatchPair | null> {
    const tickets = await this.store.list();
    if (tickets.length < 2) return null;
    const head = tickets[0];
    if (head === undefined) return null;
    const window = ratingWindowFor(now - head.joinedAt);

    let best: MatchTicket | null = null;
    let bestGap = Number.POSITIVE_INFINITY;
    for (let i = 1; i < tickets.length; i++) {
      const cand = tickets[i];
      if (cand === undefined) continue;
      if (cand.mode !== head.mode || cand.timeControl !== head.timeControl) continue;
      const gap = Math.abs(cand.rating - head.rating);
      if (gap <= window && gap < bestGap) {
        best = cand;
        bestGap = gap;
      }
    }
    if (best === null) return null;
    await this.store.remove(head.userId);
    await this.store.remove(best.userId);
    return { a: head, b: best };
  }
}
