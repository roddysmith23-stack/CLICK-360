import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium, firefox, webkit } from 'playwright';

/**
 * P0 regression (SHARY black-screen incident, r36): the splash used to be
 * removed unconditionally at the 12s hard-fallback timer even if #app never
 * rendered anything, leaving a fully black screen with no way to recover.
 *
 * index.html now shows an explicit recovery screen (Reintentar / Actualizar
 * aplicacion / Reportar problema) instead, but ONLY when the boot has
 * genuinely stalled -- not for a perfectly healthy visitor looking at the
 * login gate, which lives outside #app by design and so also leaves #app
 * empty for the entire time it's shown.
 *
 * This test exercises the real inline boot-decision script extracted
 * verbatim from index.html (not a hand-copied duplicate, so it can't drift
 * from the shipped logic) against four scenarios.
 */
const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_BOOT_RECOVERY_E2E_PORT || 4715);
const fixturePath = path.join(root, 'qa/fixtures/generated/r36-boot-recovery.html');
const url = `http://127.0.0.1:${port}/qa/fixtures/generated/r36-boot-recovery.html`;

async function buildFixture() {
  const indexHtml = await readFile(path.join(root, 'index.html'), 'utf8');
  const scriptMatch = indexHtml.match(/<script>\s*\(\(\) => \{[\s\S]*?click360MarkSplashReady[\s\S]*?\}\)\(\);\s*<\/script>/);
  if (!scriptMatch) throw new Error('Could not extract the boot-decision script from index.html -- structure changed?');
  await mkdir(path.dirname(fixturePath), { recursive: true });
  await writeFile(fixturePath, `<!doctype html>
<html><head><meta charset="utf-8"><link rel="stylesheet" href="../../../styles.css"></head>
<body>
  <div id="click360Splash" class="click360Splash" aria-hidden="true">
    <img src="" alt="" width="1" height="1">
    <strong>CLICK 360</strong>
    <small>Fixture</small>
    <div class="click360SplashProgress" aria-hidden="true"><i></i></div>
  </div>
  <div id="app"></div>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>
  ${scriptMatch[0]}
</body></html>`);
}

const server = spawn(process.execPath, [path.join(root, 'node_modules/http-server/bin/http-server'), '.', '-p', String(port), '-c-1'], { cwd: root, stdio: 'ignore' });

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Boot recovery fixture did not start.');
}

async function scenario(page, label, setup) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (setup) await page.evaluate(setup);
  await page.waitForTimeout(12600);
  return page.evaluate(() => {
    const splash = document.getElementById('click360Splash');
    return {
      splashInDom: !!splash && document.body.contains(splash),
      hasRecoveryClass: splash?.classList.contains('click360BootRecovery') || false,
      hasRetryBtn: !!document.getElementById('click360BootRetry'),
      hasUpdateBtn: !!document.getElementById('click360BootUpdate')
    };
  });
}

function assert(condition, message) { if (!condition) throw new Error(message); }

async function run(name, browserType) {
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    let state = await scenario(page, 'unauthenticated', () => { window.click360AccessUiState = { state: 'unauthenticated' }; });
    assert(!state.hasRecoveryClass, `${name}: recovery screen wrongly shown for a healthy unauthenticated visitor (login gate legitimately renders outside #app)`);

    state = await scenario(page, 'ready-but-empty', () => { window.click360AccessUiState = { state: 'ready' }; });
    assert(state.hasRecoveryClass && state.hasRetryBtn && state.hasUpdateBtn, `${name}: recovery screen did NOT appear for the ready-but-#app-still-empty stall -- this is the exact SHARY black-screen shape (firebase-service.js unlocked the gate but app.js never rendered anything)`);

    state = await scenario(page, 'no-state-published', null);
    assert(state.hasRecoveryClass, `${name}: recovery screen did NOT appear when no access-ui-state was ever published at all (earliest possible boot hang)`);

    state = await scenario(page, 'app-rendered', () => { document.getElementById('app').innerHTML = '<div>rendered</div>'; });
    assert(!state.hasRecoveryClass, `${name}: recovery screen wrongly shown when #app genuinely has rendered content`);

    if (pageErrors.length) throw new Error(`${name}: unexpected page errors: ${JSON.stringify(pageErrors)}`);
  } finally {
    await browser.close();
  }
}

try {
  await buildFixture();
  await waitForServer();
  await run('chromium', chromium);
  if (process.env.SKIP_WEBKIT === '1') {
    console.warn('WARN: WebKit unavailable in this environment — skipping WebKit boot-recovery tests (SKIP_WEBKIT=1).');
  } else {
    await run('webkit', webkit);
  }
  if (process.env.SKIP_FIREFOX === '1') {
    console.warn('WARN: Firefox unavailable in this environment — skipping Firefox boot-recovery tests (SKIP_FIREFOX=1).');
  } else {
    await run('firefox', firefox);
  }
  console.log('CLICK 360 r36 boot-recovery E2E PASS: stalled boot shows a recovery screen, healthy unauthenticated/rendered states do not');
} finally {
  server.kill('SIGTERM');
}
