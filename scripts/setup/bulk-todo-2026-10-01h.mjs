/** Bulk tracker update: cosmetics + admin billing. */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = resolve(root, 'PROJECT_LIVE_TODO.json');
const doc = JSON.parse(readFileSync(file, 'utf8'));

const updates = {
  'COS-001': ['COMPLETE', 'Profile-frame catalog (3 free + 3 premium-gated), server-side equip, avatar rings, settings picker.'],
  'ADM-010': ['COMPLETE', 'Billing tab: provider status, grant counts, recent Stripe events; entitlements grant/revoke already live.'],
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
doc.meta.currentPhase = '12';
doc.meta.currentEpic = 'Training & puzzles';
doc.meta.currentTask = 'TRN-004 Multiplayer training sets';
doc.meta.next = [
  'AIC-008 Architect board generator',
  'TST-006 Real-browser E2E harness',
  'MLT-009 Special modes (Fog/Team/Chaos/Siege)',
  'FRP-002 Anti-cheat signals + review queue',
  'QAF-001 Final QA sweep',
];
doc.meta.tests = {
  engine: 'pass (74/74)',
  backend: 'pass (127/127)',
  frontend: 'pass (typecheck+build)',
  e2e: 'pass (8/8 workspace journeys)',
  load: 'soak clean: p95 120ms, 24-socket storm ok',
};
doc.meta.lastChange = 'Cosmetics frames + admin billing tab; backend 127/127';
doc.meta.lastTestRun = '2026-09-30';

for (const t of doc.tasks) {
  if (t.id === 'TST-002') t.acceptanceCriteria = 'pnpm --filter ./backend test: 127/127 (incl. cosmetics).';
}

writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
console.log(`updated ${changed} task statuses`);
const counts = {};
for (const t of doc.tasks) counts[t.status] = (counts[t.status] ?? 0) + 1;
console.log(`tasks: ${doc.tasks.length} ${JSON.stringify(counts)}`);
