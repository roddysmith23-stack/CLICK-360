import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

// Reproduces the real production incident: a client's saved print profile carried a stale
// mediaWidthMm/mediaHeightMm left over from exploring an A4/sheet preset before configuring a
// real 60x40mm single roll label (only the paper-type <select>'s onchange handler,
// applyPaperType() in app.js, resets those fields — editing "Ancho/Alto de cada sticker"
// directly does not). At print time that stale value became the literal @page size: a
// correctly-rendered 60x40mm label positioned in the corner of an effective A4 page — exactly
// "la etiqueta aparece mucho más pequeña... esquina superior izquierda de una página blanca
// grande" as reported.
//
// Drives the REAL prepareLabelPrintJob() -> resolveLabelPrintProfile() ->
// mergeUniversalPaperIntoDocument() -> executeCanonicalLabelPrint() -> handoffPrint() chain,
// extracted verbatim from app.js (not a reimplementation), across 5 real profile shapes.

const root = path.resolve(import.meta.dirname, '..');
execFileSync(process.execPath, [path.join(root, 'qa/extract-print-profile-merge.cjs')], { stdio: 'inherit' });
execFileSync(process.execPath, [path.join(root, 'qa/extract-print-handoff.cjs')], { stdio: 'inherit' });

const port = Number(process.env.CLICK360_R33_PROFILE_MERGE_PORT || 4202);
const url = `http://127.0.0.1:${port}/qa/fixtures/r33-print-profile-merge.html`;
const server = spawn(process.execPath, [path.join(root, 'node_modules/http-server/bin/http-server'), '.', '-p', String(port), '-c-1'], { cwd: root, stdio: 'ignore' });

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('r33 print-profile-merge fixture did not start');
}

const EXPECT_60x40 = { widthMm: 60, heightMm: 40 };

function assertPageSize(scenarioName, pageStyleText, expected) {
  const match = pageStyleText && pageStyleText.match(/@page\{size:([\d.]+)mm ([\d.]+)mm/);
  if (!match) throw new Error(`${scenarioName}: no explicit mm @page size found in "${pageStyleText}"`);
  const [, w, h] = match;
  if (Math.abs(Number(w) - expected.widthMm) > 0.5 || Math.abs(Number(h) - expected.heightMm) > 0.5) {
    throw new Error(`${scenarioName}: expected @page ${expected.widthMm}mm x ${expected.heightMm}mm, got ${w}mm x ${h}mm — label would print small and offset inside an oversized page, matching the client incident`);
  }
}

try {
  await waitForServer();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');

    const results = {};
    for (const scenario of ['no_profile', 'modern_profile', 'legacy_profile', 'legacy_profile_2col', 'legacy_profile_stale_a4']) {
      results[scenario] = await page.evaluate((s) => window.__CLICK360_RUN_SCENARIO__(s), scenario);
    }
    console.log('r33 profile-merge scenario results:', JSON.stringify(results, null, 1));

    // A) No saved profile, B) modern profile, C) legacy profile shape — all must resolve to the
    // real 60x40mm label, not a fallback page format.
    for (const scenario of ['no_profile', 'modern_profile', 'legacy_profile']) {
      if (results[scenario].prepareError) throw new Error(`${scenario}: prepareLabelPrintJob threw: ${results[scenario].prepareError}`);
      if (results[scenario].printError) throw new Error(`${scenario}: print threw: ${results[scenario].printError}`);
      assertPageSize(scenario, results[scenario].pageStyleText, EXPECT_60x40);
    }

    // D) Legacy roll width=0 explicitly means automatic carrier width. It must
    // preserve BOTH columns using their natural width; physical verification is
    // still advisory and an explicitly undersized measured width stays blocked.
    if (results.legacy_profile_2col.prepareError || results.legacy_profile_2col.printError) {
      throw new Error(`legacy_profile_2col: auto-width roll failed ${results.legacy_profile_2col.prepareError || results.legacy_profile_2col.printError}`);
    }
    assertPageSize('legacy_profile_2col', results.legacy_profile_2col.pageStyleText, { widthMm:82, heightMm:60 });

    // E) THE REPRODUCED BUG: a stale mediaWidthMm/mediaHeightMm (210x297, i.e. A4) left over on
    // a single-column/single-row profile must NOT become the printed page size — the label's own
    // 60x40mm must govern. This is the scenario that failed against the pre-fix source (verified:
    // pre-fix produced "@page{size:210mm 297mm;margin:0}"; post-fix produces
    // "@page{size:60mm 40mm;margin:0}").
    if (results.legacy_profile_stale_a4.prepareError) throw new Error(`legacy_profile_stale_a4: prepareLabelPrintJob threw: ${results.legacy_profile_stale_a4.prepareError}`);
    if (results.legacy_profile_stale_a4.printError) throw new Error(`legacy_profile_stale_a4: print threw: ${results.legacy_profile_stale_a4.printError}`);
    assertPageSize('legacy_profile_stale_a4', results.legacy_profile_stale_a4.pageStyleText, EXPECT_60x40);

    if (errors.length) throw new Error(`browser errors: ${JSON.stringify(errors)}`);
    console.log('CLICK360_R33_PRINT_PROFILE_MERGE_E2E: PASS');
  } finally {
    await browser.close();
  }
} finally {
  server.kill('SIGTERM');
}
