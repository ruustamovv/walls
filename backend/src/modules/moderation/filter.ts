/**
 * Deterministic chat filter (CHT-003): blocklist + spam shapes first.
 * Runs on EVERY message locally (no LLM in the hot path). Suspicious but
 * sub-blocking content is flagged for staff review, with optional AI
 * triage on demand (AIM-002) — never automatic per-message LLM calls.
 */

export type FilterDecision = 'allow' | 'flag' | 'block';

// Small, documented stem list (English). Presence => block; this is a
// first-pass net, staff review + conduct hooks do the rest.
const BLOCKED_STEMS = [
  'fuck', 'shit', 'bitch', 'bastard', 'asshole', 'dickhead',
  'nigger', 'nigga', 'faggot', 'retard', 'kys', 'kill yourself',
];

const FLAG_PATTERNS: { test: RegExp; reason: string }[] = [
  { test: /https?:\/\//i, reason: 'link' },
  { test: /(.)\1{5,}/, reason: 'repeated-chars' },
  { test: /\b(add|buy|cheap|free|money|win|prize|crypto|bet)\b.*\b(add|buy|cheap|free|money|win|prize|crypto|bet)\b/i, reason: 'spammy' },
];

export interface FilterVerdict {
  decision: FilterDecision;
  reasons: string[];
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** All-caps shouting (ignoring short messages and preset chat). */
function shouting(text: string): boolean {
  const letters = text.replace(/[^a-zA-Z]/g, '');
  if (letters.length < 12) return false;
  const upper = letters.replace(/[^A-Z]/g, '').length;
  return upper / letters.length > 0.85;
}

export function scoreMessage(raw: string): FilterVerdict {  const text = raw.trim().slice(0, 500);
  if (text.length === 0) return { decision: 'allow', reasons: [] };
  const norm = ` ${normalize(text)} `;
  for (const stem of BLOCKED_STEMS) {
    if (norm.includes(stem)) return { decision: 'block', reasons: ['blocklist'] };
  }
  const reasons: string[] = [];
  for (const p of FLAG_PATTERNS) {
    if (p.test.test(text)) reasons.push(p.reason);
  }
  if (shouting(text)) reasons.push('shouting');
  if (reasons.length > 0) return { decision: 'flag', reasons };
  return { decision: 'allow', reasons: [] };
}

/**
 * File an auto-flag report for staff triage (best-effort, never throws).
 * AI triage happens on demand from the admin queue (AIM-002), not here.
 */
import type { Db } from 'mongodb';
import { ReportRepository } from '../../database/mongodb/repositories/social.repository.js';

export async function autoFlag(
  db: Db,
  userId: string,
  channel: string,
  text: string,
  reasons: string[],
): Promise<void> {
  try {
    await new ReportRepository(db).submit(
      'auto-mod',
      'user',
      userId,
      `[auto-flag: ${reasons.join(',')}] ${channel}: ${text.slice(0, 200)}`,
    );
  } catch {
    // moderation must never break chat
  }
}
