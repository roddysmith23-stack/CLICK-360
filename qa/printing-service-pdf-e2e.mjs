import { execFileSync, spawn } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_PRINTING_PDF_E2E_PORT || 4192);
const url = `http://127.0.0.1:${port}/qa/fixtures/printing-service-pdf-provider.html`;
const output = path.join(root, 'output/playwright/release-1.0.5');
const server = spawn(process.execPath, [path.join(root, 'node_modules/http-server/bin/http-server'), '.', '-p', String(port), '-c-1'], {
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
  throw new Error('Printing PDF fixture did not start.');
}

try {
  await mkdir(output, { recursive:true });
  await waitForServer();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ acceptDownloads:true, viewport:{ width:1024, height:768 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(url, { waitUntil:'networkidle' });
    await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    const downloadPromise = page.waitForEvent('download', { timeout:15000 });
    await page.locator('#runPdf').click();
    const download = await downloadPromise;
    const pdfPath = path.join(output, 'printing-service-pdf-provider.pdf');
    await download.saveAs(pdfPath);
    const pdf = await stat(pdfPath);
    if (pdf.size < 2500) throw new Error(`PDF provider output is too small or blank: ${pdf.size} bytes.`);
    if (process.platform === 'darwin') {
      const pagePng = path.join(output, 'printing-service-pdf-provider.png');
      execFileSync('sips', ['-s', 'format', 'png', pdfPath, '--out', pagePng], { stdio:'ignore' });
      execFileSync(process.execPath, [path.join(root, 'qa/check-png-nonblank.cjs'), pagePng, '500'], { stdio:'inherit' });
    }
    if (errors.length) throw new Error(`Printing PDF unexpected browser errors: ${JSON.stringify(errors)}`);
    console.log(`CLICK 360 printing-service PDF provider E2E PASS: ${pdf.size} bytes`);
  } finally {
    await browser.close();
  }
} finally {
  server.kill('SIGTERM');
}
