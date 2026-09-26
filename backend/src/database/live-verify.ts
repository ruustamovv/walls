/**
 * Live DB verification runner (dev-only, NOT part of `pnpm test`).
 * Boots a real `mongod` (mongodb-memory-server) + uses the real Redis at
 * REDIS_URL (start one via `docker compose up -d redis`), then executes the
 * committed integration suites (dist/tests/mongo.test.js, redis.test.js)
 * with live env vars.
 *
 * Cleanup guarantee: mongod + child test process are torn down in a
 * `finally` block, so a failing suite can never orphan an ephemeral
 * mongod. Exit code mirrors the suite result (0 = pass, non-zero = fail)
 * and the original assertion output is never hidden.
 *
 * Usage: pnpm --filter ./backend verify:live
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { MongoMemoryServer } from 'mongodb-memory-server';

function runSuites(env: NodeJS.ProcessEnv, onChild: (child: ChildProcess) => void): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const child: ChildProcess = spawn(
      process.execPath,
      ['--test', 'dist/tests/mongo.test.js', 'dist/tests/redis.test.js'],
      {
        cwd: process.cwd(), // run from backend/ (dist/ + node_modules resolve there)
        env,
        stdio: 'inherit',
      },
    );
    onChild(child);
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

/** Gracefully terminate the suite child (SIGTERM, SIGKILL fallback). No-op when already gone. */
function terminate(child: ChildProcess | null): Promise<void> {
  if (child === null || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise<void>((resolve) => {
    child.once('close', () => resolve());
    try {
      child.kill('SIGTERM');
    } catch {
      resolve();
      return;
    }
    // Fallback: force-kill a child that ignores SIGTERM. Unref'd so the
    // watchdog itself can never keep this process alive.
    setTimeout(() => {
      try {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      } catch {
        // already gone
      }
    }, 5000).unref();
  });
}

async function main(): Promise<void> {
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  console.log('[verify:live] starting ephemeral mongod...');
  const mongod = await MongoMemoryServer.create({ instance: { dbName: 'nexus_verify' } });
  let child: ChildProcess | null = null;
  const onSignal = (signal: string): void => {
    // Ctrl+C / termination must still tear down the child + mongod.
    // The `finally` below performs the actual cleanup once the child closes.
    console.log(`[verify:live] received ${signal} — cleaning up...`);
    if (process.exitCode === undefined) process.exitCode = 1;
    void terminate(child).catch(() => undefined);
  };
  process.once('SIGINT', () => onSignal('SIGINT'));
  process.once('SIGTERM', () => onSignal('SIGTERM'));
  try {
    const uri = mongod.getUri();
    console.log(`[verify:live] mongod up at ${uri.replace(/\/\/.*@/, '//***@')}, redis at ${redisUrl}`);
    const env = { ...process.env, MONGODB_URI: uri, MONGODB_DB_NAME: 'nexus_verify', REDIS_URL: redisUrl };
    const code = await runSuites(env, (c) => {
      child = c;
    });
    console.log(code === 0 ? '[verify:live] ALL LIVE CHECKS PASSED' : '[verify:live] FAILURES — see above');
    process.exitCode = code;
  } finally {
    // Never orphan the suite child or the ephemeral mongod —
    // runs on pass, on failure, and on spawn errors alike.
    await terminate(child);
    await mongod.stop().catch((err: unknown) => {
      console.error('[verify:live] mongod stop failed:', err instanceof Error ? err.message : err);
    });
    console.log('[verify:live] cleanup done');
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
