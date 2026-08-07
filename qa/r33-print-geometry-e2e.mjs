import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium, firefox, webkit } from 'playwright';

// Reproduces the client's real reported incident: Inventario -> imprimir -> plantilla persistida
// (60x40mm single roll label) -> pulsa imprimir -> el diálogo del sistema muestra la etiqueta
// reducida y desplazada a la esquina superior izquierda de una página grande. This drives the
// REAL executeCanonicalLabelPrint()/handoffPrint()/printing-service.js chain (extracted verbatim
// from app.js by qa/extract-print-handoff.cjs, not a reimplementation) and MEASURES the actual
// generated @page CSS, DOM geometry captured at the exact moment window.print() would have been
// called (matching what a real print dialog renders), and (Chromium only) the real PDF page size
// the browser would produce — not just "did the canvas render".

const root = path.resolve(import.meta.dirname, '..');
execFileSync(process.execPath, [path.join(root, 'qa/extract-print-handoff.cjs')], { stdio: 'inherit' });

const port = Number(process.env.CLICK360_R33_GEOMETRY_PORT || 4201);
const url = `http://127.0.0.1:${port}/qa/fixtures/r33-print-geometry.html`;
const output = path.join(root, 'output/playwright/release-1.0.5');
const server = spawn(process.execPath, [path.join(root, 'node_modules/http-server/bin/http-server'), '.', '-p', String(port), '-c-1'], { cwd: root, stdio: 'ignore' });

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('r33 print-geometry fixture did not start');
}

const EXPECTED_WIDTH_MM = 60;
const EXPECTED_HEIGHT_MM = 40;
const MM_TOLERANCE = 2; // allow small sub-pixel/rounding slack, not a scale-factor-sized gap

