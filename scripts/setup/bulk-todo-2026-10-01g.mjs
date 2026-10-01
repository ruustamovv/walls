/** Bulk tracker update: Stripe abstraction + webhook. */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = resolve(root, 'PROJECT_LIVE_TODO.json');
const doc = JSON.parse(readFileSync(file, 'utf8'));

const updates = {
  'PRM-003': ['COMPLETE', 'Stripe provider abstraction (dep-free HMAC webhook, idempotent grants), checkout session route, honest disabled UI; proven by signature + HTTP tests.'],
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
doc.meta.currentTask = 'COS-001 Cosmetics catalog + inventory';
doc.meta.next = [
  'ADM-010 Payments/subscriptions/cosmetics sections',
  'TRN-004 Multiplayer training sets',
  'AIC-008 Architect board generator',
  'TST-006 Real-browser E2E harness',
  'MLT-009 Special modes (Fog/Team/Chaos/Siege)',
];
doc.meta.tests = {
  engine: 'pass (74/74)',
  backend: 'pass (126/126)',
  frontend: 'pass (typecheck+build)',
  e2e: 'pass (8/8 workspace journeys)',
  load: 'soak clean: p95 120ms, 24-socket storm ok',
};
doc.meta.lastChange = 'Stripe abstraction: dep-free webhook verification, idempotent bundle grants, checkout route, honest UI; backend 126/126';
doc.meta.lastTestRun = '2026-09-30';

for (const t of doc.tasks) {
  if (t.id === 'TST-002') t.acceptanceCriteria = 'pnpm --filter ./backend test: 126/126 (incl. stripe webhook).';
}

writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
console.log(`updated ${changed} task statuses`);
const counts = {};
for (const t of doc.tasks) counts[t.status] = (counts[t.status] ?? 0) + 1;
console.log(`tasks: ${doc.tasks.length} ${JSON.stringify(counts)}`);
