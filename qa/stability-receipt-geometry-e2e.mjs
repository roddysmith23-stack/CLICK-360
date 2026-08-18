import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium, webkit } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_RECEIPT_GEOMETRY_PORT || 4197);
const url = `http://127.0.0.1:${port}/qa/fixtures/stability-receipt-geometry.html`;
const output = path.join(root, 'output/playwright/stability-operations');
const server = spawn(process.execPath, [path.join(root, 'node_modules/http-server/bin/http-server'), '.', '-p', String(port), '-c-1'], { cwd:root, stdio:'ignore' });

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Receipt geometry fixture did not start.');
}

async function run(name, browserType) {
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage({ viewport:{ width:430, height:844 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(url, { waitUntil:'networkidle' });
    await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    const result = await page.evaluate(() => {
      const box = (node) => {
        const rect = node.getBoundingClientRect();
        return { left:rect.left, top:rect.top, right:rect.right, bottom:rect.bottom, width:rect.width, height:rect.height };
      };
      const pages = [...document.querySelectorAll('.receiptPaperSheet')];
      const cells = [...document.querySelectorAll('.receiptPaperCell')];
      const filled = cells.filter((cell) => cell.classList.contains('filled'));
      const violations = [];
      filled.forEach((cell) => {
        const cellBox = box(cell);
        const segments = [...cell.querySelectorAll(':scope .receiptSegment')];
        if (segments.length !== 1) violations.push(`segment-count:${cell.dataset.page}:${cell.dataset.slot}:${segments.length}`);
        segments.forEach((segment) => {
          const segmentBox = box(segment);
          if (segmentBox.left < cellBox.left - 1 || segmentBox.top < cellBox.top - 1 || segmentBox.right > cellBox.right + 1 || segmentBox.bottom > cellBox.bottom + 1) {
            violations.push(`overflow:${cell.dataset.page}:${cell.dataset.slot}`);
          }
        });
      });
      return {
        pageCount:pages.length,
        cellsPerPage:pages.map((page) => page.querySelectorAll('.receiptPaperCell').length),
        pageSizes:pages.map((page) => box(page)),
        filledCount:filled.length,
        usedFirst:cells[0]?.classList.contains('used') === true,
        firstFilledKind:filled[0]?.querySelector('.receiptSegment')?.dataset.receiptSegment || '',
        violations,
        text:document.getElementById('receiptGeometryOutput').textContent.replace(/\s+/g, ' ').trim(),
        horizontalOverflow:document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      };
    });
    if (result.pageCount < 5) throw new Error(`${name} did not paginate the complete receipt: ${JSON.stringify(result)}`);
    if (!result.cellsPerPage.every((count) => count === 2)) throw new Error(`${name} changed the two-column physical grid.`);
    if (!result.usedFirst || result.firstFilledKind !== 'branding') throw new Error(`${name} did not honor startSlot=2.`);
    if (result.violations.length) throw new Error(`${name} receipt content escapes a physical cell: ${result.violations.join(',')}`);
    if (result.horizontalOverflow) throw new Error(`${name} receipt fixture has horizontal page overflow.`);
    for (const required of ['Producto de prueba', 'TOTAL', 'Control total de tu negocio con CLICK 360']) {
      if (!result.text.includes(required)) throw new Error(`${name} receipt lost required content: ${required}`);
    }
    if (errors.length) throw new Error(`${name} browser errors: ${JSON.stringify(errors)}`);
    await mkdir(output, { recursive:true });
    await page.screenshot({ path:path.join(output, `receipt-2-column-${name}.png`), fullPage:true });
    console.log(`CLICK 360 receipt geometry ${name} PASS: ${result.pageCount} pages, ${result.filledCount} filled cells`);
  } finally {
    await browser.close();
  }
}

try {
  await waitForServer();
  await run('chromium', chromium);
  await run('webkit', webkit);
} finally {
  server.kill('SIGTERM');
}
