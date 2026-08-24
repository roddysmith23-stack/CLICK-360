import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

/**
 * r37 (Section 27/28): a saved label template designed with a red
 * background rendered correctly in the wizard/live-editing path (Engine A,
 * universalDocumentFromAdvancedState) but reverted to plain
 * black-on-white once reopened from the saved-templates list, printed, or
 * exported to PDF (Engine B / canonical universal renderer,
 * universalDocumentFromTemplate). Root cause: Engine B's schema carries no
 * top-level color fields -- color lives in a `renderOptions` sidecar
 * object -- and universalDocumentFromTemplate() never built that sidecar
 * for legacy saved templates (only the live wizard path did).
 *
 * This test drives the real app.js in a browser and calls
 * universalDocumentFromTemplate() directly (exposed via window.CLICK360_QA)
 * against three template shapes, proving the color survives in every case.
 */
const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_LABEL_COLOR_E2E_PORT || 4725);
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

async function run() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof window.CLICK360_QA?.universalDocumentFromTemplate === 'function', { timeout: 15000 });

    const result = await page.evaluate(() => {
      const fromLegacyFields = window.CLICK360_QA.universalDocumentFromTemplate({
        bgColor: '#cc0000',
        fgColor: '#ffffff',
        qrBgColor: '#cc0000',
        qrMargin: 5,
        widthMm: 40, heightMm: 30,
        objects: [],
        schemaVersion: 2
      });

      const fromExistingSidecar = window.CLICK360_QA.universalDocumentFromTemplate({
        universalDocument: {
          schemaVersion: 2,
          objects: [],
          renderOptions: { background: '#0044cc', foreground: '#000000', qrBackground: '#0044cc', qrMarginRatio: 0.1 }
        }
      });

      const fromDefaults = window.CLICK360_QA.universalDocumentFromTemplate({
        objects: [],
        schemaVersion: 2
      });

      return {
        legacyBackground: fromLegacyFields?.renderOptions?.background,
        legacyForeground: fromLegacyFields?.renderOptions?.foreground,
        legacyQrBackground: fromLegacyFields?.renderOptions?.qrBackground,
        sidecarBackground: fromExistingSidecar?.renderOptions?.background,
        sidecarQrBackground: fromExistingSidecar?.renderOptions?.qrBackground,
        defaultsBackground: fromDefaults?.renderOptions?.background,
        defaultsForeground: fromDefaults?.renderOptions?.foreground,
      };
    });

    assert(result.legacyBackground === '#cc0000', `Legacy saved template must bridge bgColor into renderOptions.background, got ${result.legacyBackground}`);
    assert(result.legacyForeground === '#ffffff', `Legacy saved template must bridge fgColor into renderOptions.foreground, got ${result.legacyForeground}`);
    assert(result.legacyQrBackground === '#cc0000', `Legacy saved template must bridge qrBgColor into renderOptions.qrBackground, got ${result.legacyQrBackground}`);
    assert(result.sidecarBackground === '#0044cc', `A template that already carries a universalDocument.renderOptions sidecar must be preserved untouched, got ${result.sidecarBackground}`);
    assert(result.sidecarQrBackground === '#0044cc', `Existing sidecar qrBackground must be preserved untouched, got ${result.sidecarQrBackground}`);
    assert(result.defaultsBackground === '#ffffff', `A template with no color info at all must default to white background, got ${result.defaultsBackground}`);
    assert(result.defaultsForeground === '#000000', `A template with no color info at all must default to black foreground, got ${result.defaultsForeground}`);

    if (pageErrors.length) throw new Error(`Unexpected page errors: ${JSON.stringify(pageErrors)}`);

    console.log('CLICK 360 r37 label-color-bridge E2E PASS: universalDocumentFromTemplate bridges legacy bgColor/fgColor/qrBgColor into the canonical renderOptions sidecar (the exact fix for the red-design-renders-differently bug), preserves an existing sidecar untouched, and defaults sanely when no color info is present.');
  } finally {
    await browser.close();
  }
}

try {
  await waitForServer();
  await run();
} finally {
  server.kill('SIGTERM');
}
