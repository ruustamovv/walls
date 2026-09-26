/**
 * BullMQ stub — lazy-loaded so Redis/BullMQ are optional in dev/test.
 * Production: set REDIS_URL and enqueue AI/moderation jobs here.
 */
import { logger } from '../common/logging/logger.js';

export interface JobPayload {
  name: string;
  data: Record<string, string | number | boolean | null>;
}

interface QueueLike {
  add(name: string, data: unknown): Promise<unknown>;
  close(): Promise<void>;
}

let queue: QueueLike | null = null;
let warned = false;

async function loadQueue(): Promise<QueueLike | null> {
  if (queue !== null) return queue;
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  try {
    const [{ Queue }] = await Promise.all([import('bullmq')]);
    const Q = Queue as unknown as new (name: string, opts: unknown) => QueueLike;
    queue = new Q('nexus-jobs', { connection: { url: redisUrl } });
    return queue;
  } catch {
    if (!warned) {
      logger.warn('BullMQ/Redis unavailable — jobs run inline (stub mode)');
      warned = true;
    }
    return null;
  }
}

/** Enqueue a background job; falls back to inline no-op when Redis is absent. */
export async function enqueueJob(job: JobPayload): Promise<string> {
  const q = await loadQueue();
  if (q === null) {
    logger.info({ job: job.name }, 'job stubbed (no Redis)');
    return `stub-${Date.now()}`;
  }
  const res = (await q.add(job.name, job.data)) as { id?: unknown };
  return typeof res.id === 'string' ? res.id : `job-${Date.now()}`;
}

export async function closeJobs(): Promise<void> {
  if (queue !== null) {
    await queue.close();
    queue = null;
  }
}
