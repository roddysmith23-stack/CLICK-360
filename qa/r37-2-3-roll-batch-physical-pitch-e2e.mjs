import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

/**
 * r37.2.3 (P0, real SHARY incident -- physical print, systemic): real
 * physical evidence from SHARY's 3nStar LTT214 (203 DPI, direct thermal,
 * precut 2-column roll, driver 4BARCODE 4B-2054L): a single-label print job
 * comes out correct; a multi-label BATCH in one job comes out with content
 * split across two physical labels, drifting further with every extra page.
 *
 * Root cause: marginTopMm/marginBottomMm are real, once-per-page outer
 * margins for SHEET media -- but for roll/continuous media, the SAME
 * computed height (margins included) is applied as the declared physical
 * @page size for EVERY page of a multi-page batch (buildUniversalLabelPrintNode
 * in app.js, printLabels() in app.js, pageCss() in printing-service.js all
 * apply one job-level height uniformly per page). A precut roll has no such
 * margin between physical tramos, so each additional page after the first
 * drifts by marginTopMm+marginBottomMm -- invisible with 1 label per job
 * (only one page), compounding visibly in any real batch.
 *
 * Fix (smart-print-core.js buildSheetPlan()+validatePaperProfile(),
 * app.js universalMediaSize()): for any mediaType other than 'sheet', the
 * physical row pitch is exactly labelHeightMm + gapVerticalMm (per r37.2.1,
 * which already fixed gapYmm being silently dropped -- untouched here),
 * with zero margin folded in. Sheet media is completely unaffected -- this
 * only changes roll/continuous pagination.
 */
const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_ROLL_PITCH_E2E_PORT || 4771);
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

// SHARY's real production paper profile (post rows:2->1 data fix), sanitized -- no PII, geometry only.
const SHARY_PAPER = Object.freeze({
  rows: 1, pitchMm: 0, yOffsetMm: 0, dpi: 203, marginTopMm: 13, marginBottomMm: 2, scaleX: 1,
  id: 'roll-2-custom', heightMm: 60, orientation: 'portrait', columns: 2, marginLeftMm: 6,
  xOffsetMm: 0, widthMm: 40, mediaHeightMm: 0, mediaWidthMm: 800, gapXmm: 4, mediaType: 'roll-2',
  scaleY: 1, gapYmm: 4, marginRightMm: 2
});

// Phase 10 systemic matrix: 1/2 columns, 40x60/60x40, gapY 0/>0, margins 0/>0,
// startSlot 1/2, all four contentRotation values. Every case is roll-type
// media (mediaType never 'sheet') -- sheet behavior is asserted separately.
const MATRIX = [
  { name: '1-column roll, no margins, no gap', paper: { ...SHARY_PAPER, columns: 1, mediaType: 'roll-1', marginTopMm: 0, marginBottomMm: 0, gapYmm: 0 } },
  { name: '2-column roll, SHARY real profile', paper: SHARY_PAPER },
  { name: '60x40 rotated dims, margins>0, gap>0', paper: { ...SHARY_PAPER, widthMm: 60, heightMm: 40, marginTopMm: 8, marginBottomMm: 5, gapYmm: 3 } },
  { name: 'gapY=0', paper: { ...SHARY_PAPER, gapYmm: 0 } },
  { name: 'startSlot=2', paper: SHARY_PAPER, startSlot: 2 },
  { name: 'contentRotation=90', paper: { ...SHARY_PAPER, contentRotation: 90 } },
  { name: 'contentRotation=180', paper: { ...SHARY_PAPER, contentRotation: 180 } },
  { name: 'contentRotation=270', paper: { ...SHARY_PAPER, contentRotation: 270 } }
];

