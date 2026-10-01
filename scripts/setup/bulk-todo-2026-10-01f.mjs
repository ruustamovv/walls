/** Bulk tracker update: Mirror + Ghost personal AI. */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = resolve(root, 'PROJECT_LIVE_TODO.json');
const doc = JSON.parse(readFileSync(file, 'utf8'));

const updates = {
  'AIC-006': ['COMPLETE', 'Style-fitted bot (wall rate, efficiency, aggression) from your games; Mirror panel + play flow.'],
  'AIC-007': ['COMPLETE', 'Ghost races replay exact opponent scripts with rookie fallback; picker + scripted driver.'],
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
doc.meta.currentPhase = '19';
doc.meta.currentEpic = 'Analytics + premium + payments';
doc.meta.currentTask = 'PRM-003 Stripe abstraction + webhook';
doc.meta.next = [
  'COS-001 Cosmetics catalog + inventory',
  'ADM-010 Payments/subscriptions/cosmetics sections',
  'TRN-004 Multiplayer training sets',
  'AIC-008 Architect board generator',
  'TST-006 Real-browser E2E harness',
];
doc.meta.tests = {
  engine: 'pass (74/74)',
  backend: 'pass (121/121)',
  frontend: 'pass (typecheck+build)',
  e2e: 'pass (8/8 workspace journeys)',
  load: 'soak clean: p95 120ms, 24-socket storm ok',
};
doc.meta.lastChange = 'Mirror style-bot + ghost races: fitted personalities and exact opponent replays with fallback; backend 121/121';
doc.meta.lastTestRun = '2026-09-30';

for (const t of doc.tasks) {
  if (t.id === 'TST-002') t.acceptanceCriteria = 'pnpm --filter ./backend test: 121/121 (incl. mirror/ghost).';
}

writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
console.log(`updated ${changed} task statuses`);
const counts = {};
for (const t of doc.tasks) counts[t.status] = (counts[t.status] ?? 0) + 1;
console.log(`tasks: ${doc.tasks.length} ${JSON.stringify(counts)}`);
