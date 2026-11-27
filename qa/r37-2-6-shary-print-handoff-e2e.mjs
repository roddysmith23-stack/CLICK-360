import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { RGBLuminanceSource, BinaryBitmap, HybridBinarizer, QRCodeReader, DecodeHintType } from '@zxing/library';
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

async function verifyRollPdf(name, file, qrCodes) {
  const exportedPdf = (await readFile(file)).toString('latin1');
  const pages = [...exportedPdf.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)];
  assert(pages.length === Math.ceil(qrCodes.length / 2),
  `${name}: expected ${Math.ceil(qrCodes.length / 2)} PDF pages, got ${pages.length}`);
  for (const [, w, h] of pages) {
    assert(Math.abs(Number(w) * 25.4 / 72 - 92) < 0.1 && Math.abs(Number(h) * 25.4 / 72 - 64) < 0.1,
      `${name}: each PDF page must be 92×64 mm`);
  }

  const xrefOffset = Number(exportedPdf.match(/startxref\n(\d+)\n%%EOF/)?.[1]);
  const [xref, range, , ...entries] = exportedPdf.slice(xrefOffset).split('\n');
  assert(xref === 'xref' && range === `0 ${3 + 3 * pages.length}`, `${name}: PDF object table must include every row`);
  for (let objectId = 1; objectId < 3 + 3 * pages.length; objectId++) {
    const offset = Number(entries[objectId - 1]?.split(' ')[0]);
    assert(exportedPdf.startsWith(`${objectId} 0 obj\n`, offset), `${name}: incorrect PDF object offset`);
  }
  // Decode the rendered file. The page tree alone cannot detect blank,
  // compressed or cropped rows.
  for (let row = 1; row <= pages.length; row++) {
    const pixels = execFileSync('pdftoppm', [
      '-f', String(row), '-l', String(row), '-r', '203', '-gray', file
    ], { maxBuffer:1024*1024 });
    const header = pixels.toString('ascii', 0, 64).match(/^P5\n(\d+) (\d+)\n255\n/);
    assert(header, `${name}: PDF row ${row} could not be rasterized`);
    const width = Number(header[1]), height = Number(header[2]);
    const rowPixels = pixels.subarray(header[0].length);
    const px = mm => Math.round(mm * 203 / 25.4);
    const ink = [0, 0];
    let outside = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (rowPixels[y * width + x] >= 140) continue;
        if (y < px(60) && x >= px(6) && x < px(46)) ink[0]++;
        else if (y < px(60) && x >= px(50) && x < px(90)) ink[1]++;
        else outside++;
      }
    }
    for (const [column, origin] of [6, 50].entries()) {
      const w = px(40), h = px(60), left = px(origin);
      const crop = new Uint8ClampedArray(w * h);
      for (let y = 0; y < h; y++) crop.set(rowPixels.subarray(y * width + left, y * width + left + w), y * w);
      let qr;
      try {
        qr = new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(crop, w, h))));
      } catch (error) {
        // Some QR masks mislead the JS port's finder on the whole sticker.
        // Decode the raster's known QR region without text or finder noise.
        const qrWidth = px(24), qrHeight = px(25);
        const region = new Uint8ClampedArray(qrWidth * qrHeight);
        for (let y = 0; y < qrHeight; y++) region.set(crop.subarray(y * w, y * w + qrWidth), y * qrWidth);
        try {
          const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(region, qrWidth, qrHeight)));
          qr = new QRCodeReader().decode(bitmap, new Map([[DecodeHintType.PURE_BARCODE, true]]));
        } catch (fallbackError) {
          throw new Error(`${name}: QR not decoded at row ${row}, column ${column + 1}`,
            { cause:new AggregateError([error, fallbackError]) });
        }
      }
      const expected = qrCodes[(row - 1) * 2 + column];
      assert(qr.getText() === expected, `${name}: row ${row}, column ${column + 1} expected ${expected}, got ${qr.getText()}`);
    }
    assert(Math.min(...ink) > 1000 && outside <= 20,
      `${name}: row ${row} ink must fill both stickers and stay inside (got ${ink}, outside ${outside})`);
  }
}

