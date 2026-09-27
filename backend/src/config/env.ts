/**
 * Centralised environment loading + validation.
 *
 * - Loaded exactly once (module singleton).
 * - REQUIRED vars throw at boot; OPTIONAL vars never throw (defaults applied).
 * - All runtime code must import from here, never `process.env` directly.
 * - Persistence: MongoDB (durable) + Redis (ephemeral). No PostgreSQL.
 */
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);
const NodeEnvSchema = z.enum(['development', 'test', 'production']);

const RequiredSchema = z.object({
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required (e.g. mongodb://localhost:27017)'),
  MONGODB_DB_NAME: z.string().min(1, 'MONGODB_DB_NAME is required (e.g. project_nexus)'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required (e.g. redis://localhost:6379)'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 chars'),
  COOKIE_SECRET: z.string().min(16, 'COOKIE_SECRET must be at least 16 chars'),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 chars'),
});

const OptionalSchema = z.object({
  NODE_ENV: NodeEnvSchema.default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  REDIS_PREFIX: z.string().default('pn'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  FRONTEND_URL: z.string().default('http://localhost:5173'),
  ADMIN_URL: z.string().default('http://localhost:5174'),
  BACKEND_URL: z.string().default('http://localhost:3000'),
  LOG_LEVEL: LogLevelSchema.default('info'),
  MAINTENANCE_MODE: z.coerce.boolean().default(false),
  // AI providers — all optional. Missing keys only disable AI features.
  AI_PROVIDER: z.string().default('groq'),
  GROQ_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  AI_MODEL_CHAT: z.string().optional(),
  AI_MODEL_ANALYSIS: z.string().optional(),
  AI_MODEL_TTS: z.string().optional(),
  AI_MONTHLY_BUDGET_USD: z.coerce.number().default(25),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
});

const EnvSchema = RequiredSchema.merge(OptionalSchema);

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

function normaliseOptionalBlanks(raw: Record<string, string | undefined>): Record<string, string | undefined> {
  // Treat empty-string / placeholder values from .env.example as "not set"
  // so optional keys never throw and never leak placeholder text.
  const out: Record<string, string | undefined> = { ...raw };
  const optionalKeys = Object.keys(OptionalSchema.shape) as (keyof z.infer<typeof OptionalSchema>)[];
  for (const key of optionalKeys) {
    const v = out[key];
    if (v !== undefined && (v.trim() === '' || v.includes('PASTE_YOUR_'))) {
      delete out[key];
    }
  }
  return out;
}

/** Load + validate env. Throws only for missing/invalid REQUIRED vars. */
export function loadEnv(raw: Record<string, string | undefined> = process.env): Env {
  if (cached !== null) return cached;
  const scrubbed = normaliseOptionalBlanks(raw);
  const parsed = EnvSchema.safeParse(scrubbed);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment: ${details}`);
  }
  cached = parsed.data;
  return cached;
}

/** Typed accessor (lazy-loads on first call). */
export function getEnv(): Env {
  return loadEnv();
}

/** Test helper — resets the singleton so tests can re-parse env. */
export function __resetEnvCache(): void {
  cached = null;
}
