import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium, firefox, webkit } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'output/playwright/r37-2-6-print-handoff');
const port = Number(process.env.CLICK360_R3726_PRINT_PORT || 4792);
const url = `http://127.0.0.1:${port}/qa/fixtures/r37-2-6-shary-print-handoff.html`;
execFileSync(process.execPath, [path.join(root, 'qa/extract-print-handoff.cjs')], { stdio:'inherit' });
const server = spawn(process.execPath, [path.join(root, 'node_modules/http-server/bin/http-server'), '.', '-p', String(port), '-c-1'], { cwd:root, stdio:'ignore' });

function assert(condition, message) { if (!condition) throw new Error(message); }
async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('print handoff fixture did not start');
}

async function run(name, browserType) {
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(url, { waitUntil:'networkidle' });
    await page.emulateMedia({ media:'print' });
    await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    const results = {};
    for (const quantity of [2, 3, 4, 6, 10]) {
      const result = await page.evaluate((value) => window.__CLICK360_RUN_SHARY_HANDOFF__(value), quantity);
      results[quantity] = result;
      assert(result.printCalls === 1, `${name} qty=${quantity}: exactly one browser handoff required`);
      assert(result.media.widthMm === 92 && result.media.heightMm === 64, `${name} qty=${quantity}: expected 92x64mm, got ${JSON.stringify(result.media)}`);
      assert(/@page\{size:92mm 64mm;margin:0/.test(result.pageCss), `${name} qty=${quantity}: wrong @page CSS ${result.pageCss}`);
      assert(result.qrSquare, `${name} qty=${quantity}: normalized QR must remain 1:1`);
      for (const physicalPage of result.pages) {
        assert(Math.abs(physicalPage.widthMm - 92) < 0.6, `${name}: browser page width ${physicalPage.widthMm}`);
        assert(Math.abs(physicalPage.heightMm - 64) < 0.6, `${name}: browser page height ${physicalPage.heightMm}`);
        const [left, right] = physicalPage.cells;
        assert(Math.abs(left.leftMm - 6) < 0.6, `${name}: left column x=${left.leftMm}`);
        assert(Math.abs(right.leftMm - 50) < 0.6, `${name}: right column x=${right.leftMm}`);
        assert(right.leftMm + right.widthMm <= 92.6, `${name}: right column exceeds page`);
      }
      await page.evaluate(() => window.__CLICK360_FINISH_PRINT__());
    }
    assert(JSON.stringify(results[2].patterns) === JSON.stringify(['XX']), `${name}: qty2 pattern`);
    assert(JSON.stringify(results[3].patterns) === JSON.stringify(['XX', 'X ']), `${name}: qty3 pattern`);
    assert(JSON.stringify(results[4].patterns) === JSON.stringify(['XX', 'XX']), `${name}: qty4 pattern`);
    assert(JSON.stringify(results[6].patterns) === JSON.stringify(['XX', 'XX', 'XX']), `${name}: qty6 pattern`);
    assert(results[10].patterns.length === 5 && results[10].patterns.every((pattern) => pattern === 'XX'), `${name}: qty10 pattern`);
    assert(pageErrors.length === 0, `${name}: page errors ${JSON.stringify(pageErrors)}`);

    if (name === 'chromium') {
      await mkdir(output, { recursive:true });
      await page.evaluate(() => window.__CLICK360_RUN_SHARY_HANDOFF__(4));
      const pdfPath = path.join(output, 'qty4-92x64mm.pdf');
      await page.pdf({ path:pdfPath, preferCSSPageSize:true, printBackground:true });
      const pdfText = (await readFile(pdfPath)).toString('latin1');
      const box = pdfText.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
      assert(box, 'Chromium PDF must expose a MediaBox');
      const widthMm = Number(((Number(box[1]) / 72) * 25.4).toFixed(2));
      const heightMm = Number(((Number(box[2]) / 72) * 25.4).toFixed(2));
      assert(Math.abs(widthMm - 92) < 1 && Math.abs(heightMm - 64) < 1, `Chromium PDF expected 92x64mm, got ${widthMm}x${heightMm}`);
      await page.evaluate(() => window.__CLICK360_FINISH_PRINT__());
    }
    console.log(`CLICK360 r37.2.6 print handoff ${name} PASS`);
    return results;
  } finally {
    await browser.close();
  }
}

try {
  await waitForServer();
  await run('chromium', chromium);
  await run('webkit', webkit);
  await run('firefox', firefox);
  console.log('CLICK360_R37_2_6_SHARY_PRINT_HANDOFF PASS: 92x64mm, columns x=6/50mm, qty 2/3/4/6/10, one handoff, QR 1:1');
} finally {
  server.kill('SIGTERM');
}
