/**
 * AI provider abstraction. The platform never depends on a single vendor:
 * each provider is optional, configured purely through environment, and
 * every AI feature degrades to a clear "not configured" state when no key
 * exists. Secrets are never logged and never sent to the frontend.
 */
import { z } from 'zod';

export const AI_PROVIDERS = ['groq', 'openai', 'anthropic', 'gemini', 'openrouter'] as const;
export type AIProviderId = (typeof AI_PROVIDERS)[number];

const KEY_ENV: Record<AIProviderId, string> = {
  groq: 'GROQ_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

export interface AIProviderStatus {
  id: AIProviderId;
  configured: boolean;
  /** Last-4 fingerprint for admin display (never the full key). */
  keyHint: string | null;
  model: string | null;
}

function readKey(id: AIProviderId): string | null {
  const raw = process.env[KEY_ENV[id]];
  if (typeof raw !== 'string' || raw.trim() === '' || raw.includes('PASTE_YOUR')) return null;
  return raw.trim();
}

function modelFor(id: AIProviderId): string | null {
  // Split models by exercise: chat=banter/commentator, coach=explains, analysis=deep review.
  const chat = process.env['AI_MODEL_CHAT']?.trim() || null;
  const coach = process.env['AI_MODEL_COACH']?.trim() || null;
  const analysis = process.env['AI_MODEL_ANALYSIS']?.trim() || null;
  const defaults: Record<AIProviderId, string> = {
    groq: 'llama-3.3-70b-versatile',
    openai: 'gpt-4o-mini',
    anthropic: 'claude-3-5-haiku-latest',
    gemini: 'gemini-1.5-flash',
    openrouter: 'meta-llama/llama-3.3-70b-instruct',
  };
  // Prefer task-specific override, fall back to provider default.
  void chat; void analysis;
  return coach || chat || analysis || defaults[id];
}

export function modelForTask(task: 'chat' | 'coach' | 'analysis'): string | null {
  const chat = process.env['AI_MODEL_CHAT']?.trim() || null;
  const coach = process.env['AI_MODEL_COACH']?.trim() || null;
  const analysis = process.env['AI_MODEL_ANALYSIS']?.trim() || null;
  if (task === 'chat') return chat ?? coach ?? analysis;
  if (task === 'coach') return coach ?? chat ?? analysis;
  return analysis ?? coach ?? chat;
}

export function selectedProvider(): AIProviderId {
  const raw = (process.env['AI_PROVIDER'] ?? '').trim().toLowerCase();
  return (AI_PROVIDERS as readonly string[]).includes(raw) ? (raw as AIProviderId) : 'groq';
}

export function providerStatuses(): AIProviderStatus[] {
  return AI_PROVIDERS.map((id) => {
    const key = readKey(id);
    return {
      id,
      configured: key !== null,
      keyHint: key === null ? null : `••••${key.slice(-4)}`,
      model: modelFor(id),
    };
  });
}

export function activeProvider(): AIProviderStatus | null {
  const sel = selectedProvider();
  const found = providerStatuses().find((p) => p.id === sel) ?? null;
  if (found !== null && found.configured) return found;
  return providerStatuses().find((p) => p.configured) ?? null;
}

// ── Coach payload: engine facts in, grounded explanation out ──
// The LLM must only ever explain these precomputed facts; board truth
// always comes from the deterministic engine, never from model output.
export const CoachRequestSchema = z.object({
  moveNumber: z.number().int().min(0),
  playedAction: z.string().min(1).max(200),
  bestAction: z.string().min(1).max(200),
  ownPathBefore: z.number().int(),
  ownPathAfter: z.number().int(),
  oppPathBefore: z.number().int(),
  oppPathAfter: z.number().int(),
  question: z.string().min(1).max(2000).optional(),
});

export type CoachRequest = z.infer<typeof CoachRequestSchema>;
