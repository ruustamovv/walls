/** Bulk tracker update: 12-task batch (guest nav, verify, classic, XP, chat safety, win-share, config, balance, analytics, spectator). */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = resolve(root, 'PROJECT_LIVE_TODO.json');
const doc = JSON.parse(readFileSync(file, 'utf8'));

const updates = {
  'SHL-006': ['COMPLETE', 'Guests get the public shelf plus register CTA; auth-gated items hidden on sidebar, tabs, and drawer.'],
  'ATH-004': ['COMPLETE', 'Hashed 24h verify tokens, dev-log fallback, /verify-email page, settings badge + resend; covered by e2e.'],
  'WCH-002': ['COMPLETE', 'Spectators get the live commentary slot and read-only table talk through the linked game view.'],
  'REV-002': ['COMPLETE', 'REVIEW_THRESHOLDS centralizes every cutoff; behavior-identical refactor with shape test.'],
  'BAL-002': ['COMPLETE', '2-6P numbers recorded in multi-balance.md with sample-size honesty; no preset changes; full matrix still pending.'],
  'PRF-006': ['COMPLETE', 'Derived XP (10/game, 5/puzzle, 20/lesson) plus 1-100 curve on profiles; never matchmade on.'],
  'RAT-005': ['COMPLETE', 'Classic 10+0/10+5 pool end-to-end: TCs, settlement, profile, history, leaderboard, UI.'],
  'CHT-003': ['COMPLETE', 'Deterministic blocklist plus spam/shout shapes on all three chat channels; sub-blocking content auto-reported.'],
  'AIM-002': ['COMPLETE', 'On-demand AI triage per report row (human decides); no per-message LLM in the hot path.'],
  'ENB-004': ['COMPLETE', 'Deterministic route-softmax win shares with confidence, shown labeled in party details.'],
  'OBS-001': ['COMPLETE', 'Minimal pipeline: signup/finish events plus admin topEvents and AI spend aggregation.'],
  'CHT-004': ['COMPLETE', 'Friend-only DM threads with scope/filter/guest gates, REST polling UI, full gate tests.'],
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
doc.meta.currentPhase = '21';
doc.meta.currentEpic = 'Data + testing + QA';
doc.meta.currentTask = 'QAF-001 Final QA sweep';
doc.meta.next = [
  'BOT-005 Full calibration matrix',
  'TST-006 Real-browser E2E harness',
  'TRN-004 Multiplayer training sets',
  'AIC-006 Mirror style-bot',
  'PRM-003 Stripe abstraction + webhook',
];
doc.meta.tests = {
  engine: 'pass (74/74)',
  backend: 'pass (117/117)',
  frontend: 'pass (typecheck+build)',
  e2e: 'pass (8/8 workspace journeys)',
  load: 'soak clean: p95 120ms, 24-socket storm ok',
};
doc.meta.lastChange = '12-task batch: classic pool, XP, verify flow, guest nav, chat filter + AI triage, win shares, thresholds config, balance notes, analytics, DMs';
doc.meta.lastTestRun = '2026-09-30';

for (const t of doc.tasks) {
  if (t.id === 'TST-002') t.acceptanceCriteria = 'pnpm --filter ./backend test: 117/117 (incl. DMs, moderation, verify, classic).';
}

writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
console.log(`updated ${changed} task statuses`);
const counts = {};
for (const t of doc.tasks) counts[t.status] = (counts[t.status] ?? 0) + 1;
console.log(`tasks: ${doc.tasks.length} ${JSON.stringify(counts)}`);