async function run(name, browserType) {
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage({ acceptDownloads:true });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(url, { waitUntil:'networkidle' });
    await page.emulateMedia({ media:'print' });
    await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    const prices = await page.evaluate(() => {
      const fmt = __CLICK360_PRINT_HANDOFF__.labelFmt;
      const dual = { price:10, cardPrice:11, variant:'QA' };
      return [
        fmt(dual, 'full'), fmt(dual, 'abbr'), fmt(dual, 'noLabel'), fmt(dual, 'cash'),
        fmt({ price:10, cardPrice:10 }, 'full'), fmt({ price:10 }, 'full'),
        fmt({ price:10, cardPrice:0 }, 'abbr'), fmt({ price:0 }, 'full'), fmt({}, 'full')
      ];
    });
    assert(JSON.stringify(prices) === JSON.stringify([
      'Efectivo $10.00 · Tarjeta $11.00', 'Ef. $10.00 · Tj. $11.00', '$10.00 · $11.00',
      '$10.00', '$10.00', '$10.00', 'Ef. $10.00 · Tj. $0.00', '$0.00', ''
    ]), `${name}: historical price formats or their numeric semantics changed`);
    const printedPrices = await page.evaluate(async () => {
      const rendered = [];
      const proto = CanvasRenderingContext2D.prototype;
      const fillText = proto.fillText;
      proto.fillText = function(text, ...args) {
        if (String(text).includes('$')) rendered.push(text);
        return fillText.call(this, text, ...args);
      };
      try { await window.__CLICK360_RUN_SHARY_HANDOFF__(2, 'system'); }
      finally { proto.fillText = fillText; window.__CLICK360_FINISH_PRINT__(); }
      return rendered;
    });
    assert(printedPrices.length === 2 && printedPrices.every(text => text === 'Ef. $12.50 · Tj. $13.00'),
      `${name}: the two printed cells must contain both prices`);
    const clipping = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      await CLICK360_UNIVERSAL_LABEL_CANVAS.renderLabelToCanvas(canvas, {
        paper:{ widthMm:40, heightMm:60, scaleX:1.2, scaleY:1.1 },
        qrStyle:{ quietZoneModules:0 },
        objects:[{ type:'qr', xMm:17, yMm:37, widthMm:23, heightMm:23, rotation:35 }]
      }, { qrPayload:'QA-ROTATED-EDGE' });
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const ink = (x,y) => pixels[(y * canvas.width + x) * 4] < 128;
      let edgeInk = 0, totalInk = 0;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        if (!ink(x,y)) continue;
        totalInk++;
        if (x < 8 || x >= canvas.width - 8 || y < 8 || y >= canvas.height - 8) edgeInk++;
      }
      return { edgeInk, totalInk };
    });
    assert(clipping.totalInk > 1000 && clipping.edgeInk === 0, `${name}: calibrated rotated QR is clipped, ${JSON.stringify(clipping)}`);
    const reserved = await page.evaluate(() => window.__CLICK360_RUN_SHARY_HANDOFF__(3, 'system', { usedSlots:[1] }));
    assert(JSON.stringify(reserved.patterns) === JSON.stringify([' X', 'XX']),
      `${name}: print must preserve the reserved left slot, got ${JSON.stringify(reserved.patterns)}`);
    await page.evaluate(() => window.__CLICK360_FINISH_PRINT__());
    const results = {};
    for (const quantity of [1, 2, 3, 4, 6, 10, 20, 100]) {
      const result = await page.evaluate((value) => window.__CLICK360_RUN_SHARY_HANDOFF__(value), quantity);
      results[quantity] = result;
      assert(result.patterns.length === Math.ceil(quantity / 2), `${name}: page count for ${quantity}`);
      assert(result.patterns.join('').replaceAll(' ', '').length === quantity, `${name}: filled count for ${quantity}`);
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
    assert(results[100].patterns.length === 50 && results[100].patterns.every(pattern => pattern === 'XX'),
      `${name}: a lot of 100 must occupy both columns of all 50 rows`);
    assert(pageErrors.length === 0, `${name}: page errors ${JSON.stringify(pageErrors)}`);

    await page.emulateMedia({ media:'screen' });
    const downloadReady = page.waitForEvent('download');
    const pdfJob = await page.evaluate(() => window.__CLICK360_RUN_SHARY_HANDOFF__(6, 'pdf'));
    assert(pdfJob.exported, `${name}: app PDF export failed`);
    const download = await downloadReady;
    await verifyRollPdf(name, await download.path(), Array(6).fill('QA-001'));
    if (name === 'chromium') {
      await mkdir(output, { recursive:true });
      const codes = Array.from({ length:100 }, (_, index) => `QA-${String(index + 1).padStart(3, '0')}`);
      const batchReady = page.waitForEvent('download');
      const batch = await page.evaluate(async qrCodes => {
        const printed = [];
        const proto = CanvasRenderingContext2D.prototype;
        const fillText = proto.fillText;
        proto.fillText = function(text, ...args) {
          if (String(text).startsWith('Ef. $')) printed.push(text);
          return fillText.call(this, text, ...args);
        };
        try {
          const job = await window.__CLICK360_RUN_SHARY_HANDOFF__(qrCodes.length, 'pdf', { codes:qrCodes });
          return { exported:job.exported, printed };
        } finally { proto.fillText = fillText; }
      }, codes);
      const catalogPrices = codes.map((_, index) =>
        `Ef. $${(12.5 + index).toFixed(2)} · Tj. $${(13 + index).toFixed(2)}`);
      assert(batch.exported, 'Chromium catalog batch PDF export failed');
      assert(JSON.stringify(batch.printed) === JSON.stringify(catalogPrices),
        'Each catalog label must render its own cash and card prices in order');
      const batchPdf = await batchReady;
      const batchPath = path.join(output, 'qa-catalog-100-etiquetas-92x64mm.pdf');
      await batchPdf.saveAs(batchPath);
      await verifyRollPdf('chromium catalog 100', batchPath, codes);
      console.log('PRINT GUARDIAN: 100 unique QR in order, 50 pages at 92 × 64 mm, ink inside both columns.');
      for (const quantity of [2, 4, 10]) {
        const ready = page.waitForEvent('download');
        const job = await page.evaluate(qty => window.__CLICK360_RUN_SHARY_HANDOFF__(qty, 'pdf'), quantity);
        assert(job.exported, `Diagnostic PDF export failed for ${quantity}`);
        const pdf = await ready;
        await pdf.saveAs(path.join(output, `calibracion-${quantity}-etiquetas-92x64mm.pdf`));
      }
      await download.saveAs(path.join(output, 'calibracion-6-etiquetas-92x64mm.pdf'));
      await page.emulateMedia({ media:'print' });
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
  console.log('CLICK360_R37_2_6_SHARY_PRINT_HANDOFF PASS: 92x64mm, columns x=6/50mm, qty 2/3/4/6/10/20/100, one handoff, QR 1:1');
} finally {
  server.kill('SIGTERM');
}
