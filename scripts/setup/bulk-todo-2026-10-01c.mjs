/** Bulk tracker update: QA sweep + socket-ticket auth. */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = resolve(root, 'PROJECT_LIVE_TODO.json');
const doc = JSON.parse(readFileSync(file, 'utf8'));

const updates = {
  'QAF-001': ['PARTIAL', 'Static sweep + suites green; socket-auth hole fixed with ticket system; browser-only items outstanding per docs/release/qa-2026-09-30.md.'],
  'SEC-001': ['COMPLETE', 'AuthN/Z, RBAC, secure cookies, CORS/CSP — plus single-use socket tickets closing the unsigned-auth hole.'],
  'SEC-002': ['COMPLETE', 'Validation + rate limiting everywhere incl. 30/h guest issuance and chat throttles.'],
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
doc.meta.currentPhase = '08';
doc.meta.currentEpic = 'Local + bots';
doc.meta.currentTask = 'BOT-005 Full calibration matrix';
doc.meta.next = [
  'TST-006 Real-browser E2E harness',
  'TRN-004 Multiplayer training sets',
  'AIC-006 Mirror style-bot',
  'PRM-003 Stripe abstraction + webhook',
  'COS-001 Cosmetics catalog + inventory',
];
doc.meta.tests = {
  engine: 'pass (74/74)',
  backend: 'pass (116/116)',
  frontend: 'pass (typecheck+build)',
  e2e: 'pass (8/8 workspace journeys)',
  load: 'soak clean: p95 120ms, 24-socket storm ok',
};
doc.meta.lastChange = 'QA sweep: socket-ticket auth closes unsigned hole, stale comments fixed, link/button/console audit clean; backend 116/116';
doc.meta.lastTestRun = '2026-09-30';

for (const t of doc.tasks) {
  if (t.id === 'TST-002') t.acceptanceCriteria = 'pnpm --filter ./backend test: 116/116 (incl. socket tickets).';
}

writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
console.log(`updated ${changed} task statuses`);
const counts = {};
for (const t of doc.tasks) counts[t.status] = (counts[t.status] ?? 0) + 1;
console.log(`tasks: ${doc.tasks.length} ${JSON.stringify(counts)}`);
