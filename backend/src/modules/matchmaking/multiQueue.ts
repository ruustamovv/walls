/**
 * Multiplayer quick-match buckets: casual-only, first-N-fill per
 * (players, timeControl). Guests and registered users share buckets
 * (all games are casual). Memory-backed like the 1v1 queue's fallback;
 * promote to the Redis sorted-set pattern when multi traffic grows.
 */
export interface MultiTicket {
  userId: string;
  players: number;
  timeControl: string;
  joinedAt: number;
}

export class MultiMatchQueue {
  private readonly buckets = new Map<string, MultiTicket[]>();

  private key(players: number, timeControl: string): string {
    return `${players}:${timeControl}`;
  }

  async join(ticket: MultiTicket): Promise<void> {
    const k = this.key(ticket.players, ticket.timeControl);
    const bucket = this.buckets.get(k) ?? [];
    const filtered = bucket.filter((t) => t.userId !== ticket.userId);
    filtered.push(ticket);
    this.buckets.set(k, filtered);
  }

  async cancel(userId: string): Promise<boolean> {
    let removed = false;
    for (const [k, bucket] of this.buckets) {
      const next = bucket.filter((t) => t.userId !== userId);
      if (next.length !== bucket.length) {
        removed = true;
        if (next.length === 0) this.buckets.delete(k);
        else this.buckets.set(k, next);
      }
    }
    return removed;
  }

  /** Drain a full bucket (oldest-first) into a match group. */
  async tryMatch(players: number, timeControl: string): Promise<MultiTicket[] | null> {
    const k = this.key(players, timeControl);
    const bucket = (this.buckets.get(k) ?? []).sort((a, b) => a.joinedAt - b.joinedAt);
    if (bucket.length < players) return null;
    const group = bucket.slice(0, players);
    const rest = bucket.slice(players);
    if (rest.length === 0) this.buckets.delete(k);
    else this.buckets.set(k, rest);
    return group;
  }

  async size(players: number, timeControl: string): Promise<number> {
    return (this.buckets.get(this.key(players, timeControl)) ?? []).length;
  }

  async clear(): Promise<void> {
    this.buckets.clear();
  }
}
