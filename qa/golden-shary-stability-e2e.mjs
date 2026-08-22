import { execFileSync, spawn } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium, firefox, webkit } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_GOLDEN_STABILITY_PORT || 4198);
const url = `http://127.0.0.1:${port}/qa/fixtures/golden-shary-stability.html`;
const output = path.join(root, 'output/playwright/stability-operations');
const server = spawn(process.execPath, [path.join(root, 'node_modules/http-server/bin/http-server'), '.', '-p', String(port), '-c-1'], { cwd:root, stdio:'ignore' });

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Golden Shary fixture did not start.');
}
function assert(condition, message) { if (!condition) throw new Error(message); }

async function run(name, browserType, verifyPdf = false) {
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage({ acceptDownloads:true });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(url, { waitUntil:'networkidle' });
    await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    const result = await page.evaluate(() => window.runGoldenSystem());
    assert(result.printCalls === 1, `${name}: expected exactly one system print handoff`);
    assert(result.planCount === 3 && result.pageCount === 2 && result.columns === 2, `${name}: quantity/startSlot plan changed`);
    assert(result.priceText === 'Ef. $12.50 · Tj. $13.25', `${name}: abbreviated cash/card price changed`);
    assert(/size:82mm 60mm/.test(result.capture.pageCss), `${name}: physical @page is not 82x60mm`);
    assert(result.capture.pages.length === 2, `${name}: expected two physical roll rows`);
    const first = result.capture.pages[0].cells;
    const second = result.capture.pages[1].cells;
    assert(first.length === 2 && first[0].status === 'used' && first[1].status === 'filled', `${name}: startSlot=2 changed`);
    assert(second.length === 2 && second.every((cell) => cell.status === 'filled'), `${name}: exact quantity=3 changed`);
    assert([...first, ...second].filter((cell) => cell.status === 'filled').every((cell) => cell.image.startsWith('data:image/png')), `${name}: preview contains a blank label`);
    if (verifyPdf) {
      const downloadPromise = page.waitForEvent('download', { timeout:15000 });
      await page.evaluate(() => window.runGoldenPdf());
      const download = await downloadPromise;
      await mkdir(output, { recursive:true });
      const pdfPath = path.join(output, 'golden-shary-40x60-2col.pdf');
      await download.saveAs(pdfPath);
      const info = await stat(pdfPath);
      assert(info.size > 2500, `Golden PDF is blank or too small: ${info.size}`);
      const pngPrefix = path.join(output, 'golden-shary-40x60-2col');
      execFileSync('pdftoppm', ['-png', '-singlefile', pdfPath, pngPrefix], { stdio:'ignore' });
      execFileSync(process.execPath, [path.join(root, 'qa/check-png-nonblank.cjs'), `${pngPrefix}.png`, '500'], { stdio:'inherit' });
    }
    if (errors.length) throw new Error(`${name}: ${JSON.stringify(errors)}`);
    console.log(`CLICK 360 golden Shary ${name} PASS: 40x60mm, 2 columns, quantity 3, startSlot 2, one handoff`);
  } finally {
    await browser.close();
  }
}

try {
  await waitForServer();
  await run('chromium', chromium, true);
  if (process.env.SKIP_WEBKIT === '1') {
    console.warn('WARN: WebKit unavailable in this environment — skipping WebKit golden Shary tests (SKIP_WEBKIT=1).');
  } else {
    await run('webkit', webkit);
  }
  if (process.env.SKIP_FIREFOX === '1') {
    console.warn('WARN: Firefox unavailable in this environment — skipping Firefox golden Shary tests (SKIP_FIREFOX=1).');
  } else {
    await run('firefox', firefox);
  }
} finally {
  server.kill('SIGTERM');
}
