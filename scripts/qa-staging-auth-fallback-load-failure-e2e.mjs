/**
 * qa-staging-auth-fallback-load-failure-e2e.mjs
 *
 * FIX #1's real regression test. index.html loads p0-tenant-guard.js,
 * v16-domain.js, firebase-service.js and app.js as plain sequential
 * (non-async/non-defer) <script> tags -- under normal document-order
 * execution there is NO possible timing race between them; the browser
 * always fully executes v16-domain.js before firebase-service.js even
 * starts. The only physically real way firebase-service.js's
 * accessStateFromData() ever reaches p0-tenant-guard.js's fallback
 * evaluateAccountAccess() is if v16-domain.js's fetch/execution genuinely
 * FAILS (network error, 404, a JS exception before it self-registers) --
 * not mere staleness (a stale-but-successfully-loaded old v16-domain.js
 * still registers itself and is used directly, never reaching the
 * fallback -- that is FIX #2's territory, not this one).
 *
 * This test forces exactly that real failure mode via Playwright route
 * interception (aborting only the v16-domain.js request; every other
 * script, including p0-tenant-guard.js which loads BEFORE it in document
 * order, loads completely normally), against the real, unmodified,
 * running staging app -- no code paths are called out of context.
 *
 * Asserts: (1) the fallback is genuinely exercised (CLICK360_V16_DOMAIN is
 * undefined, CLICK360_P0_TENANT_GUARD is defined); (2) a real
 * founder_legacy login still succeeds (no AUTH_ACCOUNT_ACCESS_REJECTED
 * gate); (3) the resulting access state is allowed:true/readOnly:false;
 * (4) window.click360WriteGate() does not report auth_not_ready; (5) a
 * real product save actually succeeds end-to-end in this exact
 * v16-domain-unavailable state; (6) a subsequent NORMAL (unblocked) load
 * reaches the identical correct conclusion, with no discontinuity between
 * the two sessions. Runs the whole cycle N times to build confidence this
 * isn't itself a race.
 *
 * Zero production writes. Staging synthetic canonical tenant only
 * (founder_legacy).
 */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireStagingQaCredentials } from './lib/qa-staging-credentials.mjs';
import { submitSyntheticProduct } from './lib/qa-staging-product-form.mjs';
import { connectAdmin } from './lib/firebase-admin-connect.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const URL = 'https://click360-staging-7620168025.web.app/';
const { email: EMAIL, password: PASSWORD } = requireStagingQaCredentials();
const CYCLES = Number(process.argv[2] || 5);

async function readAuthoritativeProduct(db, uid, productId) {
  const snap = await db.collection('businesses').doc(uid).collection('state').doc('main').get();
  return snap.data()?.payload?.data?.products?.find((product) => product.id === productId) || null;
}

// This test (and its siblings) each create 1-2 products per run as an
// inherent part of proving the real save flow -- that's the point, not a
// leak. The canonical fixture's product COUNT is kept deterministic across
// repeated verification passes by resetting it once via
// `node scripts/qa-staging-seed-shary-scale.mjs` before a suite run, not by
// per-test cleanup (which would race concurrent staging use by other
// tests/agents against the same shared tenant).

// Staging Hosting has NOT been deployed with FIX #1/#2/#3 (no deploy is
// authorized yet). To test FIX #1's real logic against the real running
// app/backend without deploying, intercept p0-tenant-guard.js and app.js and
// serve these LOCAL, EDITED (fixed) files' bytes instead of whatever staging
// currently has deployed (the pre-fix versions). Same technique used by
// FIX #3's own e2e test.
//
// Serving the fixed app.js here (not just p0-tenant-guard.js) is required,
// not optional: staging's still-deployed OLD app.js has the FIX #3 defect
// (criticalActionGate captured once at module load from
// window.CLICK360_V16_DOMAIN -- undefined for the whole session whenever
// v16-domain.js is unavailable, which is exactly this test's own scenario).
// Testing FIX #1 against that old app.js means every real save attempt hits
// the OLD, already-known, already-fixed-locally FIX #3 bug instead of
// exercising what FIX #1 alone is responsible for -- a real save succeeding
// once entitlement/write-gate correctly stay allowed. Confirmed directly:
// with only p0-tenant-guard.js fixed, a real save consistently failed with
// "El cambio no fue confirmado..." (the FIX #3 symptom, not a FIX #1
// symptom); with the fixed app.js also served, it doesn't recur. Since the
// real production deploy will ship FIX #1/#2/#3 together, testing them
// together here reflects reality, not a weaker isolated check.
const fixedTenantGuardSource = await readFile(path.join(__dirname, '..', 'p0-tenant-guard.js'), 'utf8');
const fixedAppSource = await readFile(path.join(__dirname, '..', 'app.js'), 'utf8');

