/**
 * Premium daily-pack generator: builds 100 engine-graded puzzles for a date
 * and stores them in `puzzle_packs` for the pack routes to serve.
 *
 * Run: pnpm --filter ./backend puzzles:pack [--date YYYY-MM-DD]
 * Cron: once per day (generation takes minutes — NEVER on the request path).
 *
 * AI taste: when a provider is configured the model steers selection exactly
 * like the free daily; otherwise the deterministic default applies. Either
 * way the stored `tasteSource` says which one picked.
 */
import '../config/env.js'; // side effect: loads the repo-root .env (dotenv)
import { getMongoDb, closeMongo } from '../database/mongodb/client.js';
import { ensureIndexes } from '../database/mongodb/indexes.js';
import { COLLECTIONS } from '../database/mongodb/collections.js';
import {
  buildPackItems,
  PREMIUM_PACK_SIZE,
} from '../modules/puzzles/service.js';
import { PuzzleRepository } from '../database/mongodb/repositories/extended.repositories.js';
import { DEFAULT_TASTE, curatedDaily, todayKey, type DailyPuzzle, type PuzzleTaste } from '../../../engine/typescript/dist/puzzles/index.js';

function fail(msg: string): never {
  console.error(`[puzzles:pack] ERROR: ${msg}`);
  process.exit(1);
}

async function resolveTaste(date: string): Promise<{ taste: PuzzleTaste; source: 'ai' | 'default' }> {
  const { activeProvider } = await import('../modules/ai/provider.js');
  const provider = activeProvider();
  if (provider === null) return { taste: DEFAULT_TASTE, source: 'default' };
  try {
    const { proposePuzzleTaste } = await import('../modules/ai/complete.js');
    // Taste is picked over a cheap scout pool; the full pack is ranked after.
    const { seededPuzzlePool } = await import('../../../engine/typescript/dist/puzzles/index.js');
    const scout = seededPuzzlePool(date, `pack-${date}`, date, 6, 24);
    if (scout.length === 0) return { taste: DEFAULT_TASTE, source: 'default' };
    const res = await proposePuzzleTaste(`pack-puzzle:${date}`, provider.id, {
      date,
      candidates: scout.map((e) => ({ gain: e.quality.solutionGain, gap: e.quality.uniqueGap, tension: e.quality.tension })),
    });
    if (!res.ok) return { taste: DEFAULT_TASTE, source: 'default' };
    return { taste: res.taste, source: 'ai' };
  } catch (err) {
    console.warn(`[puzzles:pack] taste fell back to default: ${err instanceof Error ? err.message : err}`);
    return { taste: DEFAULT_TASTE, source: 'default' };
  }
}

async function main(): Promise<void> {
  const dateArg = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const date = dateArg ?? todayKey();
  const db = await getMongoDb().catch((err: unknown) => fail(`mongo unreachable: ${err instanceof Error ? err.message : err}`));
  await ensureIndexes(db).catch(() => undefined);

  const existing = (await db.collection(COLLECTIONS.puzzle_packs).findOne({ packId: `pack-${date}` }).catch(() => null)) as { items?: unknown[] } | null;
  if (existing !== null && Array.isArray(existing.items) && existing.items.length >= PREMIUM_PACK_SIZE) {
    console.log(`[puzzles:pack] pack-${date} already complete — refusing to overwrite (delete the doc to regenerate).`);
    await closeMongo().catch(() => undefined);
    return;
  }

  const { taste, source } = await resolveTaste(date);
  console.log(`[puzzles:pack] building pack-${date} (taste: ${source})…`);
  const t0 = Date.now();
  const items: DailyPuzzle[] = buildPackItems(date, taste, PREMIUM_PACK_SIZE, 160, 24, (done, kept) => {
    console.log(`[puzzles:pack] seeds ${done}/160 — ${kept} candidates`);
  });
  console.log(`[puzzles:pack] ranked ${items.length} puzzles in ${Math.round((Date.now() - t0) / 1000)}s`);
  if (items.length === 0) fail('no puzzles generated');

  await db.collection(COLLECTIONS.puzzle_packs).updateOne(
    { packId: `pack-${date}` },
    {
      $set: {
        packId: `pack-${date}`,
        date,
        tasteSource: source,
        items,
        createdAt: new Date(),
      },
    },
    { upsert: true },
  );
  console.log(`[puzzles:pack] stored pack-${date} (${items.length} items, taste ${source})`);

  // Warm the FREE daily cache too: otherwise the first visitor of the day
  // pays the full pool-generation cost on the request path. Same taste,
  // same engine, stored through the same upsert the route reads.
  try {
    const daily = curatedDaily(date, taste);
    const repo = new PuzzleRepository(db);
    await repo.upsertDaily({
      puzzleId: daily.puzzleId,
      date,
      prompt: daily.prompt,
      position: {
        size: daily.size,
        turn: daily.turn,
        pawns: daily.pawns,
        walls: daily.walls,
        wallsRemaining: daily.wallsRemaining,
      },
      solution: daily.solution,
      needGain: daily.needGain,
      solutionGain: daily.solutionGain,
      ...(daily.difficulty !== undefined ? { difficulty: daily.difficulty } : {}),
      ...(daily.alternatives !== undefined ? { alternatives: daily.alternatives } : {}),
      taste,
      tasteSource: source,
    });
    console.log(`[puzzles:pack] warmed daily-${date} (${daily.difficulty ?? 'classic'}, +${daily.solutionGain})`);
  } catch (err) {
    console.warn(`[puzzles:pack] daily warm failed (route will generate on demand): ${err instanceof Error ? err.message : err}`);
  }
  await closeMongo().catch(() => undefined);
}

void main().then(
  () => process.exit(0),
  (err: unknown) => fail(err instanceof Error ? err.message : String(err)),
);
