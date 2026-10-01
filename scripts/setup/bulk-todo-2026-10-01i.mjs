/** Bulk tracker update: multi training puzzles. */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = resolve(root, 'PROJECT_LIVE_TODO.json');
const doc = JSON.parse(readFileSync(file, 'utf8'));

const updates = {
  'TRN-004': ['COMPLETE', 'Daily 4P choke puzzles (seeded, deterministic) graded by multi evaluation; party UI; solves count toward XP.'],
};

let changed = 0;
for (const t of doc.tasks) {
  const u = updates[t.id];
  if (u !== undefined && t.status !== u[0]) {
    t.status = u[0];
    t.lastUpdated = '2026-09-30';
    changed++;
  }
}
doc.meta.currentPhase = '16';
doc.meta.currentEpic = 'AI provider roles';
doc.meta.currentTask = 'AIC-008 Architect board generator';
doc.meta.next = [
  'TST-006 Real-browser E2E harness',
  'MLT-009 Special modes (Fog/Team/Chaos/Siege)',
  'FRP-002 Anti-cheat signals + review queue',
  'QAF-001 Final QA sweep',
  'MLT-007 Placement + first-win-end rules',
];
doc.meta.tests = {
  engine: 'pass (77/77)',
  backend: 'pass (127/127)',
  frontend: 'pass (typecheck+build)',
  e2e: 'pass (9/9 workspace journeys)',
  load: 'soak clean: p95 120ms, 24-socket storm ok',
};
doc.meta.lastChange = 'Party puzzles: daily 4P choke generation + grading by multi eval + UI; engine 77/77, e2e 9/9';
doc.meta.lastTestRun = '2026-09-30';

for (const t of doc.tasks) {
  if (t.id === 'TST-001') t.acceptanceCriteria = 'pnpm --filter ./engine/typescript test: 77/77 (incl. multi puzzles).';
}

writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
console.log(`updated ${changed} task statuses`);
const counts = {};
for (const t of doc.tasks) counts[t.status] = (counts[t.status] ?? 0) + 1;
console.log(`tasks: ${doc.tasks.length} ${JSON.stringify(counts)}`);