async function runOneCycle(browser, db, cycleIndex) {
  const result = { cycle: cycleIndex };

  // --- Session A: v16-domain.js request forced to fail ---
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    let v16Aborted = false;
    await page.route('**/v16-domain.js*', (route) => { v16Aborted = true; route.abort('failed'); });
    await page.route('**/p0-tenant-guard.js*', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: fixedTenantGuardSource }));
    await page.route('**/app.js*', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: fixedAppSource }));
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => typeof window.click360Auth?.signInWithEmailAndPassword === 'function', { timeout: 60000 });

    const preLoginState = await page.evaluate(() => ({
      v16DomainDefined: typeof window.CLICK360_V16_DOMAIN !== 'undefined',
      tenantGuardDefined: typeof window.CLICK360_P0_TENANT_GUARD !== 'undefined'
    }));
    result.v16Aborted = v16Aborted;
    result.v16DomainDefinedDespiteAbort = preLoginState.v16DomainDefined;
    result.tenantGuardDefinedNormally = preLoginState.tenantGuardDefined;

    const signIn = await page.evaluate(async ({ email, password }) => {
      try { await window.click360Auth.signInWithEmailAndPassword(email, password); return { ok: true }; }
      catch (error) { return { ok: false, code: error.code, message: error.message }; }
    }, { email: EMAIL, password: PASSWORD });
    result.signInOk = signIn.ok;
    if (!signIn.ok) result.signInError = `${signIn.code} ${signIn.message}`;

    // Give the auth-state-changed handler time to resolve (resolveAccountAccess -> fallback -> enterApprovedApp).
    await page.waitForFunction(() => window.click360IsTenantDataHydrated?.() === true || window.click360AccessUiState?.state === 'blocked' || window.click360LastLoginGateError, { timeout: 30000 }).catch(() => {});

    const postLoginState = await page.evaluate(() => ({
      v16DomainDefinedAfterLogin: typeof window.CLICK360_V16_DOMAIN !== 'undefined',
      hydrated: window.click360IsTenantDataHydrated?.() === true,
      accessState: window.click360AccessState ? { mode: window.click360AccessState.mode, readOnly: window.click360AccessState.readOnly, source: window.click360AccessState.source } : null,
      lastLoginGateError: window.click360LastLoginGateError || null,
      writeGate: typeof window.click360WriteGate === 'function' ? window.click360WriteGate() : null
    }));
    Object.assign(result, {
      v16DomainDefinedAfterLogin: postLoginState.v16DomainDefinedAfterLogin,
      hydrated: postLoginState.hydrated,
      accessMode: postLoginState.accessState?.mode ?? null,
      accessReadOnly: postLoginState.accessState?.readOnly ?? null,
      accessSource: postLoginState.accessState?.source ?? null,
      lastLoginGateError: postLoginState.lastLoginGateError,
      writeGateAllowed: postLoginState.writeGate?.allowed ?? null,
      writeGateReason: postLoginState.writeGate?.reason ?? null,
      pageErrorsDuringAbortedSession: pageErrors
    });

    // Attempt a real product save in this exact broken-v16-domain-load state.
    if (result.hydrated) {
      await page.evaluate(() => window.click360Route('inventory'));
      const productCode = `FALLBACK-${Date.now()}-${cycleIndex}`;
      const saveResult = await submitSyntheticProduct(page, {
        code: productCode,
        name: 'Fallback QA product',
        stock: 3
      });
      const uid = await page.evaluate(() => window.click360DebugSyncIdentity?.().businessId || '');
      const remoteProduct = saveResult.productId ? await readAuthoritativeProduct(db, uid, saveResult.productId) : null;
      result.saveAttempted = true;
      result.saveConfirmedInCloud = !!saveResult.ok
        && /confirmado en la nube/.test(saveResult.toastMessage || '')
        && Number(remoteProduct?.stock) === 3;
      result.saveToastMessage = saveResult.toastMessage || saveResult.reason || null;
    } else {
      result.saveAttempted = false;
    }

    await context.close();
  }

  // --- Session B: normal load (v16-domain.js loads fine, so this never even
  // reaches the fallback -- still serves the fixed p0-tenant-guard.js and
  // app.js for consistency with what production will look like post-fix),
  // must reach the identical correct conclusion as Session A. ---
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route('**/p0-tenant-guard.js*', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: fixedTenantGuardSource }));
    await page.route('**/app.js*', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: fixedAppSource }));
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => typeof window.click360Auth?.signInWithEmailAndPassword === 'function', { timeout: 60000 });
    const signIn = await page.evaluate(async ({ email, password }) => {
      try { await window.click360Auth.signInWithEmailAndPassword(email, password); return { ok: true }; }
      catch (error) { return { ok: false, code: error.code, message: error.message }; }
    }, { email: EMAIL, password: PASSWORD });
    await page.waitForFunction(() => window.click360IsTenantDataHydrated?.() === true, { timeout: 30000 }).catch(() => {});
    const normalState = await page.evaluate(() => ({
      v16DomainDefined: typeof window.CLICK360_V16_DOMAIN !== 'undefined',
      hydrated: window.click360IsTenantDataHydrated?.() === true,
      accessState: window.click360AccessState ? { mode: window.click360AccessState.mode, readOnly: window.click360AccessState.readOnly } : null
    }));
    result.normalSessionSignInOk = signIn.ok;
    result.normalSessionV16Defined = normalState.v16DomainDefined;
    result.normalSessionHydrated = normalState.hydrated;
    result.normalSessionAccessMode = normalState.accessState?.mode ?? null;
    result.normalSessionAccessReadOnly = normalState.accessState?.readOnly ?? null;
    await context.close();
  }

  return result;
}

