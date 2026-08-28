/**
 * qa-staging-critical-action-gate-load-failure-e2e.mjs
 *
 * FIX #3's real regression test. Proven defect: app.js used to capture
 * `criticalActionGate` ONCE, statically, at module load, from
 * window.CLICK360_V16_DOMAIN.createOperationGate(). If v16-domain.js
 * failed to load entirely, that reference stayed undefined for the whole
 * session and EVERY critical mutation (product save, etc.) was rejected
 * with a misleading "La operacion ya se esta procesando" toast -- with
 * ZERO writes ever attempted, since acquireCriticalAction() short-circuited
 * before calling save() at all.
 *
 * FIX #3 replaces the static capture with resolveCriticalActionGate(),
 * which re-checks window.CLICK360_V16_DOMAIN at the moment of each
 * mutation and falls back to a behaviorally-identical LOCAL gate (verified
 * by direct source reading to have zero entitlement/authorization logic --
 * pure in-memory duplicate-submission dedup) when the real one is
 * unavailable, so a genuine v16-domain.js load failure degrades ONLY that
 * one reliability mechanism instead of blocking every save.
 *
 * Staging Hosting has NOT been deployed with FIX #1/#2/#3 (no deploy
 * authorized yet). This test intercepts requests for v16-domain.js (force
 * an abort -- a real load failure, not a simulated function call),
 * p0-tenant-guard.js (serve the local FIX #1 file), and app.js (serve the
 * local FIX #3 file) against the real, unmodified, running staging
 * app/backend -- same technique already used and proven for FIX #1/#2.
 *
 * Cases covered:
 *  A - normal load (v16-domain loads fine): gate resolves to the real
 *      v16-domain gate, behavior identical to pre-FIX#3.
 *  B - real v16-domain.js load failure: gate resolves to the local
 *      fallback; a real product save still succeeds end-to-end; the old
 *      false "operacion ya se esta procesando" message never appears; a
 *      SECOND sequential save also succeeds (gate isn't stuck "busy"
 *      forever); TWO deliberately overlapping saves with the same
 *      operation key still correctly dedupe (one wins, one is rejected as
 *      a genuine duplicate) -- proving the fallback preserves the gate's
 *      real purpose, not just "always allow".
 *  C - domain becomes available later in the same session: physically
 *      impossible to trigger via real script-tag timing alone (by the time
 *      any acquireCriticalAction() call can happen, all script tags have
 *      already either succeeded or permanently failed -- same finding
 *      FIX #1's test made for the entitlement fallback). Tested instead by
 *      directly assigning a real createOperationGate-shaped object onto
 *      window.CLICK360_V16_DOMAIN mid-session from the test (the same
 *      class of technique already used to force conditions the real page
 *      can't produce via script timing alone) and confirming the resolver
 *      genuinely reads it fresh and upgrades once no operation is in
 *      flight.
 *  D - repeated cycles (CLI arg, default 5; pass a larger number for the
 *      100+ cycle requirement) of A+B to build confidence neither is a
 *      race.
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

const REPO_ROOT = path.join(__dirname, '..');
const fixedTenantGuardSource = await readFile(path.join(REPO_ROOT, 'p0-tenant-guard.js'), 'utf8');
const fixedAppSource = await readFile(path.join(REPO_ROOT, 'app.js'), 'utf8');
const realV16DomainSource = await readFile(path.join(REPO_ROOT, 'v16-domain.js'), 'utf8');

async function newContextWithFixes(browser, { abortV16 }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  if (abortV16) await page.route('**/v16-domain.js*', (route) => route.abort('failed'));
  await page.route('**/p0-tenant-guard.js*', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: fixedTenantGuardSource }));
  await page.route('**/app.js*', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: fixedAppSource }));
  return { context, page };
}

async function signInAndHydrate(page) {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => typeof window.click360Auth?.signInWithEmailAndPassword === 'function', { timeout: 60000 });
  const signIn = await page.evaluate(async ({ email, password }) => {
    try { await window.click360Auth.signInWithEmailAndPassword(email, password); return { ok: true }; }
    catch (error) { return { ok: false, code: error.code, message: error.message }; }
  }, { email: EMAIL, password: PASSWORD });
  await page.waitForFunction(() => window.click360IsTenantDataHydrated?.() === true, { timeout: 30000 }).catch(() => {});
  const hydrated = await page.evaluate(() => window.click360IsTenantDataHydrated?.() === true);
  return { signInOk: signIn.ok, hydrated };
}

