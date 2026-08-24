import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

/**
 * r37 (#90): live-browser proof that window.click360GuardedAction actually
 * behaves correctly, not just that the source text mentions the right
 * pieces (see qa-r37-action-guardian-harness.cjs for the structural side):
 *  - a rapid second tap while the first call is still in flight never
 *    re-invokes the wrapped action;
 *  - the button shows "Procesando..." and is disabled during the call;
 *  - the watchdog swaps in a human "taking longer" notice for a slow call;
 *  - the button returns to its normal, enabled, original-label state once
 *    the call settles, ready for a legitimate next action.
 */
const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_ACTION_GUARDIAN_E2E_PORT || 4734);
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

async function run() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof window.CLICK360_QA?.guardedAction === 'function', { timeout: 15000 });

    const doubleTapResult = await page.evaluate(async () => {
      const button = document.createElement('button');
      button.textContent = 'Anular venta';
      document.body.appendChild(button);
      let callCount = 0;
      let resolveFirst;
      const run = () => new Promise((resolve) => {
        callCount += 1;
        resolveFirst = resolve;
      });
      const firstCallPromise = window.CLICK360_QA.guardedAction(button, run);
      const midFlightSnapshot = { disabled: button.disabled, text: button.textContent, callCount };
      // A rapid second tap while the first call is still unresolved.
      const secondCallPromise = window.CLICK360_QA.guardedAction(button, run);
      resolveFirst('done');
      await Promise.all([firstCallPromise, secondCallPromise]);
      const settledSnapshot = { disabled: button.disabled, text: button.textContent };
      button.remove();
      return { callCount, midFlightSnapshot, settledSnapshot };
    });

    assert(doubleTapResult.callCount === 1, `a rapid second tap while busy must never re-invoke the wrapped action, got callCount=${doubleTapResult.callCount}`);
    assert(doubleTapResult.midFlightSnapshot.disabled === true, 'the button must be disabled immediately on the first tap');
    assert(doubleTapResult.midFlightSnapshot.text === 'Procesando...', `the button must show "Procesando..." immediately on the first tap, got "${doubleTapResult.midFlightSnapshot.text}"`);
    assert(doubleTapResult.settledSnapshot.disabled === false, 'the button must be re-enabled once the call settles');
    assert(doubleTapResult.settledSnapshot.text === 'Anular venta', `the button must return to its original label once the call settles, got "${doubleTapResult.settledSnapshot.text}"`);

    // The real ACTION_GUARDIAN_WATCHDOG_MS constant is read from the app itself
    // rather than hardcoded here, so this test stays correct if that threshold
    // is ever retuned.
    const realWatchdogMs = await page.evaluate(() => window.CLICK360_QA.ACTION_GUARDIAN_WATCHDOG_MS);
    const watchdogResult2 = await page.evaluate(async (watchdogMs) => {
      const button = document.createElement('button');
      button.textContent = 'Guardar';
      document.body.appendChild(button);
      const slow = new Promise((resolve) => setTimeout(resolve, watchdogMs + 400));
      const promise = window.CLICK360_QA.guardedAction(button, () => slow);
      await new Promise((resolve) => setTimeout(resolve, watchdogMs + 200));
      const duringWatchdog = { text: button.textContent, disabled: button.disabled };
      await promise;
      const settled = { text: button.textContent, disabled: button.disabled };
      button.remove();
      return { duringWatchdog, settled };
    }, realWatchdogMs);

    assert(watchdogResult2.duringWatchdog.text === 'Esto está tardando más de lo normal...', `a slow operation must surface the watchdog notice instead of leaving "Procesando..." unexplained forever, got "${watchdogResult2.duringWatchdog.text}"`);
    assert(watchdogResult2.duringWatchdog.disabled === true, 'the button must remain disabled during the watchdog notice (no accidental re-trigger while still genuinely in flight)');
    assert(watchdogResult2.settled.text === 'Guardar', 'the button must return to its original label once the slow operation finally settles');
    assert(watchdogResult2.settled.disabled === false, 'the button must be re-enabled once the slow operation finally settles');

    if (pageErrors.length) throw new Error(`Unexpected page errors: ${JSON.stringify(pageErrors)}`);

    console.log('CLICK 360 r37 Action Guardian E2E PASS: a rapid second tap while busy is ignored outright (never a second call), the first tap shows disabled+"Procesando..." immediately, a slow operation surfaces a watchdog notice instead of an infinite unexplained spinner, and the button returns to its normal usable state once the call settles.');
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
