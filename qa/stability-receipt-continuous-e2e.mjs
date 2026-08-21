import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium, webkit } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_RECEIPT_CONTINUOUS_PORT || 4198);
const baseUrl = `http://127.0.0.1:${port}/qa/fixtures/stability-receipt-continuous.html`;
const output = path.join(root, 'output/playwright/stability-operations');
const server = spawn(process.execPath, [path.join(root, 'node_modules/http-server/bin/http-server'), '.', '-p', String(port), '-c-1'], { cwd:root, stdio:'ignore' });

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(baseUrl)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Continuous receipt fixture did not start.');
}

async function run(browserName, browserType, width) {
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage({ viewport:{ width:430, height:844 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`${baseUrl}?width=${width}`, { waitUntil:'networkidle' });
    await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    const result = await page.evaluate(() => {
      const copy = document.querySelector('.receiptContinuousCopy');
      const body = document.querySelector('.receiptPrintBody');
      const rect = body.getBoundingClientRect();
      return {
        requested:document.documentElement.dataset.requested,
        job:JSON.parse(document.documentElement.dataset.job),
        copies:document.querySelectorAll('.receiptContinuousCopy').length,
        physicalCells:document.querySelectorAll('.receiptPaperCell').length,
        receiptWidthMm:rect.width * 25.4 / 96,
        horizontalOverflow:document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        copyOverflow:copy.scrollWidth > copy.clientWidth + 1,
        text:copy.textContent.replace(/\s+/g, ' ').trim()
      };
    });
    if (result.copies !== 1 || result.physicalCells !== 0) throw new Error(`${browserName}/${width} wasted physical label cells: ${JSON.stringify(result)}`);
    if (result.job.layoutMode !== 'continuous' || result.job.mediaHeightMm !== null) throw new Error(`${browserName}/${width} is not continuous: ${JSON.stringify(result.job)}`);
    const expectedWidth = width === '80' ? 80 : width === 'fixed' ? 40 : 58;
    if (Math.abs(result.receiptWidthMm - expectedWidth) > 0.8) throw new Error(`${browserName}/${width} width drift: ${result.receiptWidthMm}`);
    if (result.horizontalOverflow || result.copyOverflow) throw new Error(`${browserName}/${width} has overflow.`);
    for (const required of ['Producto normal', 'Segundo producto', 'TOTAL', 'Control total de tu negocio con CLICK 360']) {
      if (!result.text.includes(required)) throw new Error(`${browserName}/${width} lost ${required}.`);
    }
    if (errors.length) throw new Error(`${browserName}/${width} browser errors: ${JSON.stringify(errors)}`);
    await mkdir(output, { recursive:true });
    await page.screenshot({ path:path.join(output, `receipt-continuous-${width}-${browserName}.png`), fullPage:true });
    await writeFile(path.join(output, `receipt-continuous-${width}-${browserName}.json`), `${JSON.stringify(result, null, 2)}\n`);
    console.log(`CLICK 360 continuous receipt ${browserName}/${width} PASS: ${result.receiptWidthMm.toFixed(2)} mm, 1 copy, 0 label cells`);
  } finally {
    await browser.close();
  }
}

try {
  await waitForServer();
  const browsers = [['chromium', chromium]];
  if (process.env.SKIP_WEBKIT !== '1') {
    browsers.push(['webkit', webkit]);
  } else {
    console.warn('WARN: WebKit unavailable in this environment — skipping WebKit continuous receipt tests (SKIP_WEBKIT=1).');
  }
  for (const [browserName, browserType] of browsers) {
    for (const width of ['58', '80', 'fixed']) await run(browserName, browserType, width);
  }
} finally {
  server.kill('SIGTERM');
}
