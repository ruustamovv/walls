/**
 * Live provider calls (OpenAI-compatible chat completions: groq, openai,
 * openrouter). Anthropic/Gemini use different wire formats and stay
 * honestly unimplemented until demand justifies them.
 *
 * Guardrails: 20s timeout, 600-token cap, per-user daily quota (Redis when
 * available, in-memory fallback), every call logged to ai_usage
 * best-effort. Model output is validated as *explanation text only* —
 * board facts always come from the engine payload, never from the model.
 */
import { z } from 'zod';
import { logger } from '../../common/logging/logger.js';
import type { AIProviderId } from './provider.js';

const OPENAI_COMPATIBLE = ['groq', 'openai', 'openrouter'] as const;
type CompatId = (typeof OPENAI_COMPATIBLE)[number];

const BASE_URL: Record<CompatId, string> = {
  groq: 'https://api.groq.com/openai/v1',
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
};

const DEFAULT_MODEL: Record<CompatId, string> = {
  groq: 'llama-3.3-70b-versatile',
  openai: 'gpt-4o-mini',
  openrouter: 'meta-llama/llama-3.3-70b-instruct',
};

const DAILY_QUOTA = Number(process.env['AI_MAX_SESSIONS_PER_DAY'] ?? 20);
const UNLIMITED_QUOTA = 200;

async function quotaFor(userId: string): Promise<number> {
  try {
    const { getMongoDb } = await import('../../database/mongodb/client.js');
    const { EntitlementRepository } = await import('../../database/mongodb/repositories/premium.repository.js');
    const db = await getMongoDb();
    if (await new EntitlementRepository(db).has(userId, 'AI_COACH_UNLIMITED')) return UNLIMITED_QUOTA;
  } catch {
    // entitlements advisory for quotas
  }
  return DAILY_QUOTA;
}

const memQuota = new Map<string, { day: string; count: number }>();

function memQuotaCount(userId: string, feature: string, day: string, limit: number): boolean {
  const k = `${feature}:${userId}`;
  const cur = memQuota.get(k);
  if (cur === undefined || cur.day !== day) {
    memQuota.set(k, { day, count: 1 });
    return true;
  }
  cur.count++;
  return cur.count <= limit;
}

async function quotaOverride(userId: string, day: string): Promise<number | null> {
  try {
    const { getMongoDb } = await import('../../database/mongodb/client.js');
    const { QuotaRepository } = await import('../../database/mongodb/repositories/ops.repository.js');
    const db = await getMongoDb();
    return new QuotaRepository(db).get(userId, day);
  } catch {
    return null;
  }
}

/** Feature kill-switch via flags (absent flag = enabled). */
export async function featureEnabled(key: string): Promise<boolean> {
  try {
    const { getMongoDb } = await import('../../database/mongodb/client.js');
    const db = await getMongoDb();
    const row = (await db.collection('feature_flags').findOne({ key }).catch(() => null)) as { enabled?: boolean } | null;
    if (row === null) return true;
    return row.enabled !== false;
  } catch {
    return true;
  }
}

const USD_PER_1M_TOKENS: Record<string, number> = {
  groq: 0.5, openai: 0.6, openrouter: 1.0, anthropic: 3.0, gemini: 0.5,
};

/** Month-to-date estimated AI spend (rough per-token rates, labeled estimate). */
export async function monthlySpendUsd(): Promise<number> {
  try {
    const { getMongoDb } = await import('../../database/mongodb/client.js');
    const db = await getMongoDb();
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    const rows = (await db.collection('ai_usage').aggregate([
      { $match: { createdAt: { $gte: start } } },
      { $group: { _id: '$provider', spend: { $sum: '$estimatedUsd' }, prompt: { $sum: '$promptTokens' }, completion: { $sum: '$completionTokens' } } },
    ]).toArray().catch(() => [])) as { _id: string; spend: number; prompt: number; completion: number }[];
    return rows.reduce((sum, r) => {
      if (typeof r.spend === 'number' && Number.isFinite(r.spend)) return sum + r.spend;
      const rate = USD_PER_1M_TOKENS[r._id] ?? 1.0;
      return sum + ((r.prompt + r.completion) / 1e6) * rate;
    }, 0);
  } catch {
    return 0;
  }
}

async function quotaLeft(userId: string, feature: string): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  const override = await quotaOverride(userId, day);
  if (override !== null) return override > 0 ? await countAgainst(userId, feature, day, override) : false;
  const limit = feature === 'coach' ? await quotaFor(userId) : DAILY_QUOTA;
  return countAgainst(userId, feature, day, limit);
}

async function countAgainst(userId: string, feature: string, day: string, limit: number): Promise<boolean> {
  const key = `${process.env['REDIS_PREFIX'] ?? 'pn'}:aiquota:${feature}:${userId}:${day}`;
  try {
    // Probe first: connectRedis() tears down half-open clients on failure,
    // so a dead Redis degrades to memory quotas without retry storms.
    const { connectRedis, getRedis } = await import('../../database/redis/client.js');
    if (!(await connectRedis(800))) return memQuotaCount(userId, feature, day, limit);
    const n = await getRedis().incr(key);
    if (n === 1) await getRedis().expire(key, 86400).catch(() => undefined);
    return n <= limit;
  } catch {
    return memQuotaCount(userId, feature, day, limit);
  }
}

const CompletionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
  usage: z.object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional() }).optional(),
});

