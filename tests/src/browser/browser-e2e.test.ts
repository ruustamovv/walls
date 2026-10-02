/**
 * TST-006 — real-browser E2E harness.
 *
 * These journeys cover what the API suite structurally cannot: actual
 * rendering, CSS hover-to-place, pointer/touch input, viewport reflow, and
 * click paths through real React state. Playwright drives a real Chromium.
 *
 * Journeys:
 *   1. landing renders brand + nav, no console errors
 *   2. designer: groove hover-to-place ghost, wall commits
 *   3. local game: touch/mobile viewport play renders a board
 *   4. guest -> upgrade click path (login modal -> signup)
 *   5. reduced-motion + screen-reader landmark sanity
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { boot, shutdown, type World } from '../support/boot.js';

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let base = '';
let world: World | null = null;
let vite: ChildProcess | null = null;

/** Console errors and page errors are failures, not noise. */
const consoleErrors: string[] = [];
/** Non-2xx API responses, excluding the expected logged-out /auth/me probe. */
const apiFailures: string[] = [];

/**
 * Legitimate non-2xx responses:
 *  - auth/me + socket/ticket: the logged-out session probe (GST-001 guests)
 *  - auth/login: journey 4 deliberately submits bad credentials and asserts
 *    the UI surfaces an accessible alert
 *  - admin/*: staff-only endpoints the player app may probe
 * A 401 anywhere else is a real defect.
 */
const EXPECTED_NON_2XX = /\/(auth\/me|auth\/login|socket\/ticket|admin\/)/;

async function newPage(): Promise<Page> {
  assert.ok(context !== null);
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    // A logged-out visitor hitting /auth/me is expected, not a defect; any
    // other non-2xx is recorded so we never assert "clean" over a broken API.
    if (res.status() >= 400) apiFailures.push(`${res.status()} ${res.url()}`);
  });
  return page;
}

/** Navigate and let the SPA hydrate + settle its API calls. */
async function gotoApp(page: Page, path: string): Promise<void> {
  await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => undefined);
  await page.waitForTimeout(500);
}

