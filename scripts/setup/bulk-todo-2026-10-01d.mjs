/** Bulk tracker update: BOT-005 full matrix. */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = resolve(root, 'PROJECT_LIVE_TODO.json');
const doc = JSON.parse(readFileSync(file, 'utf8'));

for (const t of doc.tasks) {
  if (t.id === 'BOT-005') {
    t.status = 'COMPLETE';
    t.acceptanceCriteria = 'Full 19x19 matrix run (171 pairings, artifact matrix-2026-09-30.json); legend fixed via replyWalls (16.7->58.3); anchors kept as human-difficulty guides with documented bot-pool bias note.';
    t.filesOrAreas = ['engine/typescript/benchmark/calibrate.ts', 'engine/typescript/calibration/'];
    t.lastUpdated = '2026-09-30';
  }
  if (t.id === 'TST-001') t.acceptanceCriteria = 'pnpm --filter ./engine/typescript test: 74/74 (incl. candidates + win-share + thresholds).';
}
doc.meta.currentPhase = '21';
doc.meta.currentEpic = 'Data + testing + QA';
doc.meta.currentTask = 'TST-006 Real-browser E2E harness';
doc.meta.next = [
  'TRN-004 Multiplayer training sets',
  'AIC-006 Mirror style-bot',
  'PRM-003 Stripe abstraction + webhook',
  'COS-001 Cosmetics catalog + inventory',
  'CHT-004 Friend DMs',
];
doc.meta.tests = {
  engine: 'pass (74/74)',
  backend: 'pass (116/116)',
  frontend: 'pass (typecheck+build)',
  e2e: 'pass (8/8 workspace journeys)',
  load: 'soak clean: p95 120ms, 24-socket storm ok',
};
doc.meta.lastChange = 'Full bot matrix (171 pairings) + legend fix via wall-reply + anchor policy documented; engine 74/74';
doc.meta.lastTestRun = '2026-09-30';

writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
const counts = {};
for (const t of doc.tasks) counts[t.status] = (counts[t.status] ?? 0) + 1;
console.log(`tasks: ${doc.tasks.length} ${JSON.stringify(counts)}`);