export interface CoachResult {
  ok: boolean;
  provider?: AIProviderId;
  explanation?: string;
  error?: string;
  quotaLeft?: boolean;
}

function readKey(id: AIProviderId): string | null {
  const env: Record<AIProviderId, string> = {
    groq: 'GROQ_API_KEY', openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY',
    gemini: 'GEMINI_API_KEY', openrouter: 'OPENROUTER_API_KEY',
  };
  const raw = process.env[env[id]];
  if (typeof raw !== 'string' || raw.trim() === '' || raw.includes('PASTE_YOUR')) return null;
  return raw.trim();
}

export function estimateUsd(provider: string, promptTokens = 0, completionTokens = 0): number {
  const rate = USD_PER_1M_TOKENS[provider] ?? 1.0;
  return ((promptTokens + completionTokens) / 1e6) * rate;
}

async function logUsage(userId: string, feature: string, provider: string, ok: boolean, promptTokens?: number, completionTokens?: number): Promise<void> {
  try {
    const { getMongoDb } = await import('../../database/mongodb/client.js');
    const db = await getMongoDb();
    await db.collection('ai_usage').insertOne({
      userId, feature, provider, ok, promptTokens, completionTokens,
      estimatedUsd: estimateUsd(provider, promptTokens ?? 0, completionTokens ?? 0),
      createdAt: new Date(),
    }).catch(() => undefined);
  } catch {
    // usage accounting is advisory
  }
}

/**
 * Explain engine facts in natural language. `facts` is the reviewed move
 * (paths before/after, played vs best) — the model receives numbers, and
 * its system prompt forbids inventing board facts.
 */
function isCompat(provider: AIProviderId): provider is CompatId {
  return (OPENAI_COMPATIBLE as readonly string[]).includes(provider);
}

export async function coachExplanation(
  userId: string,
  provider: AIProviderId,
  facts: { moveNumber: number; playedAction: string; bestAction: string; ownPathBefore: number; ownPathAfter: number; oppPathBefore: number; oppPathAfter: number; question?: string },
): Promise<CoachResult> {
  if (!isCompat(provider)) {
    return { ok: false, error: `${provider} live calls are not implemented yet — configure groq, openai or openrouter.` };
  }
  if (!(await featureEnabled('AI_COACH'))) {
    return { ok: false, error: 'AI Coach is disabled by the platform team right now' };
  }
  const monthlyBudget = Number(process.env['AI_MONTHLY_BUDGET_USD'] ?? 25);
  if (Number.isFinite(monthlyBudget) && monthlyBudget > 0 && (await monthlySpendUsd()) >= monthlyBudget) {
    logger.warn('Monthly AI budget exhausted — refusing coach call');
    return { ok: false, error: 'platform AI budget exhausted for this month' };
  }
  const key = readKey(provider);
  if (key === null) return { ok: false, error: 'provider not configured' };
  if (!(await quotaLeft(userId, 'coach'))) {
    return { ok: false, error: 'daily AI quota reached — try again tomorrow', quotaLeft: false };
  }
  const model = process.env['AI_MODEL_COACH']?.trim() || DEFAULT_MODEL[provider];
  const system = [
    'You are a wall-and-pawn strategy coach. You receive ENGINE-COMPUTED facts.',
    'Explain them in ≤120 words, plain language, one concrete tip.',
    'NEVER invent moves, positions, or numbers — only use the facts given.',
    'If the played action equals the best action, praise it briefly.',
  ].join(' ');
  const userPrompt = [
    `Move ${facts.moveNumber}: played [${facts.playedAction}], engine best [${facts.bestAction}].`,
    `Own shortest route: ${facts.ownPathBefore} → ${facts.ownPathAfter} steps.`,
    `Opponent shortest route: ${facts.oppPathBefore} → ${facts.oppPathAfter} steps.`,
    facts.question !== undefined && facts.question !== '' ? `Player asks: ${facts.question.slice(0, 500)}` : '',
  ].filter((s) => s !== '').join('\n');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`${BASE_URL[provider]}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        ...(provider === 'openrouter' ? { 'HTTP-Referer': process.env['FRONTEND_URL'] ?? 'http://localhost:5173' } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 600,
        temperature: 0.4,
      }),
    });
    if (!res.ok) {
      const err = `provider error ${res.status}`;
      await logUsage(userId, 'coach', provider, false);
      logger.warn({ provider, status: res.status }, 'AI coach provider error');
      return { ok: false, provider, error: err };
    }
    const parsed = CompletionSchema.safeParse(await res.json().catch(() => ({})));
    if (!parsed.success) {
      await logUsage(userId, 'coach', provider, false);
      return { ok: false, provider, error: 'provider returned an unreadable response' };
    }
    const text = (parsed.data.choices[0]?.message.content ?? '').trim().slice(0, 2000);
    if (text === '') {
      await logUsage(userId, 'coach', provider, false);
      return { ok: false, provider, error: 'provider returned an empty response' };
    }
    await logUsage(
      userId, 'coach', provider, true,
      parsed.data.usage?.prompt_tokens, parsed.data.usage?.completion_tokens,
    );
    return { ok: true, provider, explanation: text };
  } catch (err) {
    await logUsage(userId, 'coach', provider, false);
    return { ok: false, provider, error: err instanceof Error && err.name === 'AbortError' ? 'provider timed out' : 'provider unreachable' };
  } finally {
    clearTimeout(timer);
  }
}
