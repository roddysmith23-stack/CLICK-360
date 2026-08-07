import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

// Runs the REAL drawLabelOnCanvas() (extracted verbatim from app.js by
// qa/extract-legacy-label-renderer.cjs, not a reimplementation) against a persisted-template
// shape matching what openAdvancedLabelModal actually loads from state.settings.labelTemplates.
// This is the dynamic counterpart to qa-r32-tdz-regression.cjs: that test proves the wizard's
// own wiring no longer throws before it can render; this test proves the renderer itself
// produces real pixels once it's actually invoked with real persisted-template data.

const root = path.resolve(import.meta.dirname, '..');
// Regenerate the extracted bundle unconditionally so this script is runnable standalone (not
// just via `npm run qa:r32`), and always reflects app.js's current source, not a stale bundle.
execFileSync(process.execPath, [path.join(root, 'qa/extract-legacy-label-renderer.cjs')], { stdio: 'inherit' });
const port = Number(process.env.CLICK360_R32_LEGACY_PORT || 4200);
const url = `http://127.0.0.1:${port}/qa/fixtures/r32-legacy-template-preview.html`;
const server = spawn(process.execPath, [path.join(root, 'node_modules/http-server/bin/http-server'), '.', '-p', String(port), '-c-1'], { cwd: root, stdio: 'ignore' });

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('r32 legacy-template-preview fixture did not start');
}

try {
  await waitForServer();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', { timeout: 15000 });
    const result = await page.evaluate(() => window.__CLICK360_R32_LEGACY_PREVIEW_QA__);

    if (result.error) throw new Error(`drawLabelOnCanvas threw on the real persisted-template shape: ${result.error}`);
    if (!result.canvasWidth || !result.canvasHeight) throw new Error(`canvas has zero dimensions: ${result.canvasWidth}x${result.canvasHeight}`);
    if (result.nonWhitePixels < 200) throw new Error(`preview is blank/near-blank for a real persisted template: only ${result.nonWhitePixels} non-white pixels (this is exactly the production report — a saved QR+name+price template rendering empty)`);
    if (errors.length) throw new Error(`browser errors while rendering the persisted template: ${JSON.stringify(errors)}`);

    console.log(`CLICK360_R32_LEGACY_TEMPLATE_PREVIEW_E2E: PASS (${result.nonWhitePixels} non-white pixels, price="${result.expectedPrice}")`);
  } finally {
    await browser.close();
  }
} finally {
  server.kill('SIGTERM');
}
