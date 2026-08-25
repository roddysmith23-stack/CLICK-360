import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { chromium, webkit } from 'playwright';

/**
 * r37.2 (mission item #19, LABEL VIEWPORT): "Mobile: canvas visible; pan
 * táctil; zoom; Ajustar a pantalla. Ninguna etiqueta puede quedar 'fuera'
 * sin forma de verla." A real "Ajustar a pantalla" (fit to screen) control
 * did not previously exist -- only a manual 0.5x-2x zoom slider. This
 * proves the new #ulcFitScreen button computes a zoom that actually fits
 * the current paper inside the real viewport, at both a small phone width
 * and desktop, and that the resulting stage never overflows its container.
 */
const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_FIT_SCREEN_E2E_PORT || 4742);
const url = `http://127.0.0.1:${port}/qa/fixtures/p2-universal-label-canvas.html`;
const server = spawn(process.execPath, [path.join(root, 'node_modules/http-server/bin/http-server'), '.', '-p', String(port), '-c-1'], { cwd: root, stdio: 'ignore' });

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Fixture did not start.');
}

function assert(condition, message) { if (!condition) throw new Error(message); }

async function run(name, browserType) {
  const browser = await browserType.launch();
  try {
    for (const viewport of [{ width: 360, height: 740 }, { width: 1440, height: 900 }]) {
      const page = await browser.newPage({ viewport });
      const pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push(e.message));
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', { timeout: 15000 });
      await page.waitForSelector('#ulcFitScreen', { state: 'visible', timeout: 10000 });

      const zoomLabel = await page.$eval('#ulcFitScreen', (el) => el.textContent.trim());
      assert(zoomLabel === 'Ajustar a pantalla', `[${name}/${viewport.width}] the fit-to-screen button must be labeled exactly "Ajustar a pantalla", got "${zoomLabel}"`);

      // Force an extreme zoom first (the opposite end of whichever direction
      // fit-to-screen would need to move at this viewport size) so the fit
      // action has real work to do -- a small phone needs to zoom DOWN to
      // fit, a spacious desktop may already be at/near the max 2x slider
      // value once fit, so start from the min instead.
      const startZoom = viewport.width <= 720 ? '2' : '0.5';
      await page.fill('#ulcZoom', startZoom);
      await page.dispatchEvent('#ulcZoom', 'input');

      await page.click('#ulcFitScreen');
      await page.waitForTimeout(100);
      const zoomAfter = await page.$eval('#ulcZoomValue', (el) => el.textContent);
      assert(zoomAfter !== `${Math.round(Number(startZoom) * 100)}%`, `[${name}/${viewport.width}] clicking "Ajustar a pantalla" must actually change the zoom away from the forced extreme (${startZoom}), got ${zoomAfter}`);

      const geometry = await page.evaluate(() => {
        const viewport = document.getElementById('ulcViewport');
        const stage = document.getElementById('ulcStage');
        const v = viewport.getBoundingClientRect();
        const s = stage.getBoundingClientRect();
        return { viewportWidth: v.width, viewportHeight: v.height, stageWidth: s.width, stageHeight: s.height, scrollWidth: viewport.scrollWidth, clientWidth: viewport.clientWidth };
      });
      assert(geometry.stageWidth <= geometry.viewportWidth + 4, `[${name}/${viewport.width}] after fit-to-screen the stage width (${geometry.stageWidth}) must fit within the viewport width (${geometry.viewportWidth})`);
      assert(geometry.stageHeight <= geometry.viewportHeight + 4, `[${name}/${viewport.width}] after fit-to-screen the stage height (${geometry.stageHeight}) must fit within the viewport height (${geometry.viewportHeight})`);

      if (pageErrors.length) throw new Error(`[${name}/${viewport.width}] unexpected page errors: ${JSON.stringify(pageErrors)}`);
      await page.close();
    }
    console.log(`CLICK 360 r37.2 label fit-to-screen ${name} PASS: "Ajustar a pantalla" exists, is labeled correctly, and produces a zoom level where the label stage genuinely fits inside the real viewport at both a phone width and desktop.`);
  } finally {
    await browser.close();
  }
}

try {
  await waitForServer();
  await run('chromium', chromium);
  if (process.env.SKIP_WEBKIT === '1') {
    console.warn('WARN: WebKit unavailable in this environment — skipping WebKit fit-to-screen tests (SKIP_WEBKIT=1).');
  } else {
    await run('webkit', webkit);
  }
} finally {
  server.kill('SIGTERM');
}
