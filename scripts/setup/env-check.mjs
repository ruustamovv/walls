#!/usr/bin/env node
/**
 * env-check — `pnpm env:check`. Zero dependencies.
 * Reads required/optional keys from `.env.example`, checks `process.env`,
 * prints [OK]/[MISSING], exits 0 (warnings only; CI may gate with --strict).
 * Never prints secret values.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const examplePath = resolve(root, ".env.example");

// Required: MongoDB + Redis + auth secrets + public URLs.
const REQUIRED = new Set([
  "MONGODB_URI", "MONGODB_DB_NAME", "REDIS_URL",
  "JWT_SECRET", "COOKIE_SECRET", "SESSION_SECRET",
  "CORS_ORIGINS", "FRONTEND_URL", "BACKEND_URL", "API_URL", "WS_URL",
]);

const FEATURE_OF = {
  GROQ_API_KEY: "AI/groq", OPENAI_API_KEY: "AI/openai",
  ANTHROPIC_API_KEY: "AI/anthropic", GEMINI_API_KEY: "AI/gemini",
  OPENROUTER_API_KEY: "AI/openrouter",
  AI_MODEL_CHAT: "AI/chat", AI_MODEL_ANALYSIS: "AI/review", AI_MODEL_TTS: "AI/tts",
  S3_ENDPOINT: "storage", S3_BUCKET: "storage", S3_ACCESS_KEY: "storage",
  S3_SECRET_KEY: "storage", SENTRY_DSN: "monitoring", OTEL_ENDPOINT: "monitoring",
  GOOGLE_CLIENT_ID: "auth/google", GOOGLE_CLIENT_SECRET: "auth/google",
  GITHUB_CLIENT_ID: "auth/github", GITHUB_CLIENT_SECRET: "auth/github",
  SMTP_HOST: "email", SMTP_USER: "email", SMTP_PASS: "email",
  STRIPE_SECRET_KEY: "payments", OWNER_INITIAL_PASSWORD: "owner bootstrap",
};

function parseKeys(path) {
  const keys = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m) keys.push(m[1]);
  }
  return [...new Set(keys)];
}

const strict = process.argv.includes("--strict");
if (!existsSync(examplePath)) {
  console.error(`[ERROR] .env.example not found at ${examplePath}`);
  process.exit(strict ? 1 : 0);
}

const keys = parseKeys(examplePath);
let missingRequired = 0, missingOptional = 0;
console.log(`env:check — ${keys.length} keys from .env.example (env: ${process.env.NODE_ENV ?? "unset"})`);
for (const k of keys) {
  const v = process.env[k];
  const present = v !== undefined && v !== "";
  const required = REQUIRED.has(k);
  let tag;
  if (present) tag = "[OK]";
  else if (required) tag = "[MISSING:required]";
  else tag = "[MISSING:optional]";
  const feat = !present && FEATURE_OF[k] ? ` (feature: ${FEATURE_OF[k]})` : "";
  // Labels for the §9 summary block:
  let label = k;
  if (k === "MONGODB_URI") label = "MongoDB";
  if (k === "REDIS_URL") label = "Redis";
  if (k === "GROQ_API_KEY") label = "Groq";
  if (k === "OPENAI_API_KEY") label = "OpenAI";
  if (k === "ANTHROPIC_API_KEY") label = "Anthropic";
  if (k === "GEMINI_API_KEY") label = "Gemini";
  if (k === "STRIPE_SECRET_KEY") label = "Stripe";
  if (k === "S3_ENDPOINT" || k === "S3_BUCKET") label = "S3";
  if (k === "SMTP_HOST") label = "SMTP";
  if (k === "SENTRY_DSN") label = "Sentry";
  const shown = present && /SECRET|KEY|PASS|TOKEN|DSN|URI/i.test(k) ? "configured" : (present ? v : "missing");
  console.log(`${tag} ${label} ........ ${shown}${feat}`);
  if (!present) (required ? missingRequired++ : missingOptional++);
}
console.log(`\nsummary: ${keys.length - missingRequired - missingOptional} ok, ` +
  `${missingRequired} required missing, ${missingOptional} optional/feature missing`);
if (missingRequired > 0) {
  console.log("hint: cp .env.example .env  and fill required keys (see README env table).");
  console.log("local dev: MONGODB_URI=mongodb://localhost:27017, MONGODB_DB_NAME=project_nexus, REDIS_URL=redis://localhost:6379");
  if (strict) process.exit(1);
}
process.exit(0);
