import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_R31_ADDITIVE_PORT || 4198);
const url = `http://127.0.0.1:${port}/qa/fixtures/r31-universal-canvas-additive.html`;
const server = spawn(process.execPath, [path.join(root, 'node_modules/http-server/bin/http-server'), '.', '-p', String(port), '-c-1'], { cwd: root, stdio: 'ignore' });

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('r31 additive-canvas fixture did not start');
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
    await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    const result = await page.evaluate(() => window.__CLICK360_R31_ADDITIVE_QA__);
    if (errors.length) throw new Error(`browser errors: ${JSON.stringify(errors)}`);

    if (result.rectCorners === 0) throw new Error('default shape must still fill corners (regression vs. pre-additive rendering)');
    if (result.circleCorners !== 0) throw new Error(`circle shape must clip corners to transparent/background, found ${result.circleCorners} painted pixels`);

    if (result.straightTopLeft === 0) throw new Error('unrotated content must render in its authored quadrant (top-left)');
    if (result.straightBottomRight !== 0) throw new Error('unrotated content must not bleed into the opposite quadrant');
    if (result.rotatedBottomRight === 0) throw new Error('180deg contentRotation must move ink into the opposite (bottom-right) quadrant');
    if (result.rotatedTopLeft !== 0) throw new Error('180deg contentRotation must clear the original (top-left) quadrant');

    if (result.noMarginInk <= result.wideMarginInk) throw new Error(`qrMarginRatio must shrink drawn QR ink (no-margin=${result.noMarginInk}, wide-margin=${result.wideMarginInk})`);

    if (result.legacyLayoutInk === 0) throw new Error('legacy layout logo field with imageData must render non-blank pixels');
    if (result.logoObjectType !== 'image') throw new Error(`legacy layout 'logo' key must normalize to an image object, got '${result.logoObjectType}'`);
    if (!result.logoObjectHasImageData) throw new Error('legacy layout logo object lost its imageData during normalization');

    console.log(`CLICK360_R31_UNIVERSAL_CANVAS_ADDITIVE_E2E: PASS ${JSON.stringify(result)}`);
  } finally {
    await browser.close();
  }
} finally {
  server.kill('SIGTERM');
}
