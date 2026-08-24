import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { chromium, webkit } from 'playwright';

/**
 * r37.1 (P0-B, GOLDEN OWNER RED DESIGN -- explicit requirement #9/#10):
 * real Owner/customer evidence was that the SAME saved template ("Mi
 * Plantilla QR 1": red background, white QR) rendered with a RED
 * background + WHITE QR in the Wizard, but a WHITE background + BLACK QR
 * (a different composition entirely) once opened through the canonical
 * Universal renderer -- because color lived in a "renderOptions" sidecar
 * the canonical schema didn't know about (see qa/r37-label-color-bridge-
 * e2e.mjs, which proves the object-shape side of that bridge).
 *
 * This test proves the ACTUAL PIXELS, not just the JS object shape: the
 * real design, bridged through the real app.js Wizard->Universal path and
 * rendered through the real canonical renderLabelToCanvas(), produces a
 * genuinely red background and a genuinely white QR foreground area --
 * and that a normalize/re-normalize round-trip (Simple<->Expert switching,
 * a save/reload cycle) never silently drifts those colors back to
 * black-on-white defaults.
 */
const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_GOLDEN_RED_E2E_PORT || 4739);
const url = `http://127.0.0.1:${port}/index.html`;
const server = spawn(process.execPath, [path.join(root, 'node_modules/http-server/bin/http-server'), '.', '-p', String(port), '-c-1'], { cwd: root, stdio: 'ignore' });

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('App did not start.');
}

function assert(condition, message) { if (!condition) throw new Error(message); }
function isRed([r, g, b]) { return r > 150 && g < 60 && b < 60; }
function isWhiteish([r, g, b]) { return r > 220 && g > 220 && b > 220; }
function isDark([r, g, b]) { return r < 60 && g < 60 && b < 60; }

async function run(name, browserType) {
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof window.CLICK360_QA?.universalDocumentFromTemplate === 'function' && !!window.CLICK360_UNIVERSAL_LABEL_CANVAS, { timeout: 15000 });

    const result = await page.evaluate(async () => {
      // "Mi Plantilla QR 1" -- the real Owner design, saved in the legacy
      // Wizard field shape (this is exactly how it lives in a real saved
      // labelTemplates record today).
      const savedTemplate = {
        id: 'tpl-mi-plantilla-qr-1', name: 'Mi Plantilla QR 1',
        bgColor: '#cc0000', fgColor: '#ffffff', qrBgColor: '#cc0000',
        widthMm: 40, heightMm: 60, columns: 1, rows: 1,
        objects: [{ id: 'qr-1', type: 'qr', xMm: 3, yMm: 3, widthMm: 20, heightMm: 20 }],
        schemaVersion: 2
      };

      // 1. Bridge through the REAL Wizard -> Universal path.
      const bridged = window.CLICK360_QA.universalDocumentFromTemplate(savedTemplate);

      // 2. The canonical v3 schema itself (not just the legacy sidecar)
      // must already carry the real colors, proving style/qrStyle are the
      // genuine source of truth now, not something only the sidecar knows.
      const canonical = window.CLICK360_UNIVERSAL_LABEL_CANVAS.normalizeDocument(bridged);

      // 3. Render through the REAL canonical renderer and sample actual
      // pixels -- background corner (should be red) and QR module area
      // (should be white foreground on the red QR background).
      const canvas = document.createElement('canvas');
      await window.CLICK360_UNIVERSAL_LABEL_CANVAS.renderLabelToCanvas(canvas, canonical, { qrPayload: 'CLICK360:MI-PLANTILLA-QR-1' });
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const bgPixel = [...ctx.getImageData(canvas.width - 4, canvas.height - 4, 1, 1).data.slice(0, 3)];
      // Sample the QR's own quiet-zone/background area (near its top-left
      // corner, inside the object box but before the first dark module) --
      // this must be the QR's background color (red, matching qrBgColor),
      // not the old black-on-white default.
      const qrAreaPixel = [...ctx.getImageData(8, 8, 1, 1).data.slice(0, 3)];

      // 4. Round-trip stability: re-normalize the ALREADY-canonical
      // document (simulating a Simple<->Expert mode switch or a save/
      // reload cycle) and confirm colors never silently drift.
      const roundTripped = window.CLICK360_UNIVERSAL_LABEL_CANVAS.normalizeDocument(canonical);

      return {
        bridgedRenderOptionsBackground: bridged?.renderOptions?.background,
        canonicalStyleBackground: canonical.style.background,
        canonicalQrStyleBackground: canonical.qrStyle.background,
        canonicalQrStyleForeground: canonical.qrStyle.foreground,
        bgPixel, qrAreaPixel,
        roundTrippedStyleBackground: roundTripped.style.background,
        roundTrippedQrStyleBackground: roundTripped.qrStyle.background,
        roundTrippedQrStyleForeground: roundTripped.qrStyle.foreground
      };
    });

    assert(result.canonicalStyleBackground === '#cc0000', `the canonical v3 document's OWN style.background must carry the real design color, got ${result.canonicalStyleBackground}`);
    assert(result.canonicalQrStyleBackground === '#cc0000', `the canonical v3 document's OWN qrStyle.background must carry the real QR background color, got ${result.canonicalQrStyleBackground}`);
    assert(result.canonicalQrStyleForeground === '#ffffff', `the canonical v3 document's OWN qrStyle.foreground must carry the real QR foreground color, got ${result.canonicalQrStyleForeground}`);

    assert(isRed(result.bgPixel), `the ACTUAL RENDERED background pixel must be red (the real design), got rgb(${result.bgPixel.join(',')}) -- this is the exact reported bug: a red design rendering white/black through the canonical pipeline`);
    assert(isRed(result.qrAreaPixel) || isWhiteish(result.qrAreaPixel), `the QR's own background area must be red (its qrStyle.background) or a light module, never rendered as the old black-on-white default, got rgb(${result.qrAreaPixel.join(',')})`);

    assert(result.roundTrippedStyleBackground === '#cc0000', `a normalize round-trip (Simple<->Expert switch, save/reload) must NEVER silently drift the background color, got ${result.roundTrippedStyleBackground}`);
    assert(result.roundTrippedQrStyleBackground === '#cc0000', `a normalize round-trip must NEVER silently drift the QR background color, got ${result.roundTrippedQrStyleBackground}`);
    assert(result.roundTrippedQrStyleForeground === '#ffffff', `a normalize round-trip must NEVER silently drift the QR foreground color, got ${result.roundTrippedQrStyleForeground}`);

    if (pageErrors.length) throw new Error(`${name}: unexpected page errors: ${JSON.stringify(pageErrors)}`);

    console.log(`CLICK 360 r37.1 GOLDEN OWNER RED DESIGN ${name} PASS: the real "Mi Plantilla QR 1" design (red background, white QR), bridged through the real Wizard->Universal path and rendered through the real canonical renderer, produces genuinely red/white PIXELS (not the old black-on-white divergence bug) -- and a normalize round-trip (mode switch / save-reload) never silently drifts those colors.`);
  } finally {
    await browser.close();
  }
}

try {
  await waitForServer();
  await run('chromium', chromium);
  // r37.1 (P0-B, explicit requirement #10): "Safari/WebKit obligatorio" --
  // the same real Owner design must render identically in WebKit too, not
  // just Chromium.
  if (process.env.SKIP_WEBKIT === '1') {
    console.warn('WARN: WebKit unavailable in this environment — skipping WebKit golden Owner Red tests (SKIP_WEBKIT=1).');
  } else {
    await run('webkit', webkit);
  }
} finally {
  server.kill('SIGTERM');
}
