import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

/**
 * P0-2 (SHARY, Section 9): localDateKey() used to read
 * Date.getFullYear()/getMonth()/getDate(), which resolve in whatever
 * timezone the DEVICE's OS clock claims -- not necessarily Ecuador's real
 * timezone. A device with a misconfigured clock (UTC, or any other zone)
 * would compute a different "today" than a correctly configured one at the
 * exact same real moment, especially around Ecuador midnight (UTC-5, no
 * DST): 19:30 Ecuador time is already 00:30 UTC the next day.
 *
 * This test launches the browser with its SYSTEM timezone forced to UTC
 * (simulating exactly that misconfigured-device scenario) and verifies
 * localDateKey() still returns the correct Ecuador-local date at four
 * moments straddling midnight: 23:50, 23:59, 00:01, 00:10.
 */
const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_TZ_E2E_PORT || 4724);
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

// Ecuador is UTC-5 year-round (no DST). These are exact UTC instants for
// the stated Ecuador wall-clock moments on 2026-08-22/23.
const CASES = [
  { label: '23:50 Ecuador on 2026-08-22', utcIso: '2026-08-23T04:50:00.000Z', expectedDate: '2026-08-22' },
  { label: '23:59 Ecuador on 2026-08-22', utcIso: '2026-08-23T04:59:00.000Z', expectedDate: '2026-08-22' },
  { label: '00:01 Ecuador on 2026-08-23', utcIso: '2026-08-23T05:01:00.000Z', expectedDate: '2026-08-23' },
  { label: '00:10 Ecuador on 2026-08-23', utcIso: '2026-08-23T05:10:00.000Z', expectedDate: '2026-08-23' },
];

async function run() {
  // Force the browser's own OS/system timezone to UTC -- a device
  // completely misconfigured relative to Ecuador -- to prove the fix does
  // not depend on the device being configured correctly.
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ timezoneId: 'UTC' });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof window.click360LocalDateKey === 'function', { timeout: 15000 });

    for (const testCase of CASES) {
      const actual = await page.evaluate((iso) => window.click360LocalDateKey(new Date(iso)), testCase.utcIso);
      console.log(`${testCase.label}: got ${actual}, expected ${testCase.expectedDate}`);
      assert(actual === testCase.expectedDate, `FAIL at ${testCase.label} (browser timezone forced to UTC): localDateKey returned ${actual}, expected ${testCase.expectedDate} -- a sale near Ecuador midnight would land on the wrong day`);
    }

    console.log('PASS: date-key computation is correct across Ecuador midnight (23:50/23:59/00:01/00:10) even when the device\'s own system timezone is misconfigured to UTC.');
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
