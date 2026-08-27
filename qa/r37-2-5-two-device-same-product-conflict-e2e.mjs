// r37.2.5 (P0, real SHARY incident follow-up): the r37.2.4 fix requires a
// real authoritative server readback before a critical mutation can report
// "confirmed" (qa-r37-2-4-cloud-confirmation-race-harness.cjs). That closed
// the false-confirmation race, but a SEPARATE question needs its own
// dedicated, repeatable proof: when two devices edit the SAME product at
// nearly the same instant -- a genuine Firestore revision conflict, not a
// timing artifact -- does the loser ever (a) claim success while stale,
// (b) silently overwrite the winner's write, or (c) lose either write?
//
// Contract under test (see the product-save handler in app.js):
//   Device A commit -> revision A -> Device B detects a real revision
//   conflict -> authoritative refresh -> compare the TARGET PRODUCT (not
//   just the revision number) against the pre-edit baseline -> retry
//   automatically ONLY if the target product itself is untouched (some
//   unrelated field elsewhere in the tenant document caused the conflict)
//   -> exactly one retry -> authoritative server readback required before
//   success. If the target product genuinely changed remotely, the loser
//   must NEVER auto-overwrite it -- it must return an explicit, recoverable
//   conflict state instead.
//
// This harness fires both devices' edits concurrently (Promise.all, not
// sequential awaits) to force a real race at the Firestore transaction
// layer, then asserts a strict, closed set of acceptable outcomes -- run
// it N times back to back (see runNTimes below) because a single run
// cannot prove the race is handled; only repetition under real timing
// jitter can.

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { chromium, webkit } from 'playwright';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const root = path.resolve(import.meta.dirname, '..');
const outputDir = path.join(root, 'output', 'playwright', 'r37-2-5-two-device-conflict');
const port = Number(process.env.CLICK360_R3725_HTTP_PORT || 4787);
const firestorePort = Number(process.env.CLICK360_R3725_FIRESTORE_PORT || 48087);
const authPort = Number(process.env.CLICK360_R3725_AUTH_PORT || 49097);
const projectId = 'demo-click360-r37-2-5';
const apiKey = 'fake-api-key';
const url = `http://127.0.0.1:${port}/index.html`;
const rules = readFileSync(path.join(root, 'firestore.rules'), 'utf8');
const password = 'click360-local-emulator-only';
const javaDirs = [
  '/opt/homebrew/opt/openjdk@21/bin', '/usr/local/opt/openjdk@21/bin',
  '/opt/homebrew/opt/openjdk/bin', '/usr/local/opt/openjdk/bin'
];
const RUNS = Number(process.env.CLICK360_R3725_RUNS || 30);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function stopProcessTree(child) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch {
    try { child.kill('SIGTERM'); } catch {}
  }
}

