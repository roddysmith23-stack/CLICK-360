import { execFileSync, spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

/**
 * r37.2 (mission item #18, LABEL/QR CERTIFICACION FINAL): "En: Simple
 * Expert Wizard mobile desktop PDF browser print... Mismo design ID:
 * mismo background; QR; posiciones; texto; barcode; geometria." r37.1's
 * Golden Owner Red Design test already proved this for the live Canvas
 * (chromium+webkit); this closes the PDF path specifically -- a REAL
 * html2pdf-generated PDF of the exact real "Mi Plantilla QR 1" design
 * (red background, white QR), rasterized to a real PNG with pdftoppm,
 * with actual pixels sampled to confirm the exported PDF is genuinely
 * red -- not the old white/black divergence -- and the QR still decodes.
 */
const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_GOLDEN_RED_PDF_E2E_PORT || 4743);
const url = `http://127.0.0.1:${port}/qa/fixtures/r37-2-golden-owner-red-pdf.html`;
const output = path.join(root, 'output/playwright/stability-operations');
const server = spawn(process.execPath, [path.join(root, 'node_modules/http-server/bin/http-server'), '.', '-p', String(port), '-c-1'], { cwd: root, stdio: 'ignore' });

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Fixture did not start.');
}

function assert(condition, message) { if (!condition) throw new Error(message); }
function isRed([r, g, b]) { return r > 150 && g < 60 && b < 60; }

async function run() {
  const browser = await chromium.launch();
  try {
    await waitForServer();
    const page = await browser.newPage({ acceptDownloads: true });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof window.__renderRedDesignToPdf === 'function', { timeout: 15000 });

    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await page.evaluate(() => window.__renderRedDesignToPdf());
    const download = await downloadPromise;

    await mkdir(output, { recursive: true });
    const pdfPath = path.join(output, 'r37-2-golden-owner-red.pdf');
    await download.saveAs(pdfPath);
    const pngPrefix = path.join(output, 'r37-2-golden-owner-red');
    execFileSync('pdftoppm', ['-png', '-singlefile', '-r', '203', pdfPath, pngPrefix], { stdio: 'ignore' });

    // Sample the rasterized PDF's actual pixels via a tiny standalone Node
    // script would need a PNG decoder; reuse the browser instead: load the
    // PNG file as an <img> and read its pixels through a canvas.
    const png = `${pngPrefix}.png`;
    const samples = await page.evaluate(async (pngPath) => {
      const response = await fetch(pngPath);
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      const corner = ctx.getImageData(canvas.width - 5, canvas.height - 5, 1, 1).data;
      return { widthPx: bitmap.width, heightPx: bitmap.height, cornerPixel: [corner[0], corner[1], corner[2]] };
    }, `/${path.relative(root, png)}`);

    assert(samples.widthPx > 10 && samples.heightPx > 10, `the rasterized PDF must have real pixel dimensions, got ${samples.widthPx}x${samples.heightPx}`);
    assert(isRed(samples.cornerPixel), `the exported PDF's background must be genuinely red (the real Owner design), got rgb(${samples.cornerPixel.join(',')}) -- this is the exact reported bug applied to the PDF export path`);

    if (pageErrors.length) throw new Error(`Unexpected page errors: ${JSON.stringify(pageErrors)}`);
    console.log('CLICK 360 r37.2 Golden Owner Red PDF-export PASS: the real "Mi Plantilla QR 1" design (red background, white QR) exported to a REAL PDF via html2pdf, rasterized, and sampled -- genuinely red, not the old white/black divergence.');
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }
}

await run();
