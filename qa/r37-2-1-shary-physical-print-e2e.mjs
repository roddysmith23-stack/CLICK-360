import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { chromium, webkit } from 'playwright';

/**
 * r37.2.1 (LIVE CLIENT RECOVERY -- INCIDENTE 1, impresión física SHARY):
 * la impresora recibía el trabajo e imprimía QR/textos/dos columnas, pero
 * salía con orientación incorrecta y con filas físicas vacías entre
 * grupos impresos, incluso volviendo a las medidas anteriores ("solo es
 * cuestión de orientación, más no de medidas").
 *
 * Root cause (investigación real, no golden-shary-stability-e2e.mjs --
 * ese test queda como legacy geometry regression, con gapYmm:0, que nunca
 * ejercitó estos bugs):
 *  1. universalMediaSize() descartaba gapYmm por completo cuando rows:1
 *     (el caso de TODOS los presets de rollo enviados) -- cada "página"
 *     (una fila física) se emitía gapYmm más corta que el paso real del
 *     rollo, el registro del sensor de brecha se desalineaba
 *     progresivamente y el sensor terminaba expulsando una etiqueta física
 *     en blanco para resincronizar.
 *  2. universalPaperFromTemplate()/legacyPaperProfileToUniversal() nunca
 *     copiaban contentRotation/shape -- el control real "Orientación del
 *     contenido" que el dueño ya tiene se descartaba en silencio
 *     exactamente en el camino de plantilla guardada (el que usa un
 *     Owner real al imprimir), forzando contentRotation:0 siempre.
 *  3. Cuando SÍ se aplicaba una rotación de 90/270, el canvas dibujaba el
 *     contenido rotado con un drawImage cuyo destino tenía ancho/alto
 *     invertidos pero el canvas en sí NUNCA cambiaba de tamaño --
 *     deformando (estirando de forma no uniforme) cada elemento, un QR
 *     cuadrado salía ovalado.
 *
 * Fix (ver p2-logistics-domain.js -- no, ver app.js universalMediaSize/
 * universalPaperFromTemplate/legacyPaperProfileToUniversal y
 * universal-label-canvas.js renderLabelToCanvas): gapYmm ahora se incluye
 * siempre en el paso de fila real; contentRotation/shape sobreviven el
 * round-trip de plantilla guardada; la rotación de contenido ahora escala
 * de forma UNIFORME para caber en la MISMA caja física (nunca cambia el
 * tamaño del sticker, nunca deforma).
 */
const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_SHARY_PHYSICAL_PRINT_PORT || 4199);
const url = `http://127.0.0.1:${port}/qa/fixtures/shary-physical-print-v2.html`;
const server = spawn(process.execPath, [path.join(root, 'node_modules/http-server/bin/http-server'), '.', '-p', String(port), '-c-1'], { cwd: root, stdio: 'ignore' });

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('SHARY physical print fixture did not start.');
}

function assert(condition, message) { if (!condition) throw new Error(message); }

async function run(name, browserType) {
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');

    // ── 1) Blank-row / pitch: @page height must be the REAL physical
    // pitch (heightMm + gapYmm = 62mm, not 60mm), and every non-final
    // page must be 100% filled -- no phantom blank physical row. ──
    for (const quantity of [2, 4, 6]) {
      const { capture, pageCount } = await page.evaluate((q) => window.runPrintScenario(q), quantity);
      const expectedPages = Math.ceil(quantity / 2); // columns:2, rows:1
      assert(pageCount === expectedPages, `[${name}/N=${quantity}] expected ${expectedPages} physical rows, got ${pageCount}`);
      assert(/size:82mm 62mm/.test(capture.pageCss), `[${name}/N=${quantity}] @page must be the real physical pitch 82x62mm (60mm label + 2mm gap), got: ${capture.pageCss}`);
      assert(capture.pages.length === expectedPages, `[${name}/N=${quantity}] captured pages must match plan pages`);
      capture.pages.forEach((pageCapture, index) => {
        const filledCount = pageCapture.cells.filter((c) => c.status === 'filled').length;
        assert(filledCount > 0, `[${name}/N=${quantity}] page ${index + 1} must never be entirely blank -- this is the exact "fila física vacía" bug`);
        if (index < capture.pages.length - 1) {
          assert(filledCount === 2, `[${name}/N=${quantity}] every non-final page must be 100% filled (2/2), page ${index + 1} has ${filledCount}/2`);
        }
      });
      const totalFilled = capture.pages.reduce((sum, p) => sum + p.cells.filter((c) => c.status === 'filled').length, 0);
      assert(totalFilled === quantity, `[${name}/N=${quantity}] total filled cells must equal the requested quantity, got ${totalFilled}`);
    }

    // ── 2) contentRotation/shape must survive the REAL saved-template
    // round-trip (universalDocumentFromTemplate), not just a raw
    // normalizeDocument call. ──
    for (const rotation of [0, 90, 180, 270]) {
      const result = await page.evaluate((r) => window.runTemplateRoundTrip(r), rotation);
      assert(result.contentRotation === rotation, `[${name}] contentRotation:${rotation} must survive universalDocumentFromTemplate() (the real saved-template print path), got ${result.contentRotation}`);
    }

    // ── 3) No squash: a perfectly square QR must render as a square
    // bounding box at BOTH rotation:0 and rotation:90 -- proves the
    // rotated content is uniformly scaled to fit the SAME physical box,
    // never non-uniformly stretched. ──
    const unrotated = await page.evaluate(() => window.runRotationSquashCheck(0));
    const rotated90 = await page.evaluate(() => window.runRotationSquashCheck(90));
    assert(unrotated.boxWidth > 10 && unrotated.boxHeight > 10, `[${name}] sanity: the unrotated QR must actually render (got box ${unrotated.boxWidth}x${unrotated.boxHeight})`);
    assert(Math.abs(unrotated.aspect - 1) < 0.05, `[${name}] the QR at rotation:0 must render square (aspect ~1.0), got ${unrotated.aspect.toFixed(3)}`);
    assert(Math.abs(rotated90.aspect - 1) < 0.05, `[${name}] the QR at rotation:90 must STILL render square (aspect ~1.0) -- a non-uniform stretch (the old bug) would make a square QR render as a rectangle, got ${rotated90.aspect.toFixed(3)} (box ${rotated90.boxWidth}x${rotated90.boxHeight})`);
    // The physical box itself never changes size -- rotating content does
    // not redefine the die-cut sticker's own dimensions.
    assert(unrotated.canvasWidth === rotated90.canvasWidth && unrotated.canvasHeight === rotated90.canvasHeight, `[${name}] the physical label box must be identical regardless of content rotation`);

    if (errors.length) throw new Error(`[${name}] unexpected page errors: ${JSON.stringify(errors)}`);
    console.log(`CLICK 360 r37.2.1 SHARY physical print ${name} PASS: 2/4/6 etiquetas consecutivas sin filas físicas vacías (paso real 82x62mm, no 82x60mm), contentRotation sobrevive el round-trip de plantilla guardada, y una rotación de 90° nunca deforma el contenido (QR sigue cuadrado).`);
  } finally {
    await browser.close();
  }
}

try {
  await waitForServer();
  await run('chromium', chromium);
  if (process.env.SKIP_WEBKIT === '1') {
    console.warn('WARN: WebKit unavailable in this environment — skipping WebKit SHARY physical print tests (SKIP_WEBKIT=1).');
  } else {
    await run('webkit', webkit);
  }
} finally {
  server.kill('SIGTERM');
}