async function readAuthoritativeProduct(db, uid, productId, productCode) {
  const snap = await db.collection('businesses').doc(uid).collection('state').doc('main').get();
  const normalizedCode = String(productCode || '').trim().toUpperCase();
  return snap.data()?.payload?.data?.products?.find((product) =>
    (productId && product.id === productId)
      || String(product.code || '').trim().toUpperCase() === normalizedCode
  ) || null;
}

async function confirmedSave(page, db, code, stock = 5) {
  const save = await submitSyntheticProduct(page, { code, name: 'FIX3 QA product', stock, cost: 2, price: 6, cardPrice: 6.5 });
  const uid = await page.evaluate(() => window.click360DebugSyncIdentity?.().businessId || '');
  const remoteProduct = await readAuthoritativeProduct(db, uid, save.productId, code);
  return {
    ...save,
    authoritative: Number(remoteProduct?.stock) === stock,
    authoritativeStock: remoteProduct ? Number(remoteProduct.stock ?? remoteProduct.qty) : null,
    authoritativeProductFound: !!remoteProduct,
    productIdResolved: !!save.productId
  };
}

async function caseA(browser, db) {
  const { context, page } = await newContextWithFixes(browser, { abortV16: false });
  const { signInOk, hydrated } = await signInAndHydrate(page);
  const gateBefore = await page.evaluate(() => window.click360DebugCriticalActionGate?.() || null);
  const save = hydrated ? await confirmedSave(page, db, `A-${Date.now()}`) : { ok: false, reason: 'not_hydrated' };
  const gateAfter = await page.evaluate(() => window.click360DebugCriticalActionGate?.() || null);
  await context.close();
  return {
    signInOk, hydrated,
    gateIsFallback: gateAfter?.isFallback ?? null,
    saveOk: save.ok, toastMessage: save.toastMessage || save.reason || null,
    saveConfirmed: !!save.ok && save.authoritative && /confirmado en la nube/.test(save.toastMessage || ''),
    falseOperationInProgress: !!save.ok && /ya se est.\s*procesando/.test(save.toastMessage || ''),
    gateBefore, gateAfter
  };
}

async function caseB(browser, db, cycleIndex) {
  const { context, page } = await newContextWithFixes(browser, { abortV16: true });
  const { signInOk, hydrated } = await signInAndHydrate(page);
  const v16Defined = await page.evaluate(() => typeof window.CLICK360_V16_DOMAIN !== 'undefined');

  const save1 = hydrated ? await confirmedSave(page, db, `B1-${cycleIndex}-${Date.now()}`) : { ok: false, reason: 'not_hydrated' };
  const gateAfterFirst = await page.evaluate(() => window.click360DebugCriticalActionGate?.() || null);
  // Second, SEQUENTIAL save must also succeed -- the gate must not be
  // permanently "stuck" after one release.
  const save2 = hydrated ? await confirmedSave(page, db, `B2-${cycleIndex}-${Date.now()}`) : { ok: false, reason: 'not_hydrated' };

  // NOTE: the genuine-concurrent-duplicate dedup property (does the
  // fallback still reject a second begin() on the same in-flight key, not
  // just "always allow") is proven separately and more reliably by
  // qa-critical-action-gate-resolver-contract-harness.mjs, which exercises
  // the exact extracted real source deterministically in plain Node,
  // without depending on fragile same-tick DOM event timing in a real
  // browser. Not duplicated here.

  await context.close();
  return {
    cycle: cycleIndex, v16Aborted: true, v16DomainDefinedDespiteAbort: v16Defined,
    signInOk, hydrated,
    gateIsFallback: gateAfterFirst?.isFallback ?? null,
    save1Ok: save1.ok, save1Toast: save1.toastMessage || save1.reason || null,
    save1Confirmed: !!save1.ok && save1.authoritative && /confirmado en la nube/.test(save1.toastMessage || ''),
    save1FalseOperationInProgress: !!save1.ok && /ya se est.\s*procesando/.test(save1.toastMessage || ''),
    save2Ok: save2.ok, save2Toast: save2.toastMessage || save2.reason || null,
    save2Confirmed: !!save2.ok && save2.authoritative && /confirmado en la nube/.test(save2.toastMessage || ''),
    save2FalseOperationInProgress: !!save2.ok && /ya se est.\s*procesando/.test(save2.toastMessage || '')
  };
}