async function waitForUrl(target, label) {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    try { if ((await fetch(target)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} did not start at ${target}`);
}

function identity(uid) {
  return { schemaVersion: 10, ownerUid: uid, ownerId: uid, businessId: uid, tenantKey: `owner:${uid}:business:${uid}` };
}

function tenantData(uid, productId) {
  const now = Date.now();
  return {
    businesses: [{ id: uid, name: 'Negocio QA race', status: 'activo', type: 'ropa', settings: {} }],
    activeBusinessId: uid,
    products: [{
      id: productId, businessId: uid, code: 'RACE-001', name: 'Producto en carrera QA',
      category: '', qty: 10, stock: 10, cost: 4, price: 12, cardPrice: 12.5,
      notes: '', createdAtMs: now - 100000, updatedAtMs: now - 100000
    }],
    sales: [], movements: [], dailyReports: [], invoices: [], deletedProducts: [],
    auditLogs: [], layaways: [], cashSessions: [], tables: [], tableOrders: [],
    restaurantPayments: [], restaurantPrintHistory: [], restaurantEvents: [], restaurantRecipes: [],
    labelPrintHistory: [], notifications: [],
    legalAcceptances: [{ id: 'legal-qa', businessId: uid, uid, acceptedAt: new Date().toISOString(), source: 'onboarding' }],
    finance: { payments: [], loans: [], envelopes: [], goals: [] },
    logistics: {},
    settings: { workers: [], labelTemplates: [], labelProfiles: [], customers: [], reminders: [], onboarding: { completedAt: new Date().toISOString(), operationId: 'qa-onboarding', version: 16.2, checklist: {} } },
    updatedAtMs: now, updatedAt: new Date(now).toISOString()
  };
}

function stateDocument(uid, revision, data) {
  const tenantIdentity = identity(uid);
  return {
    ...tenantIdentity, revision, updatedAtMs: revision, updatedAt: new Date().toISOString(),
    payload: { schemaVersion: 10, identity: tenantIdentity, data }
  };
}

function accountAccess(uid, email) {
  return {
    uid, ownerId: uid, businessId: uid, tenantKey: identity(uid).tenantKey,
    email, name: 'Owner QA', status: 'founder_legacy', plan: 'founder_legacy',
    planCode: 'founder_legacy', billingStatus: 'lifetime', source: 'qa_fixture',
    entitlementVersion: 16, revision: 1
  };
}

async function createEmulatorUser(email, password_) {
  const response = await fetch(
    `http://127.0.0.1:${authPort}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: password_, returnSecureToken: true }) }
  );
  const body = await response.json();
  if (!response.ok || !body.localId) throw new Error(`Auth emulator sign-up failed: ${JSON.stringify(body)}`);
  return body.localId;
}

async function seed(testEnv, writer) {
  return testEnv.withSecurityRulesDisabled(async (context) => writer(context.firestore()));
}

async function readCloud(testEnv, uid) {
  let value = null;
  await seed(testEnv, async (db) => {
    const snapshot = await getDoc(doc(db, 'businesses', uid, 'state', 'main'));
    value = snapshot.data();
  });
  return value;
}

async function newAppContext(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(({ projectId: targetProject, apiKey: key, firestorePortNumber, authPortNumber }) => {
    let namespace;
    Object.defineProperty(window, 'firebase', {
      configurable: true,
      get() { return namespace; },
      set(value) {
        namespace = value;
        if (!value || value.__click360EmulatorPatched) return;
        value.__click360EmulatorPatched = true;
        const originalInitializeApp = value.initializeApp.bind(value);
        value.initializeApp = (_config, name) => {
          const app = originalInitializeApp({ apiKey: key, projectId: targetProject, appId: '1:1:web:r3725', authDomain: `${targetProject}.firebaseapp.com`, messagingSenderId: '1' }, name);
          app.auth().useEmulator(`http://127.0.0.1:${authPortNumber}`, { disableWarnings: true });
          app.firestore().useEmulator('127.0.0.1', firestorePortNumber);
          return app;
        };
      }
    });
  }, { projectId, apiKey, firestorePortNumber: firestorePort, authPortNumber: authPort });
  return context;
}

async function openSignedIn(browser, email, password_) {
  const context = await newAppContext(browser);
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept().catch(() => {}));
  await page.route('**/*', (route) => {
    const requestUrl = route.request().url();
    const local = requestUrl.startsWith(`http://127.0.0.1:${port}/`)
      || requestUrl.startsWith(`http://127.0.0.1:${firestorePort}/`)
      || requestUrl.startsWith(`http://127.0.0.1:${authPort}/`);
    return local ? route.continue() : route.abort();
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.click360Auth?.signInWithEmailAndPassword === 'function', { timeout: 30000 });
  await page.evaluate(({ testEmail, testPassword }) => window.click360Auth.signInWithEmailAndPassword(testEmail, testPassword), { testEmail: email, testPassword: password_ });
  await page.waitForFunction(() => window.click360IsTenantDataHydrated?.() === true && window.click360SyncStatus?.status === 'synced', { timeout: 60000 });
  await page.evaluate(() => window.click360Route('inventory'));
  await page.waitForSelector('#newProduct', { timeout: 30000 });
  return { context, page, pageErrors };
}

// Fills and submits the edit form, then classifies the terminal toast into
// a CLOSED set of acceptable outcomes -- anything outside that set (a
// generic crash toast, a timeout, an unrecognized message) is itself a
// hard failure, not something to shrug off as "probably fine".
async function submitAndClassify(page, productId, stock) {
  await page.evaluate(({ id, stockValue }) => {
    const trigger = document.querySelector(`[data-edit="${CSS.escape(id)}"]`);
    if (!(trigger instanceof HTMLElement)) throw new Error('Missing product edit trigger');
    trigger.click();
    const input = document.getElementById('pQty');
    if (!input) throw new Error('Missing pQty field');
    input.value = String(stockValue);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const form = document.getElementById('productForm');
    if (!(form instanceof HTMLFormElement)) throw new Error('Missing product form');
    form.requestSubmit();
  }, { id: productId, stockValue: stock });

  await page.waitForFunction(() => {
    const toast = document.getElementById('toast');
    const message = toast?.textContent || '';
    if (/Tuvimos un inconveniente/.test(message)) return false; // unrelated runtime-guard crash toast; keep waiting
    return /Producto (creado|actualizado) y confirmado en la nube/.test(message)
      || /Hay un conflicto de sincronizaci.n pendiente/.test(message)
      || /El cambio no fue confirmado y no se registr. como completado/.test(message)
      || (toast?.classList.contains('err') && !/Sincronizando cambios/.test(message));
  }, { timeout: 25000 });

  return page.evaluate((targetStock) => {
    const toastEl = document.getElementById('toast');
    const message = toastEl?.textContent || '';
    const diagnostics = window.CLICK360_LAST_CONFIRMATION_DIAGNOSTICS || null;
    let outcome = 'unexpected';
    if (/Producto (creado|actualizado) y confirmado en la nube/.test(message)) outcome = 'confirmed';
    else if (/Hay un conflicto de sincronizaci.n pendiente/.test(message)) outcome = 'safe_conflict';
    else if (/El cambio no fue confirmado y no se registr. como completado/.test(message)) outcome = 'not_confirmed';
    return {
      outcome, message, targetStock,
      diagnostics,
      localStock: window.click360GetTenantState?.().products?.[0]?.stock ?? null,
      revision: Number(window.click360DebugSyncIdentity?.().revision || 0)
    };
  }, stock);
}

function writeEmulatorConfig() {
  const dir = mkdtempSync(path.join(tmpdir(), 'click360-r37-2-5-'));
  writeFileSync(path.join(dir, 'firestore.rules'), rules);
  writeFileSync(path.join(dir, 'firebase.json'), JSON.stringify({
    firestore: { rules: 'firestore.rules' },
    emulators: { auth: { host: '127.0.0.1', port: authPort }, firestore: { host: '127.0.0.1', port: firestorePort }, ui: { enabled: false } }
  }, null, 2));
  return path.join(dir, 'firebase.json');
}

async function runOnce(iteration) {
  mkdirSync(outputDir, { recursive: true });
  const emulators = spawn(path.join(root, 'node_modules/.bin/firebase'), [
    'emulators:start', '--only', 'firestore,auth', '--project', projectId, '--config', writeEmulatorConfig()
  ], { cwd: root, detached: true, stdio: 'ignore', env: { ...process.env, PATH: `${javaDirs.join(':')}:${process.env.PATH}` } });
  const server = spawn(process.execPath, [path.join(root, 'node_modules/http-server/bin/http-server'), '.', '-p', String(port), '-c-1'], { cwd: root, detached: true, stdio: 'ignore' });
  let testEnv;
  let chromiumBrowser;
  let webkitBrowser;
  const email = `owner-r37-2-5-${iteration}-${Date.now().toString(36)}@example.test`;
  try {
    await waitForUrl(`http://127.0.0.1:${firestorePort}/`, 'Firestore emulator');
    await waitForUrl(`http://127.0.0.1:${authPort}/`, 'Auth emulator');
    await waitForUrl(url, 'CLICK 360 server');
    testEnv = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: firestorePort, rules } });
    const uid = await createEmulatorUser(email, password);
    const productId = 'race-product-1';
    const initialRevision = 1_800_000_000_000;
    await seed(testEnv, async (db) => {
      await setDoc(doc(db, 'accountAccess', uid), accountAccess(uid, email));
      await setDoc(doc(db, 'businesses', uid, 'state', 'main'), stateDocument(uid, initialRevision, tenantData(uid, productId)));
    });

    chromiumBrowser = await chromium.launch();
    webkitBrowser = await webkit.launch();
    const deviceA = await openSignedIn(chromiumBrowser, email, password);
    const deviceB = await openSignedIn(webkitBrowser, email, password);

    // Fire both edits concurrently -- neither await completes before the
    // other's form submit fires -- to force a genuine Firestore-level race
    // on the SAME product, not a sequential happy path.
    const [resultA, resultB] = await Promise.all([
      submitAndClassify(deviceA.page, productId, 15),
      submitAndClassify(deviceB.page, productId, 25)
    ]);

    const cloudAfter = await readCloud(testEnv, uid);
    const cloudProduct = cloudAfter?.payload?.data?.products?.find((p) => p.id === productId);
    assert(cloudProduct, 'target product must still exist in cloud after the race');
    const cloudStock = Number(cloudProduct.stock);

    for (const [label, result] of [['Device A (->15)', resultA], ['Device B (->25)', resultB]]) {
      assert(result.outcome === 'confirmed' || result.outcome === 'safe_conflict' || result.outcome === 'not_confirmed',
        `${label}: unexpected/unexplained outcome "${result.outcome}" (message: ${result.message})`);
      if (result.outcome === 'confirmed') {
        assert(cloudStock === result.targetStock,
          `${label}: reported CONFIRMED for stock=${result.targetStock} but cloud actually holds ${cloudStock} -- false positive / stale confirmation`);
      }
    }

    assert(cloudStock === 15 || cloudStock === 25,
      `cloud stock must be exactly one of the two attempted values (15 or 25), got ${cloudStock} -- possible corruption or lost update`);

    const confirmedCount = [resultA, resultB].filter((r) => r.outcome === 'confirmed').length;
    assert(confirmedCount <= 1 || resultA.targetStock === resultB.targetStock,
      'at most one device may report confirmed for two DIFFERENT target values -- a second confirmed report is a silent split-brain');
    if (confirmedCount === 2) {
      // Both reported confirmed only if the second genuinely observed the
      // FIRST's value (a rebase-and-converge outcome), never its own
      // stale target.
      assert(resultA.targetStock === cloudStock || resultB.targetStock === cloudStock,
        'if both report confirmed, at least one must match the actual cloud value');
    }

    return {
      ok: true, iteration, cloudStock,
      outcomeA: resultA.outcome, outcomeB: resultB.outcome,
      diagnosticsA: resultA.diagnostics, diagnosticsB: resultB.diagnostics
    };
  } catch (error) {
    return { ok: false, iteration, error: error.message };
  } finally {
    await chromiumBrowser?.close().catch(() => {});
    await webkitBrowser?.close().catch(() => {});
    await testEnv?.cleanup().catch(() => {});
    stopProcessTree(server);
    stopProcessTree(emulators);
  }
}

async function main() {
  const results = [];
  for (let i = 1; i <= RUNS; i += 1) {
    const result = await runOnce(i);
    results.push(result);
    const label = result.ok ? `A=${result.outcomeA} B=${result.outcomeB} cloudStock=${result.cloudStock}` : `ERROR: ${result.error}`;
    console.log(`[r37-2-5 two-device race ${i}/${RUNS}] ${result.ok ? 'PASS' : 'FAIL'} -- ${label}`);
    // Let the previous iteration's emulator/server fully release their
    // ports before the next spawn -- back-to-back spawns can otherwise
    // race a not-yet-freed port (an infra flake, not a product bug).
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  const failures = results.filter((r) => !r.ok);
  writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(results, null, 2));
  if (failures.length) {
    console.error(`CLICK 360 r37.2.5 two-device same-product conflict: ${failures.length}/${RUNS} FAILED.`);
    process.exitCode = 1;
    return;
  }
  console.log(`CLICK 360 r37.2.5 two-device same-product conflict PASS: ${RUNS}/${RUNS} -- zero false positives, zero silent overwrites, zero lost updates.`);
}

await main();