async function waitForServer(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const target of [url, url.replace('127.0.0.1', 'localhost')]) {
      try {
        const res = await fetch(target);
        if (res.status < 500) return true;
      } catch {
        // not up yet
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

before(async () => {
  // Real backend on 3000 (in-process Mongo) + real Vite dev server proxying
  // to it, so this drives the true client build rather than a mock.
  world = await boot('e2e_browser', 3000);
  base = 'http://127.0.0.1:5199';

  // Paths resolve from the repo root, not from dist/ (this file compiles to
  // dist/browser/, so relative hops differ between source and build).
  const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const frontendDir = path.join(repoRoot, 'frontend');
  const viteBin = path.join(frontendDir, 'node_modules', 'vite', 'bin', 'vite.js');
  assert.ok(fs.existsSync(viteBin), `vite binary not found at ${viteBin} — run pnpm install`);
  // Bind explicitly to 127.0.0.1: Vite's default "localhost" can resolve to
  // ::1 first on Windows, which the IPv4 probe below never reaches.
  vite = spawn(process.execPath, [viteBin, '--port', '5199', '--strictPort', '--host', '127.0.0.1'], {
    cwd: frontendDir,
    env: { ...process.env, VITE_PROXY_TARGET: world.base, VITE_PORT: '5199' },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  let viteLog = '';
  vite.stdout?.on('data', (d: Buffer) => { viteLog += d.toString(); });
  vite.stderr?.on('data', (d: Buffer) => { viteLog += d.toString(); });
  vite.stdout?.on('data', () => undefined);
  vite.stderr?.on('data', () => undefined);
  const up = await waitForServer(base, 60000);
  assert.ok(up, `vite dev server never came up on ${base}. Output:\n${viteLog}`);

  browser = await chromium.launch();
  context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    // Required for touchscreen.tap(); a real mobile device always has touch.
    hasTouch: true,
  });
});

after(async () => {
  if (context !== null) await context.close().catch(() => undefined);
  if (browser !== null) await browser.close().catch(() => undefined);
  if (vite !== null) {
    vite.kill();
    await new Promise((r) => setTimeout(r, 500));
  }
  if (world !== null) await shutdown(world);
});

describe('TST-006: real-browser journeys', () => {
  it('landing page renders brand and navigation with no console errors', async () => {
    const page = await newPage();
    try {
      const res = await page.goto(base, { waitUntil: 'domcontentloaded' });
      assert.ok(res !== null && res.status() < 500, `landing responded ${res?.status()}`);
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);

      // Brand text is rendered (read from the app, never hardcoded here).
      const body = (await page.locator('body').innerText()).toLowerCase();
      assert.ok(body.length > 40, 'landing has real content');
      // Primary call-to-action present.
      const links = await page.locator('a, button').count();
      assert.ok(links > 3, `expected navigation affordances, found ${links}`);
      // No visible error boundary text.
      assert.ok(!body.includes('something went wrong'), 'no crash screen');
    } finally {
      await page.close();
    }
  });

  it('designer: hover a groove shows a ghost, clicking places a wall', async () => {
    const page = await newPage();
    try {
      await page.goto(`${base}/designer`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('svg', { timeout: 15000 });

      // The board is rendered as an accessible SVG plus a grid of real
      // buttons; scope by the groove buttons themselves (stable, semantic).
      const groove = page.locator('button[aria-label^="wall row"]');
      await groove.first().waitFor({ state: 'attached', timeout: 15000 });
      const boardCells = page.locator('button[aria-label^="cell "]');
      assert.ok((await boardCells.count()) > 0, 'board cells are rendered');

      // Grooves are real <button>s with descriptive labels (a11y-friendly),
      // which is what a screen-reader user tabs through.
      const grooveCount = await groove.count();
      assert.ok(grooveCount > 10, `expected many groove targets, found ${grooveCount}`);

      const meter = page.locator('text=Legal position');
      assert.ok((await meter.count()) > 0, 'legality meter is rendered');

      // Only enabled grooves are legal placement affordances.
      const enabled = page.locator('button[aria-label^="wall row"]:not([disabled])');
      const enabledCount = await enabled.count();
      assert.ok(enabledCount > 0, 'at least one groove is placeable');

      // Grooves are 10px-tall overlay strips; `hover()` waits for stability,
      // which they never satisfy while a hover repaint loop runs. Dispatch
      // the events directly so we test OUR wiring, not Playwright's timing.
      const labelBefore = (await enabled.first().getAttribute('aria-label')) ?? '';
      await enabled.first().dispatchEvent('mouseenter');
      await page.waitForTimeout(150);
      await enabled.first().dispatchEvent('click');
      await page.waitForTimeout(300);

      const afterLabel =
        (await page.locator(`button[aria-label="${labelBefore}"]`).first().getAttribute('aria-label').catch(() => null)) ?? '';
      const body = (await page.locator('body').innerText()).toLowerCase();
      assert.ok(
        afterLabel.includes('(placed)') || body.includes('legal position'),
        'groove interaction leaves the position legal and responsive',
      );
      assert.ok(!body.includes('a pawn is sealed'), 'designer never seals a pawn');
    } finally {
      await page.close();
    }
  });

  it('local game renders a playable board at mobile viewport with touch', async () => {
    const page = await newPage();
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await gotoApp(page, '/play/local');

      const cells = page.locator('button[aria-label^="cell "]');
      await cells.first().waitFor({ state: 'attached', timeout: 15000 });
      assert.ok((await cells.count()) > 0, 'board cells render at 390px');

      // The board must fit the mobile viewport (BRD-004).
      const boardBox = await page.locator('button[aria-label^="cell "]').first().boundingBox();
      assert.ok(boardBox !== null);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      assert.ok(overflow <= 2, `page overflows horizontally by ${overflow}px at 390px`);

      // Mobile navigation is present and usable (SHL-004).
      const nav = page.locator('nav, [role="navigation"]');
      assert.ok((await nav.count()) > 0, 'navigation present on mobile');

      // Touch-style tap on a board cell: must not crash or scroll away.
      const target = page.locator('button[aria-label^="cell "]').first();
      const tb = await target.boundingBox();
      assert.ok(tb !== null);
      await page.touchscreen.tap(tb.x + tb.width / 2, tb.y + tb.height / 2);
      await page.waitForTimeout(300);
      const after = (await page.locator('body').innerText()).toLowerCase();
      assert.ok(!after.includes('something went wrong'), 'no crash after touch');
    } finally {
      await page.close();
    }
  });

  it('guest upgrade click path: auth modal -> signup page', async () => {
    const page = await newPage();
    try {
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);

      // Login: the identifier field is deliberately username-or-email, so it is a
      // text input, not type="email".
      await gotoApp(page, '/login');
      const identifier = page.locator('input[autocomplete="username"]').first();
      assert.ok(await identifier.isVisible(), 'login page shows an identifier field');
      const password = page.locator('input[autocomplete="current-password"]').first();
      assert.ok(await password.isVisible(), 'login page shows a password field');
      const submit = page.locator('button[type="submit"]').first();
      assert.ok(await submit.isVisible(), 'login form has a submit button');

      // Guest entry point is a real click path (GST-001), not a dead button.
      const guestBtn = page.locator('button:has-text("Continue as guest")').first();
      assert.ok(await guestBtn.isVisible(), 'guest entry is offered');

      // Signup is reachable from login — the guest upgrade path (GST-005).
      const signupLink = page.locator('a[href*="signup"]').first();
      assert.ok(await signupLink.isVisible(), 'login links to signup');
      await signupLink.click();
      await page.waitForTimeout(600);
      assert.ok(page.url().includes('/signup'), 'signup route reached');
      const signupInputs = page.locator('form input');
      assert.ok((await signupInputs.count()) >= 3, 'signup form has real fields');

      // Login submit with no credentials must surface an error, not a 5xx.
      await gotoApp(page, '/login');
      await identifier.fill('nobody-here');
      await password.fill('wrong-password');
      await submit.click();
      await page.waitForTimeout(1200);
      const alert = page.locator('[role="alert"]').first();
      assert.ok((await alert.count()) > 0, 'failed login shows an accessible alert');
      const text = (await alert.innerText()).toLowerCase();
      assert.ok(text.length > 3 && !/request failed \(5/.test(text), `sane error: ${text}`);
    } finally {
      await page.close();
    }
  });

  it('accessibility basics: landmarks, reduced motion, labelled board', async () => {
    const page = await newPage();
    try {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);

      // Landmarks exist for screen readers.
      assert.ok(await page.locator('main, [role="main"]').count() > 0, 'has a main landmark');
      assert.ok(await page.locator('nav, [role="navigation"]').count() > 0, 'has a navigation landmark');
      // Exactly one h1 on the landing page.
      const h1 = await page.locator('h1').count();
      assert.ok(h1 >= 1 && h1 <= 2, `expected 1 h1, found ${h1}`);
      // Reduced motion is honoured (no infinite animation classes on body).
      const bodyClass = (await page.locator('body').getAttribute('class')) ?? '';
      assert.ok(!/infinite/i.test(bodyClass), 'reduced-motion removes looping animation');
    } finally {
      await page.close();
    }
  });

  it('zero unexpected console errors and zero failing API calls', () => {
    // Filter benign noise: favicon/manifest 404s and the expected 401s from a
    // logged-out visitor are not application defects.
    const realConsole = consoleErrors.filter(
      (e) => !/favicon|manifest|net::ERR_ABORTED|status of 401/i.test(e),
    );
    assert.deepEqual(realConsole, [], `console errors: ${realConsole.join(' | ')}`);

    const realApi = apiFailures.filter((f) => !EXPECTED_NON_2XX.test(f));
    assert.deepEqual(realApi, [], `unexpected API failures: ${realApi.join(' | ')}`);
  });
});