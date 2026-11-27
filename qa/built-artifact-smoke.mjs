import { execFileSync, spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium, devices, webkit } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_ARTIFACT_E2E_PORT || 4285);
const url = `http://127.0.0.1:${port}/?v=commercial-1-0-5-r38-mvp-candidate`;
const output = path.join(root, 'output/playwright/release-1.0.5');

execFileSync(process.execPath, [path.join(root, 'scripts/build-static-release.mjs')], { cwd:root, stdio:'inherit' });
const server = spawn(process.execPath, [path.join(root, 'node_modules/http-server/bin/http-server'), 'dist', '-a', '127.0.0.1', '-p', String(port), '-c-1'], {
  cwd:root,
  stdio:'ignore'
});

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Built artifact did not start.');
}

async function run(name, browserType, { launch = {}, device = { viewport:{ width:390, height:844 } } } = {}) {
  const browser = await browserType.launch(launch);
  try {
    const context = await browser.newContext(device);
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    const sameOriginFailures = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('requestfailed', (request) => {
      if (request.url().startsWith(`http://127.0.0.1:${port}/`)) {
        sameOriginFailures.push(`${request.url()}:${request.failure()?.errorText || 'failed'}`);
      }
    });
    await page.goto(url, { waitUntil:'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.CLICK360_QA && window.CLICK360_RUNTIME_GUARD?.getReleaseMetadata?.().buildSha), null, {
      timeout:15000
    });
    const release = await page.evaluate(() => window.CLICK360_RUNTIME_GUARD?.getReleaseMetadata?.() || null);
    if (release?.appVersion !== '1.0.5') throw new Error(`${name} wrong app version: ${JSON.stringify(release)}`);
    if (release?.assetVersion !== 'commercial-1-0-5-r38-mvp-candidate') throw new Error(`${name} wrong asset version: ${JSON.stringify(release)}`);
    if (!release?.buildSha || release.buildSha === '__CLICK360_BUILD_SHA__') throw new Error(`${name} build SHA was not injected`);
    const manifest = await page.evaluate(async () => {
      const response = await fetch('manifest.webmanifest?v=commercial-1-0-5-r38-mvp-candidate');
      return { ok:response.ok, data:await response.json() };
    });
    if (!manifest.ok || manifest.data.display !== 'standalone'
      || !String(manifest.data.start_url || '').includes('commercial-1-0-5-r38-mvp-candidate')) {
      throw new Error(`${name} PWA manifest is stale`);
    }
    if (browserType === chromium) {
      await page.evaluate(async () => {
        const ready = navigator.serviceWorker?.ready;
        if (!ready) throw new Error('Service Worker API unavailable');
        await Promise.race([
          ready,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Service Worker readiness timeout')), 8000))
        ]);
      });
      const caches = await page.evaluate(() => window.caches.keys());
      if (!caches.includes(`click360-commercial-1-0-5-r38-mvp-candidate-${release.buildSha}`)) {
        throw new Error(`Chromium Service Worker cache mismatch: ${JSON.stringify(caches)}`);
      }
    }
    if (consoleErrors.length || pageErrors.length || sameOriginFailures.length) {
      throw new Error(`${name} unexpected runtime errors: ${JSON.stringify({ consoleErrors, pageErrors, sameOriginFailures })}`);
    }
    await page.screenshot({ path:path.join(output, `artifact-${name}.png`), fullPage:true });
    if (browserType === chromium) {
      await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout:10000 });
      await page.evaluate(() => localStorage.setItem('qa-artifact-reopen', 'retained'));
      await context.setOffline(true);
      await page.close();
      const reopened = await context.newPage();
      const offlineNavigation = await reopened.goto(url, { waitUntil:'domcontentloaded' });
      if (!offlineNavigation?.fromServiceWorker()) throw new Error(`${name} offline shell did not come from the service worker`);
      await reopened.waitForFunction(expected =>
        window.CLICK360_RUNTIME_GUARD?.getReleaseMetadata?.().buildSha === expected, release.buildSha);
      // The headless shell can retain navigator.onLine=true on a new target
      // after the transport is already offline. This URL bypasses the worker.
      const { retained, manifestReachable } = await reopened.evaluate(async () => ({
        retained:localStorage.getItem('qa-artifact-reopen') === 'retained',
        manifestReachable:await fetch('./release-manifest.json', { cache:'no-store' }).then(() => true, () => false)
      }));
      if (manifestReachable) throw new Error(`${name} offline transport was not isolated`);
      if (!retained) throw new Error(`${name} offline reopening lost origin state`);
    }
    console.log(`RELEASE GUARDIAN PASS ${process.platform} ${name} ${browser.version()} ${release.buildSha}`);
  } finally {
    await browser.close();
  }
}

try {
  await mkdir(output, { recursive:true });
  await waitForServer();
  const platform = process.env.CLICK360_ARTIFACT_PLATFORM || 'default';
  if (platform === 'windows') {
    if (process.platform !== 'win32') throw new Error('Windows release check requires a Windows runner');
    await run('chrome', chromium, { launch:{ channel:'chrome' }, device:devices['Desktop Chrome'] });
    await run('msedge', chromium, { launch:{ channel:'msedge' }, device:devices['Desktop Edge'] });
  } else if (platform === 'mac') {
    if (process.platform !== 'darwin') throw new Error('macOS release check requires a Mac');
    await run('chrome', chromium, { launch:{ channel:'chrome' }, device:devices['Desktop Chrome'] });
    await run('ipad-webkit', webkit, { device:devices['iPad Pro 11'] });
  } else if (platform === 'default') {
    await run('chromium', chromium);
    if (process.env.SKIP_WEBKIT !== '1') await run('webkit', webkit);
  } else {
    throw new Error(`Unknown release-check platform: ${platform}`);
  }
} finally {
  server.kill('SIGTERM');
}