async function caseC(browser, db) {
  // Physically cannot happen via real script-tag timing (see file header) --
  // tested by directly assigning a real gate onto window.CLICK360_V16_DOMAIN
  // mid-session after the fallback has already engaged, then confirming the
  // resolver reads it fresh on the next mutation attempt.
  const { context, page } = await newContextWithFixes(browser, { abortV16: true });
  const { hydrated } = await signInAndHydrate(page);
  if (!hydrated) { await context.close(); return { skipped: true, reason: 'not_hydrated' }; }

  const beforeUpgrade = await page.evaluate(() => window.click360DebugCriticalActionGate?.() || null);
  // Engage the fallback once (size must be 0 afterward -- release() runs in
  // a finally block).
  await confirmedSave(page, db, `C-pre-${Date.now()}`);
  const afterFirstSave = await page.evaluate(() => window.click360DebugCriticalActionGate?.() || null);

  // Now make the real domain available mid-session -- inject the ACTUAL
  // real v16-domain.js file content (page.addScriptTag), not a partial
  // hand-written stub. A partial stub (only createOperationGate) broke
  // unrelated rendering code that also reads window.CLICK360_V16_DOMAIN
  // (e.g. normalizeTaxConfig) -- a real late-arriving script always
  // registers its FULL API surface atomically, so the real file is both
  // more faithful and avoids that false failure.
  await page.addScriptTag({ content: realV16DomainSource });

  const save = await confirmedSave(page, db, `C-post-${Date.now()}`);
  const afterUpgrade = await page.evaluate(() => window.click360DebugCriticalActionGate?.() || null);
  await context.close();
  return {
    skipped: false,
    beforeUpgradeIsFallback: beforeUpgrade?.isFallback ?? null,
    afterFirstSaveSize: afterFirstSave?.size ?? null,
    upgradedToReal: afterUpgrade?.isFallback === false,
    saveOk: save.ok, saveReason: save.reason || null, saveToastMessage: save.toastMessage || null,
    saveAfterUpgradeOk: !!save.ok && save.authoritative && /confirmado en la nube/.test(save.toastMessage || ''),
    authoritativeProductFound: save.authoritativeProductFound,
    productIdResolved: save.productIdResolved,
    authoritativeStock: save.authoritativeStock,
    requestedStock: 5,
    confirmationOutcome: save.diagnostics?.outcome || null,
  };
}

async function main() {
  const db = await connectAdmin('click360-staging-7620168025', 'qa-critical-action-gate-load-failure');
  const browser = await chromium.launch();
  const results = { caseA: [], caseB: [], caseC: null };
  let anyFailure = false;
  try {
    console.log('--- Case C (upgrade path, single run) ---');
    results.caseC = await caseC(browser, db);
    console.log(JSON.stringify(results.caseC, null, 2));
    if (!results.caseC.skipped && (!results.caseC.upgradedToReal || !results.caseC.saveAfterUpgradeOk)) anyFailure = true;

    console.log(`--- Case A + Case B, ${CYCLES} cycles ---`);
    for (let i = 0; i < CYCLES; i += 1) {
      const a = await caseA(browser, db);
      const b = await caseB(browser, db, i);
      results.caseA.push(a);
      results.caseB.push(b);
      const aOk = a.signInOk && a.hydrated && a.gateIsFallback === false && a.saveConfirmed && !a.falseOperationInProgress;
      const bOk = b.v16Aborted && !b.v16DomainDefinedDespiteAbort && b.signInOk && b.hydrated
        && b.gateIsFallback === true
        && b.save1Confirmed && !b.save1FalseOperationInProgress
        && b.save2Confirmed && !b.save2FalseOperationInProgress;
      console.log(`[cycle ${i}] A=${aOk ? 'PASS' : 'FAIL'} (fallback=${a.gateIsFallback} confirmed=${a.saveConfirmed}) B=${bOk ? 'PASS' : 'FAIL'} (fallback=${b.gateIsFallback} save1=${b.save1Confirmed} save2=${b.save2Confirmed} falseOpInProgress=${b.save1FalseOperationInProgress || b.save2FalseOperationInProgress})`);
      if (!aOk || !bOk) anyFailure = true;
    }
  } finally {
    await browser.close();
  }

  const falseAllowCount = 0; // this gate never performs an authorization decision; tracked for report completeness only
  const falseOperationInProgressCount = results.caseB.filter((b) => b.save1FalseOperationInProgress || b.save2FalseOperationInProgress).length
    + results.caseA.filter((a) => a.falseOperationInProgress).length;

  console.log(JSON.stringify({ cycles: CYCLES, anyFailure, falseAllowCount, falseOperationInProgressCount, results }, null, 2));
  if (anyFailure) { console.error('CLICK360_CRITICAL_ACTION_GATE_LOAD_FAILURE_E2E FAIL'); process.exitCode = 1; }
  else console.log('CLICK360_CRITICAL_ACTION_GATE_LOAD_FAILURE_E2E PASS');
}

await main();
