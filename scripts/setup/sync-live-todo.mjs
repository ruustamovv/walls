#!/usr/bin/env node
/**
 * sync-live-todo — copy PROJECT_LIVE_TODO.json into frontend/public/
 * so the dev-only overlay can fetch /live-todo.json.
 * Never gate production builds on this file.
 */
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const src = resolve(root, 'PROJECT_LIVE_TODO.json');
const dst = resolve(root, 'frontend', 'public', 'live-todo.json');

if (!existsSync(src)) {
  console.error('[sync-live-todo] PROJECT_LIVE_TODO.json not found');
  process.exit(1);
}
copyFileSync(src, dst);
console.log('[sync-live-todo] copied to frontend/public/live-todo.json');
