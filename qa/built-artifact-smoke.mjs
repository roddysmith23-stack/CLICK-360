import { execFileSync, spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium, webkit } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_ARTIFACT_E2E_PORT || 4285);
const url = `http://127.0.0.1:${port}/?v=commercial-1-0-5-r38-mvp-candidate`;
const output = path.join(root, 'output/playwright/release-1.0.5');

execFileSync('npm', ['run', 'build:static'], { cwd:root, stdio:'inherit' });
const server = spawn(process.execPath, [path.join(root, 'node_modules/http-server/bin/http-server'), 'dist', '-p', String(port), '-c-1'], {
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

async function run(name, browserType, options = {}) {
  const browser = await browserType.launch(options);
  try {
    const page = await browser.newPage({ viewport:{ width:390, height:844 } });
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
    if (!manifest.ok || !String(manifest.data.start_url || '').includes('commercial-1-0-5-r38-mvp-candidate')) {
      throw new Error(`${name} PWA manifest is stale`);
    }
    if (name === 'chromium') {
      await page.evaluate(async () => {
        const ready = navigator.serviceWorker?.ready;
        if (!ready) throw new Error('Service Worker API unavailable');
        await Promise.race([
          ready,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Service Worker readiness timeout')), 8000))
        ]);
      });
      const caches = await page.evaluate(() => window.caches.keys());
      if (!caches.includes('click360-commercial-1-0-5-r38-mvp-candidate')) {
        throw new Error(`Chromium Service Worker cache mismatch: ${JSON.stringify(caches)}`);
      }
    }
    if (consoleErrors.length || pageErrors.length || sameOriginFailures.length) {
      throw new Error(`${name} unexpected runtime errors: ${JSON.stringify({ consoleErrors, pageErrors, sameOriginFailures })}`);
    }
    await page.screenshot({ path:path.join(output, `artifact-${name}-390.png`), fullPage:true });
  } finally {
    await browser.close();
  }
}

try {
  await mkdir(output, { recursive:true });
  await waitForServer();
  await run('chromium', chromium);
  if (process.env.SKIP_WEBKIT === '1') {
    console.warn('WARN: WebKit unavailable in this environment — skipping WebKit built-artifact smoke tests (SKIP_WEBKIT=1).');
  } else {
    await run('webkit', webkit);
  }
  console.log('CLICK 360 1.0.5 built artifact Chromium/WebKit smoke PASS');
} finally {
  server.kill('SIGTERM');
}
