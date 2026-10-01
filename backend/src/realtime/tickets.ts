/**
 * Single-use socket tickets (QAF-001 security fix).
 *
 * Problem: sockets authenticated with an unsigned `auth.userId`, which
 * production only half-gated (any `token` string passed). Fix: the browser
 * fetches a short-lived ticket over the cookie-authenticated REST layer
 * and presents it once at socket handshake. Tickets are random 256-bit
 * values, bound to one user, 60s TTL, single-use, in-memory (per replica;
 * sticky routing covers multi-instance until the Redis room-leader lands).
 */
import { randomBytes } from 'node:crypto';

const TTL_MS = 60_000;
const MAX_TICKETS = 5000;

interface Ticket {
  userId: string;
  expiresAt: number;
}

const tickets = new Map<string, Ticket>();

function sweep(now: number): void {
  if (tickets.size < MAX_TICKETS) return;
  for (const [k, v] of tickets) {
    if (v.expiresAt <= now) tickets.delete(k);
  }
}

/** Issue a ticket for an already-authenticated user. */
export function issueSocketTicket(userId: string, now: number = Date.now()): { ticket: string; expiresInSec: number } {
  sweep(now);
  const ticket = randomBytes(32).toString('hex');
  tickets.set(ticket, { userId, expiresAt: now + TTL_MS });
  return { ticket, expiresInSec: Math.floor(TTL_MS / 1000) };
}

/** Redeem once: returns the bound userId, or null when unknown/expired/used. */
export function redeemSocketTicket(ticket: unknown, now: number = Date.now()): string | null {
  if (typeof ticket !== 'string' || ticket.length === 0) return null;
  const rec = tickets.get(ticket);
  if (rec === undefined) return null;
  tickets.delete(ticket);
  if (rec.expiresAt <= now) return null;
  return rec.userId;
}

/** Test hook: drop all outstanding tickets. */
export function __resetSocketTicketsForTests(): void {
  tickets.clear();
}