function assertClose(actual, expected, tolerance, label) {
  if (actual == null || !Number.isFinite(actual)) throw new Error(`${label}: no numeric value measured (got ${actual})`);
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: expected ~${expected}mm, measured ${actual}mm (diff ${Math.abs(actual - expected).toFixed(2)}mm) — geometry mismatch`);
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

    // Emulate print media BEFORE running the flow, so the synchronous capture inside the
    // window.print() stub reflects the real print CSS cascade (@media print rules active),
    // matching what a real browser's print dialog would actually render.
    await page.emulateMedia({ media: 'print' });

    // Per the QA mandate: 1/4/10 copies at different startSlot values must all keep the same
    // correct @page geometry — the media size bug is orthogonal to quantity/startSlot, but this
    // closes the loop explicitly rather than assuming it.
    for (const [quantity, startSlot] of [[1, 1], [4, 1], [10, 3]]) {
      const scenarioResult = await page.evaluate(([q, s]) => window.__CLICK360_RUN_PRINT_FLOW__(q, s), [quantity, startSlot]);
      if (scenarioResult.error) throw new Error(`${browserName} qty=${quantity} startSlot=${startSlot}: print flow threw: ${scenarioResult.error}`);
      if (scenarioResult.pageCount !== quantity) throw new Error(`${browserName} qty=${quantity} startSlot=${startSlot}: expected ${quantity} printed label pages, got ${scenarioResult.pageCount}`);
      const match = scenarioResult.pageStyleText.match(/@page\{size:([\d.]+)mm ([\d.]+)mm/);
      if (!match) throw new Error(`${browserName} qty=${quantity} startSlot=${startSlot}: no explicit mm @page size in "${scenarioResult.pageStyleText}"`);
      assertClose(Number(match[1]), EXPECTED_WIDTH_MM, MM_TOLERANCE, `${browserName} qty=${quantity} startSlot=${startSlot} @page width`);
      assertClose(Number(match[2]), EXPECTED_HEIGHT_MM, MM_TOLERANCE, `${browserName} qty=${quantity} startSlot=${startSlot} @page height`);
      await page.evaluate(() => window.__CLICK360_FINISH_PRINT__());
    }
    console.log(`${browserName}: 1/4/10 copies at different startSlot all kept correct @page geometry`);

    const flowResult = await page.evaluate(() => window.__CLICK360_RUN_PRINT_FLOW__(1, 1));
    if (flowResult.error) throw new Error(`${browserName}: print flow threw: ${flowResult.error}`);
    if (!flowResult.portalExists) throw new Error(`${browserName}: print portal was never created`);
    if (flowResult.printCallCount !== 1) throw new Error(`${browserName}: window.print() called ${flowResult.printCallCount} times, expected exactly 1`);

    console.log(`${browserName} full flow result: ${JSON.stringify(flowResult)}`);

    // 1) The generated @page rule itself must reference the real label size, not a fallback
    // (A4/Letter/receipt) — this is the exact bug class the client's report is compatible with.
    if (!/@page\{size:[\d.]+mm [\d.]+mm/.test(flowResult.pageStyleText)) {
      throw new Error(`${browserName}: @page size did not resolve to explicit mm dimensions — got "${flowResult.pageStyleText}" (this is the A4/Letter-fallback bug shape: pageCss() only emits mm size when job.media==='label' AND both width/height are truthy)`);
    }
    const pageSizeMatch = flowResult.pageStyleText.match(/@page\{size:([\d.]+)mm ([\d.]+)mm/);
    const generatedPageWidthMm = Number(pageSizeMatch[1]);
    const generatedPageHeightMm = Number(pageSizeMatch[2]);
    assertClose(generatedPageWidthMm, flowResult.expectedMediaWidthMm, 0.5, `${browserName} @page width`);
    assertClose(generatedPageHeightMm, flowResult.expectedMediaHeightMm, 0.5, `${browserName} @page height`);
    // For a single 60x40 roll label (no sheet), media size must equal the label size, not
    // silently balloon into a default page format.
    assertClose(generatedPageWidthMm, EXPECTED_WIDTH_MM, MM_TOLERANCE, `${browserName} @page width vs label`);
    assertClose(generatedPageHeightMm, EXPECTED_HEIGHT_MM, MM_TOLERANCE, `${browserName} @page height vs label`);

    // 2) DOM geometry captured at the moment window.print() fires, under print media.
    const labelPage = flowResult.measurements.labelPrintPage;
    if (!labelPage) throw new Error(`${browserName}: .labelPrintPage not found at print time — is it hidden or not rendered?`);
    if (labelPage.visibility === 'hidden') throw new Error(`${browserName}: .labelPrintPage is visibility:hidden under print media`);
    assertClose(labelPage.widthMm, EXPECTED_WIDTH_MM, MM_TOLERANCE, `${browserName} .labelPrintPage width`);
    assertClose(labelPage.heightMm, EXPECTED_HEIGHT_MM, MM_TOLERANCE, `${browserName} .labelPrintPage height`);

    const cell = flowResult.measurements.labelPrintCell;
    if (cell) {
      assertClose(cell.widthMm, EXPECTED_WIDTH_MM, MM_TOLERANCE, `${browserName} .labelPrintCell width`);
      assertClose(cell.heightMm, EXPECTED_HEIGHT_MM, MM_TOLERANCE, `${browserName} .labelPrintCell height`);
    }

    // 3) Chromium only: render the actual print page to a real PDF (respecting @page CSS) and
    // measure its real page size in points -> mm, BEFORE finishing the print (which triggers
    // cleanupJob() and tears the portal down). This is the closest available proxy to "what paper
    // size does the OS print dialog actually see", independent of getComputedStyle.
    if (browserName === 'chromium') {
      await mkdir(output, { recursive: true });
      const pdfPath = path.join(output, 'r33-print-geometry.pdf');
      await page.pdf({ path: pdfPath, preferCSSPageSize: true, printBackground: true });
      const pdfBytes = await readFile(pdfPath);
      const pdfText = pdfBytes.toString('latin1');
      const mediaBoxMatch = pdfText.match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/);
      if (!mediaBoxMatch) throw new Error('chromium: could not find /MediaBox in generated PDF');
      const [, x0, y0, x1, y1] = mediaBoxMatch.map(Number);
      const ptToMm = (pt) => (pt / 72) * 25.4;
      const pdfWidthMm = Number(ptToMm(x1 - x0).toFixed(2));
      const pdfHeightMm = Number(ptToMm(y1 - y0).toFixed(2));
      console.log(`chromium real PDF /MediaBox: ${pdfWidthMm}mm x ${pdfHeightMm}mm (expected ~${EXPECTED_WIDTH_MM}x${EXPECTED_HEIGHT_MM}mm)`);
      assertClose(pdfWidthMm, EXPECTED_WIDTH_MM, MM_TOLERANCE, 'chromium real PDF page width');
      assertClose(pdfHeightMm, EXPECTED_HEIGHT_MM, MM_TOLERANCE, 'chromium real PDF page height');
    }

    await page.evaluate(() => window.__CLICK360_FINISH_PRINT__());

    if (errors.length) throw new Error(`${browserName} browser errors: ${JSON.stringify(errors)}`);
    return { browserName, pageSize: `${generatedPageWidthMm}x${generatedPageHeightMm}mm`, labelSize: `${labelPage.widthMm}x${labelPage.heightMm}mm` };
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
  console.log(`CLICK360_R33_PRINT_GEOMETRY_E2E: PASS ${JSON.stringify(results)}`);
} finally {
  server.kill('SIGTERM');
}