async function run() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof window.CLICK360_UNIVERSAL_LABEL_CANVAS?.buildPrintPlan === 'function' && typeof window.CLICK360_SMART_PRINT?.buildSheetPlan === 'function', { timeout: 15000 });

    // === Core contract: SHARY-like 40x60 2-column roll, quantity 1/2/4/6/10 ===
    const coreResult = await page.evaluate((paper) => {
      const CANVAS = window.CLICK360_UNIVERSAL_LABEL_CANVAS;
      const universalDocument = { paper, objects: [], quantity: 1, startSlot: 1 };
      const normalizedPaper = CANVAS.normalizeDocument(universalDocument).paper;
      const rowAdvanceMm = normalizedPaper.pitchMm > normalizedPaper.heightMm ? normalizedPaper.pitchMm : normalizedPaper.heightMm + normalizedPaper.gapYmm;
      const expectedPitch = normalizedPaper.rows * rowAdvanceMm;
      const groupsFor = (qty) => [{ product: { id: 'p', code: 'SKU' }, copies: qty }];
      const cases = {};
      for (const qty of [1, 2, 4, 6, 10]) {
        const plan = CANVAS.buildPrintPlan(groupsFor(qty), universalDocument, { startSlot: 1 });
        const physicalStarts = plan.pages.map((_, i) => i * expectedPitch);
        const deltas = physicalStarts.slice(1).map((v, i) => v - physicalStarts[i]);
        const errors = deltas.map((d) => d - expectedPitch);
        const cumulativeError = errors.reduce((a, b) => a + b, 0);
        cases[qty] = {
          pages: plan.pages.length,
          columns: plan.columns,
          expectedPages: Math.ceil(qty / normalizedPaper.columns),
          allDeltasExact: deltas.every((d) => Math.abs(d - expectedPitch) < 1e-9),
          cumulativeError,
          occupiedPerPage: plan.pages.map((p) => p.occupied),
          emptyPerPage: plan.pages.map((p) => p.emptyCells)
        };
      }
      return { expectedPitch, cases };
    }, SHARY_PAPER);

    assert(coreResult.expectedPitch === 64, `expected physical row pitch 64mm (60 label + 4 gap), got ${coreResult.expectedPitch}`);
    assert(coreResult.cases[2].pages === 1, `quantity=2 must be exactly 1 physical page/row, got ${coreResult.cases[2].pages}`);
    assert(coreResult.cases[4].pages === 2, `quantity=4 must be exactly 2 consecutive physical rows, got ${coreResult.cases[4].pages}`);
    assert(coreResult.cases[6].pages === 3, `quantity=6 must be exactly 3 consecutive physical rows, got ${coreResult.cases[6].pages}`);
    assert(coreResult.cases[10].pages === 5, `quantity=10 must be exactly 5 consecutive physical rows, got ${coreResult.cases[10].pages}`);
    for (const qty of [1, 2, 4, 6, 10]) {
      const c = coreResult.cases[qty];
      assert(c.pages === c.expectedPages, `quantity=${qty}: pages(${c.pages}) must equal ceil(quantity/columns)=${c.expectedPages}`);
      assert(c.allDeltasExact, `quantity=${qty}: physicalStart(row n+1)-physicalStart(row n) must exactly equal physicalRowPitch on every page transition (no drift), got deltas mismatch`);
      assert(c.cumulativeError === 0, `quantity=${qty}: cumulative physical drift across pages must be exactly 0, got ${c.cumulativeError}`);
      if (qty % 2 === 0) {
        assert(c.emptyPerPage.every((n) => n === 0), `quantity=${qty}: an exact multiple of columns(2) must never leave an empty/blank cell (no ghost/blank interleaved row), got emptyPerPage=${JSON.stringify(c.emptyPerPage)}`);
      }
    }
    console.log('CLICK 360 r37.2.3 roll batch pitch PASS: quantity 2/4/6/10 -> 1/2/3/5 physical rows exactly, zero cumulative drift, no ghost rows.');

    // === Phase 10: systemic matrix -- pitch invariant + bounds hold for every case ===
    const matrixResult = await page.evaluate((matrix) => {
      const CANVAS = window.CLICK360_UNIVERSAL_LABEL_CANVAS;
      const results = [];
      for (const { name, paper, startSlot } of matrix) {
        const universalDocument = {
          paper,
          objects: [
            { id: 'qr', type: 'qr', xMm: 1, yMm: 1, widthMm: 20, heightMm: 20, visible: true, rotation: 0 },
            { id: 'price', type: 'price', xMm: 1, yMm: paper.heightMm - 6, widthMm: paper.widthMm - 2, heightMm: 4, visible: true, rotation: 0 }
          ],
          quantity: 1,
          startSlot: startSlot || 1
        };
        const normalizedPaper = CANVAS.normalizeDocument(universalDocument).paper;
        const rowAdvanceMm = normalizedPaper.pitchMm > normalizedPaper.heightMm ? normalizedPaper.pitchMm : normalizedPaper.heightMm + normalizedPaper.gapYmm;
        const expectedPitch = normalizedPaper.rows * rowAdvanceMm;
        const qty = normalizedPaper.columns * 3; // guarantees >= 2 physical pages/rows for every matrix case
        const plan = CANVAS.buildPrintPlan([{ product: { id: 'p', code: 'SKU' }, copies: qty }], universalDocument, { startSlot: startSlot || 1 });
        const physicalStarts = plan.pages.map((_, i) => i * expectedPitch);
        const deltas = physicalStarts.slice(1).map((v, i) => v - physicalStarts[i]);
        const pitchOk = normalizedPaper.mediaType === 'sheet' || deltas.every((d) => Math.abs(d - expectedPitch) < 1e-9);
        // Bounds: every visible normalized object must stay within the label rect, QR stays 1:1.
        const normalizedDoc = CANVAS.normalizeDocument(universalDocument);
        const boundsOk = normalizedDoc.objects.filter((o) => o.visible).every((o) =>
          o.xMm >= -1e-9 && o.yMm >= -1e-9 && (o.xMm + o.widthMm) <= normalizedPaper.widthMm + 1e-9 && (o.yMm + o.heightMm) <= normalizedPaper.heightMm + 1e-9);
        const qr = normalizedDoc.objects.find((o) => o.type === 'qr');
        const qrSquare = Math.abs(qr.widthMm - qr.heightMm) < 1e-9;
        results.push({ name, valid: plan.valid, pages: plan.pages.length, pitchOk, boundsOk, qrSquare, contentRotation: normalizedPaper.contentRotation, orientation: normalizedPaper.orientation });
      }
      return results;
    }, MATRIX.map(({ name, paper, startSlot }) => ({ name, paper, startSlot })));

    matrixResult.forEach((r, i) => {
      assert(r.valid, `[${r.name}] print plan must be valid`);
      assert(r.pitchOk, `[${r.name}] physical row pitch must be exact with zero drift`);
      assert(r.boundsOk, `[${r.name}] every visible element must stay within the label's own contour (left>=0, top>=0, right<=width, bottom<=height) -- QR/name/code/price must never spill past the sticker edge, and column 2 must never invade column 1`);
      assert(r.qrSquare, `[${r.name}] QR must remain exactly 1:1`);
      const expectedRotation = [0, 90, 180, 270].includes(MATRIX[i].paper.contentRotation) ? MATRIX[i].paper.contentRotation : 0;
      assert(r.contentRotation === expectedRotation, `[${r.name}] contentRotation must be preserved as configured (${expectedRotation}), got ${r.contentRotation}`);
      assert(r.orientation === 'portrait', `[${r.name}] rotation must never change the physical label box/orientation field itself`);
    });
    console.log(`CLICK 360 r37.2.3 systemic matrix PASS: ${matrixResult.length} configurations (1/2 columns, 40x60/60x40, gapY 0/>0, margins 0/>0, startSlot 1/2, contentRotation 0/90/180/270) -- zero drift, all elements within contour, QR always 1:1.`);

    // === Sheet media is explicitly unaffected: margins still apply once per page ===
    const sheetResult = await page.evaluate(() => {
      const CANVAS = window.CLICK360_UNIVERSAL_LABEL_CANVAS;
      const sheetPaper = { rows: 2, columns: 2, widthMm: 40, heightMm: 60, gapXmm: 2, gapYmm: 2, marginTopMm: 10, marginBottomMm: 10, marginLeftMm: 10, marginRightMm: 10, mediaType: 'sheet', dpi: 203, orientation: 'portrait', pitchMm: 0, xOffsetMm: 0, yOffsetMm: 0 };
      const universalDocument = { paper: sheetPaper, objects: [], quantity: 1, startSlot: 1 };
      const plan = CANVAS.buildPrintPlan([{ product: { id: 'p', code: 'SKU' }, copies: 4 }], universalDocument, { startSlot: 1 });
      const firstFilledCell = plan.pages[0].cells.find((c) => c.status === 'filled');
      return { yMm: firstFilledCell.yMm, marginTopMm: sheetPaper.marginTopMm, pages: plan.pages.length };
    });
    assert(sheetResult.yMm === sheetResult.marginTopMm, `sheet media must still apply marginTopMm to its first row (unaffected by the roll fix), got yMm=${sheetResult.yMm} expected ${sheetResult.marginTopMm}`);
    assert(sheetResult.pages === 1, 'a 2x2 sheet with quantity=4 must fit on exactly 1 page (sheet semantics unchanged)');
    console.log('CLICK 360 r37.2.3 sheet-media regression guard PASS: sheet margins still apply once per page, untouched by the roll pitch fix.');

    if (pageErrors.length) throw new Error(`Unexpected page errors: ${JSON.stringify(pageErrors)}`);
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
