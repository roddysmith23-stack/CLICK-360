import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { chromium, firefox, webkit } from 'playwright';

// PERMANENT REGRESSION GATE for a real client's physical printer profile ("Shary's setup": 3nStar
// LTT214 printer, 4BARCODE 4B-2054L driver, 203 DPI, 2-column roll of 40x60mm stickers). See
// qa/fixtures/golden-shary-2col-40x60.html for the full provenance of every physical number used
// here (searched across the ENTIRE git history — LABEL_PAPER_PRESETS['roll-2-40x60-provisional']
// and the committed qa-stability-label-r29.cjs regression test are the two confirmed sources).
//
// This drives the REAL executeCanonicalLabelPrint()/buildUniversalLabelPrintNode()/handoffPrint()
// chain extracted verbatim from app.js by qa/extract-print-handoff.cjs (same extractor
// qa/r33-print-geometry-e2e.mjs uses — reused here, not duplicated), through the REAL
// universal-label-canvas.js + smart-print-core.js engine. Nothing on the measured path is stubbed.
//
// Future changes to LABEL_PAPER_PRESETS, universalMediaSize(), buildSheetPlan(), or
// buildUniversalLabelPrintNode() MUST keep this passing — it is the physical contract for a real
// 2-column roll client, the exact configuration shape that regressed in commit b964f0e.

const root = path.resolve(import.meta.dirname, '..');
execFileSync(process.execPath, [path.join(root, 'qa/extract-print-handoff.cjs')], { stdio: 'inherit' });

const port = Number(process.env.CLICK360_GOLDEN_SHARY_PORT || 4210);
const url = `http://127.0.0.1:${port}/qa/fixtures/golden-shary-2col-40x60.html`;
const server = spawn(process.execPath, [path.join(root, 'node_modules/http-server/bin/http-server'), '.', '-p', String(port), '-c-1'], { cwd: root, stdio: 'ignore' });

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('golden-shary-2col fixture did not start');
}

// CONFIRMED physical spec — see provenance note in qa/fixtures/golden-shary-2col-40x60.html.
const LABEL_WIDTH_MM = 40;
const LABEL_HEIGHT_MM = 60;
const COLUMNS = 2;
const ROWS = 1;
const MEDIA_WIDTH_MM = 82; // 2 * 40mm + 1 * 2mm gap, confirmed via qa-stability-label-r29.cjs
const MEDIA_HEIGHT_MM = 60; // one row per physical page on a continuous roll
const MM_TOLERANCE = 2;
const MIN_INK_PIXELS = 15; // a real drawn QR/name/price/sku region must have more than a few stray pixels

