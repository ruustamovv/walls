/**
 * Fair-play (conduct) score — SEPARATE from skill rating (FRP-001).
 *
 * Rating measures skill. This score measures reliability: abandons hurt it,
 * finished games heal it, staff-verified abuse sinks it. It is transparent
 * (shown on profiles) and only ever affects pairing preference, queue
 * priority and chat/trust gates — never hidden rating cuts.
 *
 * Pure functions (testable without Mongo) + a thin Mongo repository below.
 * Offline/guests: an in-memory store with identical semantics.
 */

export type ConductEvent =
  | 'completed' // finished game (goal/resign/draw): +1, sportsmanship
  | 'abandon' // timeout / disconnect finish: -8 (rage quits, not resigns)
  | 'verified_abuse' // staff-RESOLVED user report: -20
  | 'false_report'; // staff-DISMISSED report, charged to the reporter: -2

export const CONDUCT_DELTAS: Record<ConductEvent, number> = {
  completed: 1,
  abandon: -8,
  verified_abuse: -20,
  false_report: -2,
};

export const CONDUCT_MIN = 0;
export const CONDUCT_MAX = 100;
export const CONDUCT_START = 100;
/** +1 per full idle day back toward 100 (no cron needed; applied on read). */
export const CONDUCT_DECAY_PER_DAY = 1;

export interface ConductRecord {
  userId: string;
  score: number;
  abandons: number;
  completions: number;
  abuses: number;
  updatedAt: number;
}

export function blankConduct(userId: string, now: number = Date.now()): ConductRecord {
  return { userId, score: CONDUCT_START, abandons: 0, completions: 0, abuses: 0, updatedAt: now };
}

export function applyConductEvent(rec: ConductRecord, event: ConductEvent, now: number = Date.now()): ConductRecord {
  const next: ConductRecord = { ...rec, updatedAt: now };
  next.score = Math.min(CONDUCT_MAX, Math.max(CONDUCT_MIN, next.score + CONDUCT_DELTAS[event]));
  if (event === 'abandon') next.abandons += 1;
  if (event === 'completed') next.completions += 1;
  if (event === 'verified_abuse') next.abuses += 1;
  return next;
}

/** Idle decay applied on read: +1/day toward max, then the caller persists. */
export function decayConduct(rec: ConductRecord, now: number = Date.now()): ConductRecord {
  if (rec.score >= CONDUCT_MAX) return rec;
  const days = Math.floor(Math.max(0, now - rec.updatedAt) / 86_400_000);
  if (days <= 0) return rec;
  return { ...rec, score: Math.min(CONDUCT_MAX, rec.score + days * CONDUCT_DECAY_PER_DAY), updatedAt: now };
}

export type ConductLevel = 'exemplary' | 'good' | 'caution' | 'restricted';

export function conductLevel(score: number): ConductLevel {
  if (score >= 90) return 'exemplary';
  if (score >= 70) return 'good';
  if (score >= 40) return 'caution';
  return 'restricted';
}

/** Pairing compatibility: trust gap tolerated, widening with queue age. */
export function behaviorGapAllowed(waitedMs: number): number {
  const waitedSec = Math.max(0, waitedMs / 1000);
  return Math.min(60, 15 + waitedSec);
}

/** In-memory store with repository-identical semantics (offline/tests). */
export class MemoryConductStore {
  private readonly map = new Map<string, ConductRecord>();

  get(userId: string, now: number = Date.now()): ConductRecord {
    const rec = this.map.get(userId) ?? blankConduct(userId, now);
    return decayConduct(rec, now);
  }

  record(userId: string, event: ConductEvent, now: number = Date.now()): ConductRecord {
    const next = applyConductEvent(this.get(userId, now), event, now);
    this.map.set(userId, next);
    return next;
  }

  clear(): void {
    this.map.clear();
  }
}
