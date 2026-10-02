#!/usr/bin/env node
/**
 * Pre-flight doctor — answers "can I run this right now, and if not, what
 * exactly do I fix?" before anyone starts a dev server.
 *
 * Checks, in order of how often they block a boot:
 *   1. .env present (root) + REQUIRED vars non-empty
 *   2. engine dist built (the backend imports engine/typescript/dist)
 *   3. MongoDB reachable (pings the configured URI)
 *   4. Redis reachable (WARN only — the server runs degraded without it)
 *   5. ports free: 3000 backend, 5173 frontend, 5174 admin
 *
 * Exit code 0 when the stack can boot, 1 otherwise.
 * Never prints secret VALUES (lengths only).
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const REQUIRED = [
  'MONGODB_URI', 'MONGODB_DB_NAME', 'REDIS_URL',
  'JWT_SECRET', 'COOKIE_SECRET', 'SESSION_SECRET',
];
const MIN_LEN = 16;

const envPath = path.join(repo, '.env');
const env = Object.create(null);
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].trim();
  }
}

let failures = 0;
let warnings = 0;
const ok = (m) => console.log(`  \x1b[32mOK\x1b[0m    ${m}`);
const warn = (m) => { warnings++; console.log(`  \x1b[33mWARN\x1b[0m  ${m}`); };
const bad = (m) => { failures++; console.log(`  \x1b[31mFAIL\x1b[0m  ${m}`); };

function portOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    const done = (v) => { s.destroy(); resolve(v); };
    s.setTimeout(1200);
    s.on('connect', () => done(true));
    s.on('timeout', () => done(false));
    s.on('error', () => done(false));
  });
}

console.log('\nEnvironment');
if (!fs.existsSync(envPath)) {
  bad('.env not found at repo root');
  console.log('         cp .env.example .env  then paste MONGODB_URI + secrets');
} else {
  ok('.env found');
  const missing = REQUIRED.filter((k) => (env[k] ?? '') === '');
  const short = REQUIRED.filter(
    (k) => (env[k] ?? '') !== '' && (env[k] ?? '').length < MIN_LEN && k.endsWith('_SECRET'),
  );
  if (missing.length > 0) {
    bad(`empty required vars: ${missing.join(', ')}`);
    console.log('         fill them in .env (never commit it — it is gitignored)');
  } else {
    ok(`${REQUIRED.length} required vars set`);
  }
  if (short.length > 0) {
    bad(`secrets shorter than ${MIN_LEN} chars: ${short.join(', ')}`);
  }
  if (env.MONGODB_DB_NAME) ok(`database: ${env.MONGODB_DB_NAME}`);
}

console.log('\nBuilds');
const engineDist = path.join(repo, 'engine/typescript/dist/index.js');
if (fs.existsSync(engineDist)) {
  const ageMin = Math.round((Date.now() - fs.statSync(engineDist).mtimeMs) / 60000);
  ok(`engine dist built${ageMin > 60 ? ` (${Math.round(ageMin / 60)}h old — rebuild if you changed engine code)` : ''}`);
} else {
  bad('engine dist missing — the backend imports engine/typescript/dist');
  console.log('         run: pnpm build:engine');
}
if (fs.existsSync(path.join(repo, 'node_modules'))) ok('node_modules installed');
else { bad('node_modules missing'); console.log('         run: pnpm install'); }

console.log('\nServices');
if ((env.MONGODB_URI ?? '') !== '') {
  try {
    const { MongoClient } = await import(
      pathToFileURL(path.join(repo, 'backend/node_modules/mongodb/lib/index.js')).href
    );
    const client = new MongoClient(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
    });
    const t0 = Date.now();
    try {
      await client.connect();
      const cols = await client.db(env.MONGODB_DB_NAME).listCollections().toArray();
      ok(`MongoDB reachable (${Date.now() - t0}ms, ${cols.length} collections in ${env.MONGODB_DB_NAME})`);
    } finally {
      await client.close().catch(() => {});
    }
  } catch (err) {
    bad(`MongoDB unreachable: ${err instanceof Error ? err.message : String(err)}`);
  }
} else {
  bad('MONGODB_URI empty — cannot test MongoDB');
}

const redisUrl = new URL(env.REDIS_URL ?? 'redis://localhost:6379');
if ((env.REDIS_URL ?? '') === '') {
  warn('REDIS_URL empty — server will boot degraded');
} else {
  const open = await portOpen(Number(redisUrl.port || 6379), redisUrl.hostname);
  if (open) ok(`Redis reachable at ${redisUrl.hostname}:${redisUrl.port || 6379}`);
  else {
    warn(`Redis unreachable at ${redisUrl.hostname}:${redisUrl.port || 6379}`);
    console.log('         server still boots: sessions fall back to process-local memory');
    console.log('         matchmaking / presence / queues run DEGRADED');
    console.log('         fix: start Redis (docker run -d -p 6379:6379 redis:7) or point REDIS_URL elsewhere');
  }
}

console.log('\nPorts');
for (const [name, port] of [['backend', 3000], ['frontend', 5173], ['admin', 5174]]) {
  if (await portOpen(port)) warn(`${port} (${name}) already in use — stop it first or that app will not start`);
  else ok(`${port} (${name}) free`);
}

console.log('');
if (failures === 0) {
  console.log(`\x1b[32mReady to run.\x1b[0m ${warnings > 0 ? `(${warnings} warning(s) above)` : ''}`);
  console.log('  pnpm dev            # engine build + backend :3000 + frontend :5173 + admin :5174');
  console.log('  pnpm start          # production build, all services');
  process.exit(0);
} else {
  console.log(`\x1b[31m${failures} blocking issue(s).\x1b[0m Fix the FAIL lines above, then re-run: pnpm doctor`);
  process.exit(1);
}