import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

/**
 * P0-2 (SHARY laptop black screen, Track A) -- /repair.html is the
 * independent rescue path: it must work even when app.js/Auth/tenant
 * hydration never succeed, and its own service worker interception must be
 * explicitly excluded (see service-worker.js's early return for it) so a
 * broken/stale worker can never intercept the one page designed to fix it.
 */
const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_REPAIR_E2E_PORT || 4723);
const server = spawn(process.execPath, [path.join(root, 'node_modules/http-server/bin/http-server'), '.', '-p', String(port), '-c-1'], { cwd: root, stdio: 'ignore' });

async function waitForServer(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${url} did not start.`);
}

function assert(condition, message) { if (!condition) throw new Error(message); }

async function run() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // 1. Loads with no app dependency at all.
    await page.goto(`http://127.0.0.1:${port}/repair.html`, { waitUntil: 'networkidle' });
    const scriptSrcs = await page.evaluate(() => [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')));
    assert(scriptSrcs.length === 0, `repair.html must not load any external script (app.js/firebase/etc) -- found: ${JSON.stringify(scriptSrcs)}`);
    assert(await page.locator('#repairBtn').isVisible(), 'Reparar CLICK 360 button must be visible');
    assert(await page.locator('#openBtn').isVisible(), 'Abrir CLICK 360 normalmente button must be visible');

    // 2. Simulate a stale registration + click360- cache, click repair, verify cleanup.
    await page.evaluate(async () => {
      // Fake a "registration" via a minimal mock so this test doesn't need
      // a real installed worker to exercise the button's own logic.
      window.__unregisterCalls = 0;
      const fakeReg = { unregister: async () => { window.__unregisterCalls++; return true; } };
      navigator.serviceWorker.getRegistrations = async () => [fakeReg];
      window.__deletedCaches = [];
      const realCachesDelete = window.caches.delete.bind(window.caches);
      window.caches.keys = async () => ['click360-old-version', 'click360-newer-version', 'some-other-app-cache'];
      window.caches.delete = async (key) => { window.__deletedCaches.push(key); return true; };
    });

    // repair.html redirects ~700ms after a successful repair; read the
    // injected globals just before that navigation would destroy them.
    await page.click('#repairBtn');
    await page.waitForTimeout(400);

    const outcome = await page.evaluate(() => ({
      unregisterCalls: window.__unregisterCalls,
      deletedCaches: window.__deletedCaches,
    }));
    console.log('REPAIR OUTCOME:', JSON.stringify(outcome));
    assert(outcome.unregisterCalls === 1, 'repair must call unregister() on every found service worker registration');
    assert(outcome.deletedCaches.includes('click360-old-version') && outcome.deletedCaches.includes('click360-newer-version'), 'repair must delete every click360- prefixed cache');
    assert(!outcome.deletedCaches.includes('some-other-app-cache'), 'repair must NEVER delete a cache that is not click360- prefixed');

    if (pageErrors.length) throw new Error(`Unexpected page errors on /repair.html: ${JSON.stringify(pageErrors)}`);
    console.log('PASS: /repair.html works standalone, unregisters SW registrations, and deletes only click360- caches.');

    // 3. Service worker must never intercept /repair.html requests, and the
    // navigate-cache-key fix must cache under the real request URL.
    const swSource = await (await fetch(`http://127.0.0.1:${port}/service-worker.js`)).text();
    assert(/pathname\.endsWith\('\/repair\.html'\)/.test(swSource), 'service-worker.js must explicitly bypass /repair.html requests');
    assert(swSource.includes('cache.put(request, copy)'), 'the navigate handler must cache under the real request, not a hardcoded string (the pre-existing bug: any navigation to a page other than / would silently overwrite the cached app shell)');
    assert(!swSource.includes("cache.put('./index.html', copy)"), 'the old hardcoded-key navigate cache write must be gone');
  } finally {
    await browser.close();
  }
}

try {
  await waitForServer(`http://127.0.0.1:${port}/repair.html`);
  await run();
} finally {
  server.kill('SIGTERM');
}
