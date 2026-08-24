import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

/**
 * r37.1 (P0-B, explicit requirement): "Para cada QR generado en tests:
 * renderiza el output REAL y vuelve a decodificarlo con ZXing/jsQR... El
 * test no pasa solamente porque existe un <canvas>. Debe recuperar el
 * payload correcto."
 *
 * This actually renders a QR through the real, canonical
 * renderLabelToCanvas() pipeline, reads the canvas pixels back out, and
 * decodes them with jsQR -- proving the rendered output is genuinely
 * scannable, not just visually present. Covers the exact professional
 * rules the brief called out: custom foreground/background colors
 * (including a real design's red/white), small and large physical sizes,
 * and both common thermal-printer DPIs.
 */
const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_QR_SCANNER_E2E_PORT || 4738);
const url = `http://127.0.0.1:${port}/qa/fixtures/r37-1-qr-scanner-validation.html`;
const server = spawn(process.execPath, [path.join(root, 'node_modules/http-server/bin/http-server'), '.', '-p', String(port), '-c-1'], { cwd: root, stdio: 'ignore' });

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Fixture server did not start.');
}

function assert(condition, message) { if (!condition) throw new Error(message); }

const CASES = [
  { name: 'default-black-on-white', payload: 'CLICK360:DEFAULT', style: {}, widthMm: 20, dpi: 203 },
  { name: 'real-owner-red-design', payload: 'CLICK360:MI-PLANTILLA-QR-1', style: { background: '#cc0000', foreground: '#111111' }, qrStyle: { foreground: '#ffffff', background: '#cc0000' }, widthMm: 20, dpi: 203 },
  { name: 'high-contrast-blue', payload: 'CLICK360:BLUE-9988', style: {}, qrStyle: { foreground: '#0a1a5c', background: '#fefefe' }, widthMm: 18, dpi: 300 },
  { name: 'minimum-recommended-size', payload: 'CLICK360:SMALL-0001', style: {}, widthMm: 15, dpi: 203 },
  { name: 'large-size', payload: 'CLICK360:LARGE-000000000000001', style: {}, widthMm: 35, dpi: 300 }
];

async function run() {
  const browser = await chromium.launch();
  try {
    await waitForServer();
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof window.__renderAndDecode === 'function' && !!window.CLICK360_UNIVERSAL_LABEL_CANVAS, { timeout: 15000 });

    for (const testCase of CASES) {
      const result = await page.evaluate(async ({ payload, style, qrStyle, widthMm, dpi }) => {
        const documentInput = {
          paper: { widthMm: 60, heightMm: 40, columns: 1, rows: 1 },
          style,
          objects: [{ id: 'qr-1', type: 'qr', xMm: 2, yMm: 2, widthMm, heightMm: widthMm }],
          ...(qrStyle ? { qrStyle } : {})
        };
        return window.__renderAndDecode(documentInput, payload, dpi);
      }, testCase);
      assert(result.decodedText !== null, `[${testCase.name}] the rendered QR must be scannable -- jsQR found nothing decodable at ${testCase.widthMm}mm/${testCase.dpi}dpi (widthPx=${result.widthPx}, heightPx=${result.heightPx})`);
      assert(result.decodedText === testCase.payload, `[${testCase.name}] the decoded payload must exactly match what was encoded, got "${result.decodedText}" expected "${testCase.payload}"`);
    }

    // Explicit 1:1 proof: a QR object saved with mismatched width/height
    // must still render (and decode) as a perfect square, never stretched.
    const squareResult = await page.evaluate(async () => {
      const documentInput = {
        paper: { widthMm: 60, heightMm: 40, columns: 1, rows: 1 },
        objects: [{ id: 'qr-1', type: 'qr', xMm: 2, yMm: 2, widthMm: 30, heightMm: 12 }]
      };
      const normalized = window.CLICK360_UNIVERSAL_LABEL_CANVAS.normalizeDocument(documentInput);
      const decode = await window.__renderAndDecode(documentInput, 'CLICK360:SQUARE-CHECK', 203);
      return { widthMm: normalized.objects[0].widthMm, heightMm: normalized.objects[0].heightMm, decodedText: decode.decodedText };
    });
    assert(squareResult.widthMm === squareResult.heightMm, `a QR object must be forced square regardless of mismatched saved width/height, got widthMm=${squareResult.widthMm} heightMm=${squareResult.heightMm}`);
    assert(squareResult.decodedText === 'CLICK360:SQUARE-CHECK', 'the forced-square QR must still decode correctly');

    if (pageErrors.length) throw new Error(`Unexpected page errors: ${JSON.stringify(pageErrors)}`);

    console.log(`CLICK 360 r37.1 QR scanner-validation E2E PASS: ${CASES.length} real renders (default colors, the real Owner red design, custom high-contrast colors, minimum-recommended and large physical sizes, 203/300 DPI) were rendered through the actual canonical pipeline and successfully decoded back to their exact original payload with jsQR -- plus explicit proof a QR object can never render non-square regardless of a mismatched saved width/height.`);
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }
}

await run();