function assertClose(actual, expected, tolerance, label) {
  if (actual == null || !Number.isFinite(actual)) throw new Error(`${label}: no numeric value measured (got ${actual})`);
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: expected ~${expected}, measured ${actual} (diff ${Math.abs(actual - expected).toFixed(2)})`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertInk(count, label) {
  if (!Number.isFinite(count) || count < MIN_INK_PIXELS) {
    throw new Error(`${label}: expected at least ${MIN_INK_PIXELS} non-white pixels, got ${count} — region looks blank`);
  }
}

async function run(browserName, browserType) {
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    await page.emulateMedia({ media: 'print' });

    // --- Scenario 1: quantity=2, startSlot=1 — both columns of a single roll row must fill. ---
    {
      const r = await page.evaluate(() => window.__CLICK360_RUN_PRINT_FLOW__(2, 1));
      if (r.error) throw new Error(`${browserName} qty=2 startSlot=1: print flow threw: ${r.error}`);
      if (r.printCallCount !== 1) throw new Error(`${browserName} qty=2: window.print() called ${r.printCallCount} times, expected 1`);

      assertEqual(r.expectedLabelWidthMm, LABEL_WIDTH_MM, `${browserName} label width`);
      assertEqual(r.expectedLabelHeightMm, LABEL_HEIGHT_MM, `${browserName} label height`);
      assertEqual(r.expectedColumns, COLUMNS, `${browserName} paper.columns`);
      assertEqual(r.expectedRows, ROWS, `${browserName} paper.rows`);
      assertEqual(r.planColumns, COLUMNS, `${browserName} plan.columns`);
      assertEqual(r.planCapacity, COLUMNS * ROWS, `${browserName} plan.capacity`);

      // The roll media width for TWO columns, not a single-column fallback.
      assertClose(r.expectedMediaWidthMm, MEDIA_WIDTH_MM, 0.5, `${browserName} media width (2-column roll)`);
      assertClose(r.expectedMediaHeightMm, MEDIA_HEIGHT_MM, 0.5, `${browserName} media height (one row)`);

      const pageMatch = r.pageStyleText.match(/@page\{size:([\d.]+)mm ([\d.]+)mm/);
      if (!pageMatch) throw new Error(`${browserName} qty=2: no explicit mm @page size in "${r.pageStyleText}"`);
      assertClose(Number(pageMatch[1]), MEDIA_WIDTH_MM, MM_TOLERANCE, `${browserName} @page width`);
      assertClose(Number(pageMatch[2]), MEDIA_HEIGHT_MM, MM_TOLERANCE, `${browserName} @page height`);

      if (r.planPageCount !== 1) throw new Error(`${browserName} qty=2 startSlot=1: expected 1 physical page (row), got ${r.planPageCount}`);
      if (r.pages.length !== 1) throw new Error(`${browserName} qty=2: expected 1 rendered .labelPrintPage, got ${r.pages.length}`);
      const page0 = r.pages[0];
      assertClose(page0.widthMm, MEDIA_WIDTH_MM, MM_TOLERANCE, `${browserName} .labelPrintPage width`);
      assertClose(page0.heightMm, MEDIA_HEIGHT_MM, MM_TOLERANCE, `${browserName} .labelPrintPage height`);
      if (page0.cells.length !== 2) throw new Error(`${browserName} qty=2: expected 2 cells (2 columns), got ${page0.cells.length} — TWO COLUMNS DID NOT RENDER`);
      if (page0.cells.some((c) => c.status !== 'filled')) throw new Error(`${browserName} qty=2: expected both columns filled, got statuses ${JSON.stringify(page0.cells.map((c) => c.status))}`);

      // Both physical columns must be at DIFFERENT x positions — proof this is really two
      // side-by-side columns, not one column duplicated or collapsed to a single position.
      const lefts = page0.cells.map((c) => c.leftMm).sort((a, b) => a - b);
      assertClose(lefts[0], 0, 0.5, `${browserName} left column x`);
      assertClose(lefts[1], LABEL_WIDTH_MM + 2, 0.5, `${browserName} right column x (label width + confirmed 2mm gap)`);

      // QR/name/price/sku must all be present (non-blank) in BOTH columns.
      for (const cell of page0.cells) {
        if (!cell.hasImg) throw new Error(`${browserName} qty=2: filled cell at x=${cell.leftMm}mm has no <img>`);
        if (!cell.ink) throw new Error(`${browserName} qty=2: filled cell at x=${cell.leftMm}mm has no ink measurement`);
        assertInk(cell.ink.qr, `${browserName} qty=2 cell@${cell.leftMm}mm QR region`);
        assertInk(cell.ink.name, `${browserName} qty=2 cell@${cell.leftMm}mm name region`);
        assertInk(cell.ink.price, `${browserName} qty=2 cell@${cell.leftMm}mm price region`);
        assertInk(cell.ink.sku, `${browserName} qty=2 cell@${cell.leftMm}mm sku region`);
      }
      await page.evaluate(() => window.__CLICK360_FINISH_PRINT__());
      console.log(`${browserName}: qty=2 startSlot=1 — 2 columns rendered at x=0/${LABEL_WIDTH_MM + 2}mm, all QR/name/price/sku non-blank, media ${MEDIA_WIDTH_MM}x${MEDIA_HEIGHT_MM}mm`);
    }

    // --- Scenario 2: quantity=4, startSlot=1 — fills both columns across 2 rows/pages. ---
    {
      const r = await page.evaluate(() => window.__CLICK360_RUN_PRINT_FLOW__(4, 1));
      if (r.error) throw new Error(`${browserName} qty=4: print flow threw: ${r.error}`);
      if (r.planPageCount !== 2) throw new Error(`${browserName} qty=4 startSlot=1: expected 2 physical pages/rows (ceil(4/2)), got ${r.planPageCount}`);
      if (r.pages.length !== 2) throw new Error(`${browserName} qty=4: expected 2 rendered .labelPrintPage, got ${r.pages.length}`);
      const totalFilled = r.pages.reduce((sum, p) => sum + p.cells.filter((c) => c.status === 'filled').length, 0);
      if (totalFilled !== 4) throw new Error(`${browserName} qty=4: expected exactly 4 filled cells across both rows, got ${totalFilled}`);
      for (const [idx, p] of r.pages.entries()) {
        if (p.cells.length !== 2) throw new Error(`${browserName} qty=4 page ${idx}: expected 2 columns, got ${p.cells.length}`);
        if (p.cells.some((c) => c.status !== 'filled')) throw new Error(`${browserName} qty=4 page ${idx}: expected both columns filled, got ${JSON.stringify(p.cells.map((c) => c.status))}`);
      }
      await page.evaluate(() => window.__CLICK360_FINISH_PRINT__());
      console.log(`${browserName}: qty=4 startSlot=1 — 2 pages (rows) x 2 filled columns = 4 labels total`);
    }

    // --- Scenario 3: startSlot=2 — must start filling in the SECOND column, not the first. ---
    {
      const r = await page.evaluate(() => window.__CLICK360_RUN_PRINT_FLOW__(1, 2));
      if (r.error) throw new Error(`${browserName} startSlot=2: print flow threw: ${r.error}`);
      if (r.pages.length !== 1) throw new Error(`${browserName} startSlot=2: expected 1 rendered .labelPrintPage, got ${r.pages.length}`);
      const cells = r.pages[0].cells;
      if (cells.length !== 2) throw new Error(`${browserName} startSlot=2: expected 2 columns, got ${cells.length}`);
      const sorted = [...cells].sort((a, b) => a.leftMm - b.leftMm);
      assertEqual(sorted[0].status, 'used', `${browserName} startSlot=2 left column status`);
      assertEqual(sorted[1].status, 'filled', `${browserName} startSlot=2 right column status`);
      assertClose(sorted[1].leftMm, LABEL_WIDTH_MM + 2, 0.5, `${browserName} startSlot=2 filled column x (second column)`);
      if (!sorted[1].ink) throw new Error(`${browserName} startSlot=2: right column has no ink measurement`);
      assertInk(sorted[1].ink.qr, `${browserName} startSlot=2 right column QR region`);
      assertInk(sorted[1].ink.name, `${browserName} startSlot=2 right column name region`);
      assertInk(sorted[1].ink.price, `${browserName} startSlot=2 right column price region`);
      await page.evaluate(() => window.__CLICK360_FINISH_PRINT__());
      console.log(`${browserName}: startSlot=2 — correctly started in the second column (x=${sorted[1].leftMm}mm), first column left 'used'`);
    }

    if (errors.length) throw new Error(`${browserName} browser errors: ${JSON.stringify(errors)}`);
    return { browserName, mediaSize: `${MEDIA_WIDTH_MM}x${MEDIA_HEIGHT_MM}mm`, labelSize: `${LABEL_WIDTH_MM}x${LABEL_HEIGHT_MM}mm`, columns: COLUMNS };
  } finally {
    await browser.close();
  }
}

try {
  await waitForServer();
  const results = [];
  results.push(await run('chromium', chromium));
  results.push(await run('webkit', webkit));
  results.push(await run('firefox', firefox));
  console.log(`CLICK360_GOLDEN_SHARY_2COL_E2E: PASS ${JSON.stringify(results)}`);
} finally {
  server.kill('SIGTERM');
}