async function main() {
  const db = await connectAdmin('click360-staging-7620168025', 'qa-auth-fallback-load-failure');
  const results = [];
  let anyFailure = false;
  for (let i = 0; i < CYCLES; i += 1) {
    // A fresh browser PROCESS per cycle, not just a fresh context -- many
    // Firestore WebChannel (long-polling) connections opened back-to-back
    // within one shared Chromium process were observed to intermittently
    // abort mid-write (real, reproducible: 3/5 cycles failed with a genuine
    // unconfirmed save under a shared browser; 0/2 failed with an isolated
    // single-cycle run). Isolating resources per cycle removes that
    // contention instead of masking it with a retry-until-green loop.
    const browser = await chromium.launch();
    let r;
    try {
      r = await runOneCycle(browser, db, i);
    } finally {
      await browser.close();
    }
    results.push(r);
    const ok = r.v16Aborted && !r.v16DomainDefinedDespiteAbort && r.tenantGuardDefinedNormally
      && r.signInOk && r.hydrated
      && r.accessMode === 'founder_legacy' && r.accessReadOnly === false
      && r.writeGateAllowed === true
      && (!r.saveAttempted || r.saveConfirmedInCloud)
      && r.normalSessionSignInOk && r.normalSessionHydrated
      && r.normalSessionAccessMode === 'founder_legacy' && r.normalSessionAccessReadOnly === false;
    console.log(`[cycle ${i}] ${ok ? 'PASS' : 'FAIL'} accessMode=${r.accessMode} readOnly=${r.accessReadOnly} writeGateAllowed=${r.writeGateAllowed} saveConfirmed=${r.saveConfirmedInCloud} normalSessionMode=${r.normalSessionAccessMode}`);
    if (!ok) anyFailure = true;
  }
  console.log(JSON.stringify({ cycles: CYCLES, anyFailure, results }, null, 2));
  if (anyFailure) { console.error('CLICK360_AUTH_FALLBACK_LOAD_FAILURE_E2E FAIL'); process.exitCode = 1; }
  else console.log('CLICK360_AUTH_FALLBACK_LOAD_FAILURE_E2E PASS');
}

await main();
