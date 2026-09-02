import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { chromium, webkit } from 'playwright';

// Actual index.html and inline recovery logic, not a recreated UI. Domain
// failures are injected by withholding the two application scripts; external
// endpoints are blocked and no account is authenticated.
const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_R38_BOOT_FAILURE_PORT || 4791);
const target = process.env.CLICK360_R38_BOOT_TARGET;
assert(!target || target === 'https://click360-staging-7620168025.web.app', 'Only local or dedicated staging, never production');
const origin = target || `http://127.0.0.1:${port}`;
const server = target ? null : spawn(process.execPath, [path.join(root, 'node_modules/http-server/bin/http-server'), '.', '-p', String(port), '-c-1'], { cwd: root, stdio: 'ignore' });
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { ready = (await fetch(`${origin}/index.html`)).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert(ready, 'local test server ready');
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch();
    try {
      for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
        const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
        try {
          await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.origin !== origin || /\/(?:app|firebase-service)\.js$/.test(url.pathname)) return route.abort('failed');
            return route.continue();
          });
          const page = await context.newPage();
          await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
          await page.locator('#click360BootRetry').waitFor({ state: 'visible', timeout: 18000 });
          assert(await page.locator('#click360BootUpdate').isVisible(), 'JS domain failure exposes safe recovery actions');
          assert.match(await page.locator('#click360Splash').innerText(), /no pudo iniciar/);
          // A warm reload with the same failing resources also retains the
          // bounded recovery floor, never an empty app after splash removal.
          await page.reload({ waitUntil: 'domcontentloaded' });
          await page.locator('#click360BootRetry').waitFor({ state: 'visible', timeout: 18000 });
          await context.setOffline(true);
          await page.locator('#click360BootUpdate').click();
          await page.waitForFunction(() => document.querySelector('.click360BootRecoveryMsg')?.textContent.includes('No pudimos actualizar ahora'));
          assert(await page.locator('#click360BootRetry').isVisible(), 'offline update keeps the recovery screen');
          assert.equal(await page.locator('#click360BootUpdate').isDisabled(), false, 'offline update cannot leave an infinite disabled button');
          await context.setOffline(false);
          assert(await page.locator('#click360BootRetry').isVisible(), 'online transition preserves a usable fallback');
          console.log(`PASS ${name} ${viewport.width}x${viewport.height}: actual cold/warm JS failure -> bounded UI, offline safe-update rollback -> online usable recovery`);
        } finally { await context.close(); }
      }
    } finally { await browser.close(); }
  }
  console.log('CLICK 360 r38 actual-index black-screen browser matrix PASS.');
} finally { server?.kill('SIGTERM'); }
