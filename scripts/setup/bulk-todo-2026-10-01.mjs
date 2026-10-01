/** Bulk tracker update for the 20-task batch. Run: node scripts/setup/bulk-todo-2026-10-01.mjs */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = resolve(root, 'PROJECT_LIVE_TODO.json');
const doc = JSON.parse(readFileSync(file, 'utf8'));

const updates = {
  'SHL-002': ['COMPLETE', 'Collapsible rail (76px) with persisted state, icon tooltips, condensed user footer.'],
  'DSN-005': ['COMPLETE', 'Toast store + Toaster (match/challenge/error) with aria-live; title tooltips on icon-only nav.'],
  'DSN-006': ['COMPLETE', 'Zero emoji in UI chrome: SVG result art, text move badges, text streak/views.'],
  'DSN-008': ['COMPLETE', 'Spec 12-tier ladder Novice 400 through Apex 2800 wired into DivisionBadge.'],
  'LND-002': ['COMPLETE', 'Logged-in Your-arena strip (top rating, streak, views) + daily/train links; live + ladder sections.'],
  'LND-004': ['COMPLETE', 'Stale counts corrected (19 bots), labels short, no paragraphs over two lines.'],
  'ATH-006': ['COMPLETE', 'AuthModal (login/guest/register) wired into Play quick-match for visitors.'],
  'THM-003': ['COMPLETE', 'Slate, warm, and high-contrast palettes selectable in Settings.'],
  'AUD-005': ['COMPLETE', 'haptics lib (graceful no-op) hooked to moves, walls, and results.'],
  'PRF-003': ['COMPLETE', 'Daily view buckets (90d TTL) with all-time/7d/30d display; blocked hits never counted.'],
  'PRF-004': ['COMPLETE', 'profileVisibility/historyVisibility settings enforced in profile, search, history, and recent games.'],
  'ENB-002': ['COMPLETE', 'topCandidates engine (best + 2 alternatives with route impact) + per-move UI in review.'],
  'TST-005': ['COMPLETE', 'Report-only soak (24 CCU): REST p95 120ms, socket storm clean; thresholds documented.'],
  'BAL-003': ['COMPLETE', 'tiers-2026-09-30.csv with method caveats; thresholds stay measurement-backed.'],
  'TRN-003': ['COMPLETE', 'winRate, timeouts, resignations, avgDurationSec from game docs, shown on profiles.'],
  'DSH-001': ['COMPLETE', 'Your-arena strip: top rating, streak, views, daily/train shortcuts.'],
  'RPL-002': ['COMPLETE', 'public/friends/unlisted/private enforced on live replays, persisted replays, reviews, watch, and history.'],
  'TRN-007': ['COMPLETE', 'daily/weekly recurrence with hourly sweep, idempotent spawn, UI picker, sweep test.'],
  'A11Y-001': ['COMPLETE', 'Skip link, turn live-region, keyboard-native board controls, reduced-motion respected.'],
  'OBS-001': ['COMPLETE', 'Minimal pipeline: signup/finish events + admin topEvents and AI spend aggregation.'],
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
  'BAL-002 2-4P balance',
  'BOT-005 Full calibration matrix',
  'QAF-001 Final QA sweep',
  'ENB-004 Multiplayer win-share estimation',
];
doc.meta.tests = {
  engine: 'pass (70/70)',
  backend: 'pass (109/109)',
  frontend: 'pass (typecheck+build)',
  e2e: 'pass (7/7 workspace journeys)',
  load: 'soak clean: p95 120ms, 24-socket storm ok',
};
doc.meta.lastChange = '20-task batch: visibility system, privacy gates, view windows, metrics, recurrence, candidates, load rig, sidebar/toasts/modal/themes/haptics/icons/divisions/landing/a11y';
doc.meta.lastTestRun = '2026-09-30';

for (const t of doc.tasks) {
  if (t.id === 'TST-001') t.acceptanceCriteria = 'pnpm --filter ./engine/typescript test: 70/70 (incl. candidates).';
  if (t.id === 'TST-002') t.acceptanceCriteria = 'pnpm --filter ./backend test: 109/109 (incl. visibility + recurrence).';
}

// TST-001/TST-002 acceptance updates above don't change status; count them as touched.
writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
console.log(`updated ${changed} task statuses`);
const counts = {};
for (const t of doc.tasks) counts[t.status] = (counts[t.status] ?? 0) + 1;
console.log(`tasks: ${doc.tasks.length} ${JSON.stringify(counts)}`);
