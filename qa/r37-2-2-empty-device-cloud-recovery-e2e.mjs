import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocFromServer } from 'firebase/firestore';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

/**
 * r37.2.2 (P0, LIVE CLIENT -- the real SHARY incident): a customer whose
 * device held an empty/stale local cache flagged `pendingRemoteSync` could
 * NEVER recover her full cloud data. Every tap of "Reintentar desde nube"
 * looped forever instead of converging: pullRemoteOnce() resolved the
 * `pendingLocalRecovery` + 'conflict' branch BEFORE it ever consulted
 * `force`, so an explicit, user-initiated force refresh re-armed the exact
 * conflict marker click360ClearLocalRecoveryState() had just cleared and
 * returned false. The device stayed empty while the cloud stayed full.
 *
 * This test drives the REAL fixed code (index.html -> firebase-service.js ->
 * app.js, served untouched from a local http-server) in a REAL Chromium
 * against the REAL Firebase emulators (Firestore + Auth), through the REAL
 * boot path: real email/password sign-in -> real onAuthStateChanged ->
 * real resolveAccountAccess() against a real `accountAccess` document ->
 * real applyAccountAccessIdentity() -> real enterApprovedApp() ->
 * real pullRemoteOnce() against a real `businesses/{uid}/state/main`
 * document, all under the REAL firestore.rules. Nothing in the sync path
 * is mocked or reimplemented.
 *
 * The only test-side seam is a Playwright addInitScript that wraps
 * firebase.initializeApp() to point the compat SDK at the local emulators
 * instead of the real `click-360` project (constraint: this test must never
 * touch a real Firebase project). No product file is modified.
 *
 * The seeded tenant is deliberately the real customer's tier:
 * status/plan `founder_legacy` -- the permanent historical commercial
 * license (SHARY, Lia) that both v16-domain.js evaluateEntitlement() and
 * firestore.rules activeAccountOwnerUser() recognise.
 *
 * Scenarios:
 *  A. Core convergence -- empty local device + pendingRemoteSync marker +
 *     fresher full cloud => the conflict is real and blocking; "Actualizar
 *     desde nube" (the real UI button, and the real
 *     click360ResolveSyncConflict('refresh_cloud') API behind it) converges
 *     to a fully hydrated device, with NO page reload and no bounce back to
 *     the public access gate.
 *  B. Idempotent retry -- the same stuck device, 10 concurrent retries
 *     fired at once, must still converge cleanly with no crash, no error,
 *     and no duplicated data.
 *  C. Print acceptance (the actual business requirement) -- once hydrated,
 *     print 2 labels for 2 different products through the REAL canonical
 *     print path (click360PrepareLabelPrintJob ->
 *     click360ExecuteCanonicalLabelPrint) with no further sync.
 *  D. Reconnect -- a refresh whose cloud fetch is cut mid-flight fails
 *     safely, and the next retry after reconnecting converges the same way.
 */

const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_EMPTY_DEVICE_RECOVERY_PORT || 4762);
const firestorePort = Number(process.env.CLICK360_EMPTY_DEVICE_FIRESTORE_PORT || 8080);
const authPort = Number(process.env.CLICK360_EMPTY_DEVICE_AUTH_PORT || 9099);
const PROJECT_ID = 'demo-click360-r37-2-2';
const API_KEY = 'fake-api-key';
const url = `http://127.0.0.1:${port}/index.html`;
const RULES = readFileSync(path.join(root, 'firestore.rules'), 'utf8');
// Unique per run: the emulator may already be running (and holding users)
// from a previous run or from `npm run qa:rules`.
const RUN_ID = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const PASSWORD = 'click360-qa-pass';
const JAVA_DIRS = [
  '/opt/homebrew/opt/openjdk@21/bin', '/usr/local/opt/openjdk@21/bin',
  '/opt/homebrew/opt/openjdk/bin', '/usr/local/opt/openjdk/bin'
];

function assert(condition, message) { if (!condition) throw new Error(message); }

async function waitForUrl(target, label, transform = (r) => r.ok) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    try { if (transform(await fetch(target))) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} did not start (${target}).`);
}

// ── Fixture: what "cloud full" really looks like for this customer ──────────
function tenantIdentity(uid) {
  return { schemaVersion: 10, ownerUid: uid, ownerId: uid, businessId: uid, tenantKey: `owner:${uid}:business:${uid}` };
}

// A real saved label template, mirroring the flat shape app.js's
// universalPaperFromTemplate()/universalDocumentFromTemplate() actually read
// back from settings.labelTemplates (the same 2-column 40x60mm roll geometry
// as the real SHARY print fixture).
function labelTemplate(businessId) {
  return {
    id: 'tpl_shary_roll',
    businessId,
    name: 'Etiqueta rollo 2 columnas',
    isDefault: true,
    paperType: 'custom',
    mediaType: 'roll-2',
    widthMm: 40,
    heightMm: 60,
    mediaWidthMm: 82,
    columns: 2,
    rows: 1,
    gapXmm: 2,
    gapYmm: 2,
    marginTopMm: 0,
    marginRightMm: 0,
    marginBottomMm: 0,
    marginLeftMm: 0,
    dpi: 203,
    orientation: 'portrait',
    contentRotation: 0,
    shape: 'rounded',
    priceFormat: 'full',
    bgColor: '#ffffff',
    fgColor: '#000000',
    qrMargin: 5,
    quantity: 1,
    startSlot: 1,
    renderer: 'universal-label-canvas',
    layout: { showName: true, showPrice: true, showCode: true, showQr: true }
  };
}

function labelProfile(businessId) {
  return {
    id: 'prof_shary_roll',
    businessId,
    name: 'Rollo 82mm (2 col)',
    universalPaper: {
      id: 'custom', mediaType: 'roll-2', widthMm: 40, heightMm: 60, mediaWidthMm: 82, mediaHeightMm: 0,
      columns: 2, rows: 1, gapXmm: 2, gapYmm: 2,
      marginTopMm: 0, marginRightMm: 0, marginBottomMm: 0, marginLeftMm: 0,
      pitchMm: 0, xOffsetMm: 0, yOffsetMm: 0, scaleX: 1, scaleY: 1, dpi: 203, orientation: 'portrait'
    }
  };
}

function emptyDeviceData(businessId, nowIso) {
  return {
    businesses: [{ id: businessId, name: 'Comercial SHARY', status: 'activo', type: 'retail', settings: {} }],
    activeBusinessId: businessId,
    products: [], sales: [], movements: [], invoices: [], dailyReports: [], deletedProducts: [],
    auditLogs: [], layaways: [], cashSessions: [], tables: [], tableOrders: [],
    restaurantPayments: [], restaurantPrintHistory: [], restaurantEvents: [], restaurantRecipes: [],
    labelPrintHistory: [], notifications: [],
    legalAcceptances: [{ id: 'legal1', businessId, uid: businessId, acceptedAt: nowIso, source: 'onboarding', termsVersion: '2026-07-14', privacyVersion: '2026-07-14' }],
    finance: { payments: [], loans: [], envelopes: [], goals: [] },
    logistics: {},
    settings: {
      workers: [], labelTemplates: [], labelProfiles: [], customers: [], reminders: [],
      onboarding: { completedAt: nowIso, operationId: 'onboarding-1', version: 16.2, checklist: {} }
    },
    updatedAtMs: Date.now(),
    updatedAt: nowIso
  };
}

const CLOUD_PRODUCT_COUNT = 436;

function fullCloudData(businessId, nowIso) {
  const base = emptyDeviceData(businessId, nowIso);
  const products = [];
  for (let index = 1; index <= CLOUD_PRODUCT_COUNT; index += 1) {
    products.push({
      id: `p_${index}`,
      businessId,
      code: `SHARY-${String(index).padStart(3, '0')}`,
      name: `Producto Nube ${index}`,
      cat: index % 2 ? 'Ropa' : 'Accesorios',
      qty: 5 + index,
      stock: 5 + index,
      cost: 3 + index,
      price: 10 + index,
      cardPrice: 10.5 + index,
      createdAt: nowIso
    });
  }
  const sales = [1, 2, 3].map((index) => ({
    id: `s_${index}`, businessId, method: 'Efectivo', total: 20 + index, received: 20 + index, balance: 0,
    items: [{ code: `SHARY-00${index}`, name: `Producto Nube ${index}`, qty: 1, price: 10 + index }],
    payments: [{ amount: 20 + index, method: 'Efectivo', at: nowIso }], date: nowIso, createdAt: nowIso
  }));
  const movements = [1, 2].map((index) => ({
    id: `m_${index}`, businessId, type: 'ajuste', code: `SHARY-00${index}`, qty: index, at: nowIso, reason: 'inventario inicial'
  }));
  const cashSessions = [{
    id: 'cash_1', businessId, status: 'closed', openedAt: nowIso, closedAt: nowIso,
    apertureAmount: 50, closingAmount: 113, expected: 113
  }];
  return {
    ...base,
    products, sales, movements, cashSessions,
    settings: { ...base.settings, labelTemplates: [labelTemplate(businessId)], labelProfiles: [labelProfile(businessId)] }
  };
}

function stateDocument(uid, revision, data) {
  const identity = tenantIdentity(uid);
  return {
    schemaVersion: 10,
    ownerUid: uid,
    ownerId: uid,
    businessId: uid,
    tenantKey: identity.tenantKey,
    revision,
    updatedAt: new Date().toISOString(),
    updatedAtMs: Date.now(),
    payload: { schemaVersion: 10, identity, data }
  };
}

function accountAccessDocument(uid, email) {
  // The real permanent historical commercial tier (SHARY/Lia): allowed,
  // never read-only, no billing, and no fresh-clock requirement.
  return {
    uid,
    ownerId: uid,
    businessId: uid,
    tenantKey: `owner:${uid}:business:${uid}`,
    email,
    name: 'SHARY',
    photoURL: '',
    status: 'founder_legacy',
    plan: 'founder_legacy',
    planCode: 'founder_legacy',
    billingStatus: 'none',
    source: 'founder_legacy_grant',
    entitlementVersion: 16,
    revision: 1,
    lastSeenAt: new Date(),
    createdAt: new Date()
  };
}

// ── Emulator plumbing ──────────────────────────────────────────────────────
async function createEmulatorUser(email, password) {
  const response = await fetch(
    `http://127.0.0.1:${authPort}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) }
  );
  const body = await response.json();
  if (!response.ok || !body.localId) throw new Error(`Auth emulator sign-up failed: ${JSON.stringify(body)}`);
  return body.localId;
}

async function seed(testEnv, writer) {
  return testEnv.withSecurityRulesDisabled(async (context) => writer(context.firestore()));
}

// ── Browser plumbing ───────────────────────────────────────────────────────
async function newAppContext(browser) {
  const context = await browser.newContext();
  // Point the REAL compat SDK at the local emulators. This wraps
  // firebase.initializeApp (defined by vendor/firebase-app-compat.js, called
  // by firebase-service.js line 7) at the only moment auth+firestore compat
  // are registered but nothing has been used yet -- no product file changes,
  // and the entire real sync path below it runs untouched.
  await context.addInitScript(({ projectId, apiKey, firestoreHost, firestorePortNumber, authUrl }) => {
    try {
      const previous = Number(sessionStorage.getItem('__click360TestNavCount') || '0');
      sessionStorage.setItem('__click360TestNavCount', String(previous + 1));
    } catch {}
    let namespace;
    Object.defineProperty(window, 'firebase', {
      configurable: true,
      get() { return namespace; },
      set(value) {
        namespace = value;
        if (!value || value.__click360EmulatorPatched) return;
        value.__click360EmulatorPatched = true;
        const originalInitializeApp = value.initializeApp.bind(value);
        value.initializeApp = (config, name) => {
          const app = originalInitializeApp({
            apiKey, projectId, appId: '1:1:web:click360test',
            authDomain: `${projectId}.firebaseapp.com`, messagingSenderId: '1'
          }, name);
          try { app.auth().useEmulator(authUrl, { disableWarnings: true }); }
          catch (error) { window.__click360EmulatorWiringError = `auth: ${error.message}`; }
          try { app.firestore().useEmulator(firestoreHost, firestorePortNumber); }
          catch (error) { window.__click360EmulatorWiringError = `firestore: ${error.message}`; }
          return app;
        };
      }
    });
  }, { projectId: PROJECT_ID, apiKey: API_KEY, firestoreHost: '127.0.0.1', firestorePortNumber: firestorePort, authUrl: `http://127.0.0.1:${authPort}` });
  return context;
}

async function openApp(context, { email, password }) {
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept().catch(() => {}));
  page.on('download', (download) => download.delete().catch(() => {}));
  await page.route('**/*', (route) => {
    const requestUrl = route.request().url();
    const local = requestUrl.startsWith(`http://127.0.0.1:${port}/`)
      || requestUrl.startsWith(`http://127.0.0.1:${firestorePort}/`)
      || requestUrl.startsWith(`http://127.0.0.1:${authPort}/`);
    return local ? route.continue() : route.abort();
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.click360Auth?.signInWithEmailAndPassword === 'function', { timeout: 30000 });
  const wiringError = await page.evaluate(() => window.__click360EmulatorWiringError || '');
  assert(!wiringError, `the compat SDK must have been pointed at the local emulators, got: ${wiringError}`);
  await page.evaluate(({ email: mail, password: pass }) => window.click360Auth.signInWithEmailAndPassword(mail, pass), { email, password });
  return { page, pageErrors };
}

const TERMINAL_SYNC_STATES = ['synced', 'error', 'offline', 'pending', 'online_only_safe', 'read_only', 'blocked_identity', 'migration_required'];

async function waitForBoot(page) {
  await page.waitForFunction(
    (states) => states.includes(window.click360SyncStatus?.status),
    TERMINAL_SYNC_STATES,
    { timeout: 60000 }
  );
}

function readSnapshot(page) {
  return page.evaluate(() => ({
    syncStatus: window.click360SyncStatus?.status || null,
    syncMessage: window.click360SyncStatus?.message || '',
    hydrated: window.click360IsTenantDataHydrated?.() === true,
    products: window.click360GetTenantState?.()?.products?.length ?? null,
    sales: window.click360GetTenantState?.()?.sales?.length ?? null,
    movements: window.click360GetTenantState?.()?.movements?.length ?? null,
    labelTemplates: window.click360GetTenantState?.()?.settings?.labelTemplates?.length ?? null,
    conflictBlocking: window.click360GetSyncState?.({ reason: 'qa_probe' })?.blocking ?? null,
    localStats: window.click360GetLocalBusinessSyncStats?.() || null,
    cacheStatus: (() => {
      const status = window.click360TenantContext ? window.click360GetTenantCacheStatus?.(window.click360TenantContext) : null;
      if (!status) return null;
      const { payloadHash, materialHash, ...rest } = status;
      return rest;
    })(),
    navCount: Number(sessionStorage.getItem('__click360TestNavCount') || '0'),
    gateVisible: !!document.querySelector('#click360-auth-gate'),
    gateText: document.querySelector('#click360-auth-gate')?.textContent?.trim().slice(0, 120) || ''
  }));
}

/**
 * Brings a browser context to the EXACT reported broken state:
 * a device holding a valid but EMPTY local cache, flagged
 * pendingRemoteSync with a stale baseRevision, while the cloud has moved
 * on to a fresher, full revision.
 */
async function stageStuckEmptyDevice({ browser, testEnv, uid, email, password }) {
  const nowIso = new Date().toISOString();
  const REVISION_EMPTY = 1_700_000_000_001;
  const REVISION_FULL = 1_700_000_000_002;

  await seed(testEnv, async (db) => {
    await setDoc(doc(db, 'accountAccess', uid), accountAccessDocument(uid, email));
    await setDoc(doc(db, 'businesses', uid, 'state', 'main'), stateDocument(uid, REVISION_EMPTY, emptyDeviceData(uid, nowIso)));
  });

  const context = await newAppContext(browser);
  const firstSession = await openApp(context, { email, password });
  await waitForBoot(firstSession.page);

  const firstBoot = await readSnapshot(firstSession.page);
  assert(firstBoot.syncStatus === 'synced', `sanity: the first boot must reach a clean synced state, got "${firstBoot.syncStatus}" (${firstBoot.syncMessage})`);
  assert(firstBoot.products === 0, `sanity: this device must start genuinely EMPTY (0 products), got ${firstBoot.products}`);

  // Let the first boot's own async cache bookkeeping (queueIndexedSnapshot /
  // click360MarkTenantCacheSynced) settle.
  await firstSession.page.waitForTimeout(2000);
  const emptySnapshotJson = await firstSession.page.evaluate(() => {
    const context = window.click360TenantContext;
    return localStorage.getItem(`CLICK360:V16:STATE:${context.authUid}:${context.tenantKey}`);
  });
  assert(typeof emptySnapshotJson === 'string' && emptySnapshotJson.length > 0, 'sanity: the app must have written a real local snapshot for this tenant');

  // The cloud moves on to the customer's real, full data (written from her
  // other device / restored by support). This device is open, so it applies
  // it normally -- which is what leaves the LAST_APPLIED_REMOTE_* markers on
  // this device pointing at that exact remote payload.
  const fullDocument = stateDocument(uid, REVISION_FULL, fullCloudData(uid, nowIso));
  await seed(testEnv, async (db) => {
    await setDoc(doc(db, 'businesses', uid, 'state', 'main'), fullDocument);
  });
  await firstSession.page.waitForFunction(
    (expected) => window.click360GetTenantState?.()?.products?.length === expected,
    CLOUD_PRODUCT_COUNT,
    { timeout: 30000 }
  );
  await firstSession.page.waitForTimeout(1500);

  // ── The reported failure state, staged exactly ──
  // The device's local snapshot goes back to EMPTY while its
  // LAST_APPLIED_REMOTE_* markers still say "I already applied that remote
  // payload" -- i.e. the local persist silently lost the real data (quota,
  // storage eviction, a wiped profile), the exact shape the r37.2.2 fix set
  // #2 addresses. On top of it, the cache carries a stale pendingRemoteSync
  // at the older baseRevision, the way an unsynced offline write leaves it
  // (app.js save() writes this same localStorage cache-meta record).
  //
  // This combination is what made the customer's device UNRECOVERABLE: the
  // realtime listener skips it (remoteMaterialHash === lastAppliedMaterial),
  // the background pull refuses it (pendingLocalRecovery -> 'conflict'), so
  // an explicit forced refresh is the ONLY escape -- and that is precisely
  // what used to be swallowed before `force` was ever consulted.
  const staged = await firstSession.page.evaluate(({ snapshot, baseRevision }) => {
    const context = window.click360TenantContext;
    localStorage.setItem(`CLICK360:V16:STATE:${context.authUid}:${context.tenantKey}`, snapshot);
    const metaKey = `CLICK360:V16:CACHEMETA:${context.authUid}:${context.tenantKey}`;
    const meta = JSON.parse(localStorage.getItem(metaKey) || '{}');
    localStorage.setItem(metaKey, JSON.stringify({
      ...meta,
      tenantKey: context.tenantKey,
      source: 'localstorage',
      pendingRemoteSync: true,
      baseRevision,
      operationId: 'offline_write_never_pushed',
      pendingCreatedAtMs: Date.now()
    }));
    return window.click360GetTenantCacheStatus(context);
  }, { snapshot: emptySnapshotJson, baseRevision: REVISION_EMPTY });
  assert(staged.valid === true && staged.pendingRemoteSync === true && Number(staged.baseRevision) === REVISION_EMPTY,
    `sanity: the staged local cache must be valid AND flagged pendingRemoteSync at the stale baseRevision, got ${JSON.stringify(staged)}`);

  // She closes and reopens the app. Re-assert the cloud document byte for
  // byte first: a closing tab can flush a local push, and the whole point is
  // that the cloud still holds her real data, untouched.
  await firstSession.page.close();
  await seed(testEnv, async (db) => {
    await setDoc(doc(db, 'businesses', uid, 'state', 'main'), fullDocument);
  });

  // She reopens the app on the same (unchanged) device.
  const { page, pageErrors } = await openApp(context, { email, password });
  await waitForBoot(page);

  const stuck = await readSnapshot(page);
  if (process.env.CLICK360_QA_DEBUG === '1') console.log('[debug] staged stuck state:', JSON.stringify(stuck, null, 2));
  assert(stuck.syncStatus === 'error', `the staged device must genuinely be in the reported blocked state ('error'), got "${stuck.syncStatus}" (${stuck.syncMessage}); cache status after reload: ${JSON.stringify(stuck.cacheStatus)}`);
  assert(stuck.products === 0, `the staged device must still show ZERO products while the cloud holds ${CLOUD_PRODUCT_COUNT} -- this is exactly what the customer saw; got ${stuck.products}`);
  assert(stuck.conflictBlocking === true, 'the staged device must carry a real blocking sync-conflict marker (pendingLocalRecovery + conflict)');

  // app.js localBusinessSyncStats(): `meaningful` is a RAW-COUNT read on
  // purpose -- it is also what click360ResolveSyncConflict('keep_local')
  // checks to refuse ever pushing an empty local device over real cloud
  // data, so it must stay false here (a genuinely empty local cache, even a
  // validated/just-loaded one). The "don't loop this device back into the
  // empty-device modal" protection lives one level up, at the UI call site
  // (showSyncConflictRecovery), gated separately on tenantDataHydrated --
  // confirmed below by the recovery path actually taken and by the final
  // converged assertions, not by widening this shared, safety-critical flag.
  assert(stuck.localStats?.products === 0 && stuck.localStats?.meaningful === false,
    `the staged device's raw local counts must read zero/not-meaningful while genuinely stuck, got ${JSON.stringify(stuck.localStats)}`);

  // And it must STAY stuck: nothing in the app (the realtime listener, a
  // background pull, a re-render) recovers this device on its own. That is
  // what makes the explicit forced refresh the customer's only escape, and
  // therefore what makes this a real test of the fix rather than of an
  // unrelated self-heal.
  await page.waitForTimeout(5000);
  const stillStuck = await readSnapshot(page);
  assert(stillStuck.products === 0 && stillStuck.conflictBlocking === true,
    `the staged device must stay stuck until the customer explicitly refreshes from the cloud -- after 5s it shows ${stillStuck.products} products / blocking=${stillStuck.conflictBlocking} (if this passes on its own, the scenario no longer proves the fix)`);

  return { context, page, pageErrors, stuck, REVISION_FULL };
}

async function assertConverged(page, label, navCountBefore) {
  // Convergence includes the app's own async cache bookkeeping
  // (queueIndexedSnapshot -> indexedTenantCacheMeta), so give the settled
  // state a bounded window to appear rather than sampling one instant.
  let after = await readSnapshot(page);
  for (let attempt = 0; attempt < 30 && !(after.hydrated && after.syncStatus === 'synced' && after.conflictBlocking === false); attempt += 1) {
    await page.waitForTimeout(500);
    after = await readSnapshot(page);
  }
  assert(after.hydrated === true, `[${label}] the device must end genuinely hydrated (tenantDataHydrated === true), got ${after.hydrated} with sync status "${after.syncStatus}"`);
  assert(after.products === CLOUD_PRODUCT_COUNT, `[${label}] the device must now hold the full cloud catalog (${CLOUD_PRODUCT_COUNT} products), got ${after.products}`);
  assert(after.sales === 3, `[${label}] the 3 cloud sales must be present, got ${after.sales}`);
  assert(after.movements === 2, `[${label}] the 2 cloud movements must be present, got ${after.movements}`);
  assert(after.labelTemplates === 1, `[${label}] the real saved label template must have arrived with the cloud snapshot, got ${after.labelTemplates}`);
  assert(after.syncStatus === 'synced', `[${label}] sync status must settle on "synced", got "${after.syncStatus}" (${after.syncMessage})`);
  assert(after.conflictBlocking === false, `[${label}] the conflict marker must be genuinely cleared, not re-armed -- getSyncState().blocking is still ${after.conflictBlocking} after 15s; cache status: ${JSON.stringify(after.cacheStatus)}`);
  assert(after.navCount === navCountBefore, `[${label}] recovering from the cloud must NEVER reload the page mid-sync (the service-worker auto-heal race) -- boot count went ${navCountBefore} -> ${after.navCount}`);
  assert(after.gateVisible === false, `[${label}] the app must not bounce back to the public access gate ("${after.gateText}")`);
  return after;
}

// ── Scenario A + C ─────────────────────────────────────────────────────────
async function scenarioCoreConvergenceAndPrint(browser, testEnv) {
  const email = `shary-recovery-${RUN_ID}@example.test`;
  const uid = await createEmulatorUser(email, PASSWORD);
  const staged = await stageStuckEmptyDevice({ browser, testEnv, uid, email, password: PASSWORD });
  const { page, pageErrors, stuck } = staged;
  try {
    // The REAL customer-facing recovery UI: app.js showSyncConflictRecovery().
    // It has two real shapes, and both end in the same real call --
    // click360ResolveSyncConflict('refresh_cloud') -> pullRemoteOnce({force:true}):
    //  - a device with meaningful local data gets the explicit
    //    "🔄 Actualizar desde nube" button (#syncRefreshCloud);
    //  - a device classified as empty auto-recovers, and only falls back to
    //    the "🔄 Reintentar desde nube" modal (#syncRetryEmptyLocal) when the
    //    refresh did NOT converge -- which is EXACTLY the loop the customer
    //    was trapped in, so that button appearing here is a hard failure.
    let recoveryPath = '';
    for (let attempt = 0; attempt < 3 && !recoveryPath; attempt += 1) {
      await page.evaluate(() => window.click360ShowSyncConflictRecovery({ syncState: window.click360GetSyncState?.({ reason: 'qa_conflict_modal' }) }));
      // The app re-renders on sync-status events, so the freshly opened modal
      // can be replaced under us -- retry rather than fail on a detached node.
      const clicked = await page.locator('#syncRefreshCloud').click({ timeout: 5000 }).then(() => true).catch(() => false);
      if (clicked) { recoveryPath = 'real UI button "🔄 Actualizar desde nube"'; break; }
      const autoRecovered = await page.waitForFunction(() => window.click360SyncStatus?.status === 'synced', { timeout: 5000 }).then(() => true).catch(() => false);
      if (autoRecovered) recoveryPath = 'real empty-device auto-recovery';
    }
    if (!recoveryPath) {
      // Same real entry point the button is wired to, called directly.
      await page.evaluate(() => window.click360ResolveSyncConflict('refresh_cloud'));
      recoveryPath = 'click360ResolveSyncConflict("refresh_cloud")';
    }
    await page.waitForFunction(() => window.click360SyncStatus?.status === 'synced', { timeout: 45000 })
      .catch(() => {});
    const stuckLoopModal = await page.$('#syncRetryEmptyLocal');
    assert(!stuckLoopModal, 'the "🔄 Reintentar desde nube" fallback modal must NEVER appear -- it only renders when the forced cloud refresh failed to converge, which is precisely the infinite loop the customer was trapped in');

    const recovered = await assertConverged(page, `A/${recoveryPath}`, stuck.navCount);
    assert(recovered.localStats?.meaningful === true, `[A] a genuinely hydrated session must never be classified as an "empty device" again, got meaningful=${recovered.localStats?.meaningful}`);

    // ── Scenario C: the actual business requirement -- print labels TODAY,
    // straight off the cloud-recovered data, with no further sync. ──
    const revisionBeforePrint = await page.evaluate(() => window.click360DebugSyncIdentity().revision);
    const printed = await page.evaluate(async () => {
      const state = window.click360GetTenantState();
      const businessId = state.activeBusinessId;
      const [first, second] = state.products.slice(0, 2);
      const results = [];
      for (const product of [first, second]) {
        const prepared = await window.click360PrepareLabelPrintJob({
          product, templateId: 'tpl_shary_roll', quantity: 1, startSlot: 1, businessId
        });
        const executed = await window.click360ExecuteCanonicalLabelPrint(prepared, 'system');
        const cells = executed.plan.pages.flatMap((page) => page.cells || []);
        results.push({
          code: product.code,
          templateName: prepared.template?.name || '',
          paperWidthMm: prepared.document?.paper?.widthMm,
          paperHeightMm: prepared.document?.paper?.heightMm,
          planCount: executed.plan.count,
          filledCells: cells.filter((cell) => cell.status === 'filled').length,
          renderedCells: executed.node.querySelectorAll('canvas, img').length,
          rendersProductName: executed.node.innerHTML.includes(product.name),
          status: executed.result?.status || null
        });
      }
      return results;
    });

    assert(printed.length === 2, `[C] exactly 2 label print jobs must have been produced, got ${printed.length}`);
    const totalFilled = printed.reduce((sum, entry) => sum + entry.filledCells, 0);
    assert(totalFilled === 2, `[C] exactly 2 filled label cells must be produced for the 2 selected products, got ${totalFilled} (${JSON.stringify(printed)})`);
    printed.forEach((entry) => {
      assert(entry.planCount === 1, `[C] each selected product must produce exactly 1 label, got ${entry.planCount} for ${entry.code}`);
      assert(entry.templateName === 'Etiqueta rollo 2 columnas', `[C] the print must use the REAL saved cloud template, got "${entry.templateName}"`);
      assert(entry.paperWidthMm === 40 && entry.paperHeightMm === 60, `[C] the label geometry must come from the recovered cloud template (40x60mm), got ${entry.paperWidthMm}x${entry.paperHeightMm}`);
      assert(entry.renderedCells > 0, `[C] the rendered label node must contain real drawn label content for ${entry.code}`);
      assert(entry.status === 'handed_off', `[C] the canonical print path must hand the job off to the printer, got "${entry.status}" for ${entry.code}`);
    });

    const afterPrint = await page.evaluate(() => ({
      revision: window.click360DebugSyncIdentity().revision,
      status: window.click360SyncStatus?.status,
      hydrated: window.click360IsTenantDataHydrated?.() === true,
      products: window.click360GetTenantState().products.length
    }));
    assert(afterPrint.revision === revisionBeforePrint, `[C] printing must require no additional sync -- revision moved ${revisionBeforePrint} -> ${afterPrint.revision}`);
    assert(afterPrint.status === 'synced' && afterPrint.hydrated === true && afterPrint.products === CLOUD_PRODUCT_COUNT, '[C] the session must stay hydrated and synced across the whole print flow');

    if (pageErrors.length) throw new Error(`[A/C] unexpected page errors: ${JSON.stringify(pageErrors)}`);
    console.log(`CLICK 360 r37.2.2 scenario A+C PASS: an empty device with a stale pendingRemoteSync cache and a fresher full cloud recovered ${CLOUD_PRODUCT_COUNT} products / 3 ventas / 2 movimientos through the ${recoveryPath} -- no page reload, no access-gate bounce -- and printed exactly 2 real labels from the recovered cloud template with no further sync.`);
  } finally {
    await staged.context.close();
  }
}

// ── Scenario B ─────────────────────────────────────────────────────────────
async function scenarioIdempotentRetry(browser, testEnv) {
  const email = `shary-retry-storm-${RUN_ID}@example.test`;
  const uid = await createEmulatorUser(email, PASSWORD);
  const staged = await stageStuckEmptyDevice({ browser, testEnv, uid, email, password: PASSWORD });
  const { page, pageErrors, stuck } = staged;
  try {
    // A real, frustrated customer taps the button repeatedly. Fire 10
    // recoveries at once: the fix adds no request de-duplication, so what
    // must hold is that this still converges cleanly and idempotently.
    const outcomes = await page.evaluate(() => Promise.all(
      [...Array(10)].map(() => window.click360ResolveSyncConflict('refresh_cloud')
        .then((result) => ({ ok: result?.ok === true, refreshed: result?.refreshed === true, error: null }))
        .catch((error) => ({ ok: false, refreshed: false, error: String(error?.message || error) })))
    ));

    const failures = outcomes.filter((outcome) => outcome.error);
    assert(failures.length === 0, `[B] no concurrent retry may throw, got: ${JSON.stringify(failures)}`);
    assert(outcomes.every((outcome) => outcome.ok === true), `[B] every one of the 10 concurrent retries must report success, got ${JSON.stringify(outcomes)}`);
    assert(outcomes.some((outcome) => outcome.refreshed === true), '[B] at least one retry must report a REAL cloud refresh (refreshed:true) -- the pre-fix code could only ever return refreshed:false here, forever');

    await page.waitForFunction(() => window.click360SyncStatus?.status === 'synced', { timeout: 45000 });
    const converged = await assertConverged(page, 'B/10 concurrent retries', stuck.navCount);

    // No duplicated data anywhere after 10 overlapping hydrations.
    const duplicates = await page.evaluate(() => {
      const state = window.click360GetTenantState();
      const ids = (list) => list.map((item) => item.id);
      const dupes = (list) => ids(list).length - new Set(ids(list)).size;
      return {
        products: dupes(state.products), sales: dupes(state.sales), movements: dupes(state.movements),
        businesses: dupes(state.businesses), templates: dupes(state.settings.labelTemplates)
      };
    });
    Object.entries(duplicates).forEach(([key, count]) => {
      assert(count === 0, `[B] 10 overlapping retries must never duplicate data -- found ${count} duplicate ${key}`);
    });
    assert(converged.localStats?.products === CLOUD_PRODUCT_COUNT, `[B] the local business stats must agree with the recovered catalog, got ${converged.localStats?.products}`);

    if (pageErrors.length) throw new Error(`[B] unexpected page errors: ${JSON.stringify(pageErrors)}`);
    console.log('CLICK 360 r37.2.2 scenario B PASS: 10 concurrent "Reintentar desde nube" retries on the same stuck device all resolved successfully, converged once to a fully hydrated tenant, duplicated nothing, threw nothing, and never reloaded the page.');
  } finally {
    await staged.context.close();
  }
}

// ── Scenario D ─────────────────────────────────────────────────────────────
async function scenarioReconnectAfterNetworkCut(browser, testEnv) {
  const email = `shary-network-cut-${RUN_ID}@example.test`;
  const uid = await createEmulatorUser(email, PASSWORD);
  const staged = await stageStuckEmptyDevice({ browser, testEnv, uid, email, password: PASSWORD });
  const { page, pageErrors, context, stuck } = staged;
  try {
    // The customer taps "Actualizar desde nube" on a dead connection: the
    // browser context goes offline AND the Firestore client's own transport
    // is cut (disableNetwork), so the forced server read genuinely cannot
    // complete -- Playwright's context.setOffline alone does not tear down
    // the SDK's already-open loopback stream to the emulator.
    await context.setOffline(true);
    await page.evaluate(() => window.click360Db.disableNetwork());
    const offlineAttempt = await page.evaluate(() => window.click360ResolveSyncConflict('refresh_cloud')
      .then((result) => ({ refreshed: result?.refreshed === true, error: null }))
      .catch((error) => ({ refreshed: false, error: String(error?.message || error) })));

    assert(offlineAttempt.error === null, `[D] a failed cloud refresh must be handled, never thrown at the caller, got: ${offlineAttempt.error}`);
    assert(offlineAttempt.refreshed === false, '[D] a refresh whose cloud fetch never completed must not claim it refreshed');
    const duringCut = await readSnapshot(page);
    assert(duringCut.products === 0, `[D] without a working connection there is nothing to hydrate from -- the device must stay at 0 products, got ${duringCut.products}`);
    assert(duringCut.gateVisible === false, `[D] a failed refresh must not bounce the customer back to the public access gate ("${duringCut.gateText}")`);

    // The connection comes back and she taps again -- this must now converge
    // exactly like scenario A.
    await context.setOffline(false);
    await page.evaluate(() => window.click360Db.enableNetwork());
    await page.evaluate(() => window.click360ResolveSyncConflict('refresh_cloud'));
    await page.waitForFunction(() => window.click360SyncStatus?.status === 'synced', { timeout: 60000 }).catch(() => {});
    await assertConverged(page, 'D/retry after reconnect', stuck.navCount);

    if (pageErrors.length) throw new Error(`[D] unexpected page errors: ${JSON.stringify(pageErrors)}`);
    console.log('CLICK 360 r37.2.2 scenario D PASS: a cloud refresh whose network was cut mid-fetch failed safely (no throw, no data loss, no access-gate bounce, nothing claimed as refreshed), and the very next retry after reconnecting converged to the full cloud tenant.');
  } finally {
    await staged.context.close();
  }
}

// ── Scenario E: the data-loss regression this fix must never reintroduce ───
// Discovered during verification of this very fix: an earlier version widened
// app.js localBusinessSyncStats()'s `meaningful` flag to also be true whenever
// tenantDataHydrated was true, to stop a recovered session looping back into
// the "empty device" modal. But `meaningful` is the SAME flag
// click360ResolveSyncConflict('keep_local') (firebase-service.js) checks to
// refuse ever pushing an empty local device over real cloud data -- widening
// it silently disabled that guard for exactly the device class it protects.
// Reproduced directly: on a validated-but-genuinely-empty local cache (real
// products:0), calling ResolveSyncConflict('keep_local') pushed the empty
// local state and reduced a real 24-product cloud document to 0. The fix
// moved the "don't loop back to the empty-device modal" logic to the UI call
// site instead (gated separately on tenantDataHydrated) and left `meaningful`
// as a pure raw-count read. This scenario locks that in permanently.
async function scenarioKeepLocalNeverOverwritesCloud(browser, testEnv) {
  const email = `shary-keep-local-guard-${RUN_ID}@example.test`;
  const uid = await createEmulatorUser(email, PASSWORD);
  const staged = await stageStuckEmptyDevice({ browser, testEnv, uid, email, password: PASSWORD });
  const { page, pageErrors, context } = staged;
  try {
    const localStats = await page.evaluate(() => window.click360GetLocalBusinessSyncStats?.());
    assert(localStats?.meaningful === false,
      `[E] sanity: this device's local data must genuinely read as not-meaningful before testing the guard, got ${JSON.stringify(localStats)}`);

    const result = await page.evaluate(() => window.click360ResolveSyncConflict('keep_local'));
    assert(result?.preventedEmptyOverwrite === true,
      `[E] keep_local on a validated-but-empty local device must be redirected to a safe cloud refresh (preventedEmptyOverwrite: true), got ${JSON.stringify(result)}`);

    // withSecurityRulesDisabled() does not propagate its callback's return
    // value (confirmed: snap.exists()/snap.data() are correct INSIDE the
    // callback, but the value is lost by the time seed()/withSecurityRules
    // Disabled() resolves) -- capture it via a closure variable instead.
    let cloudAfter;
    await seed(testEnv, async (db) => {
      const snap = await getDoc(doc(db, 'businesses', uid, 'state', 'main'));
      cloudAfter = snap.data();
    });
    const cloudProductsAfter = cloudAfter?.payload?.data?.products?.length ?? -1;
    assert(cloudProductsAfter === CLOUD_PRODUCT_COUNT,
      `[E] DATA LOSS: the real cloud document must be untouched by a rejected keep_local -- expected ${CLOUD_PRODUCT_COUNT} products, found ${cloudProductsAfter}`);

    const local = await readSnapshot(page);
    assert(local.products === CLOUD_PRODUCT_COUNT,
      `[E] the device itself must end up hydrated with the real cloud catalog (the safe redirect), got ${local.products} products`);

    if (pageErrors.length) throw new Error(`[E] unexpected page errors: ${JSON.stringify(pageErrors)}`);
    console.log('CLICK 360 r37.2.2 scenario E PASS: "keep_local" on a genuinely empty (but validated/hydrated) local device is still refused and safely redirected to a cloud refresh -- the empty-local-never-overwrites-cloud guard was not weakened by this fix.');
  } finally {
    await context.close();
  }
}

// Real writer safety, independent of the conflict-resolution UI: after a
// material remote hydration, a storage fault falls back to seed with the SAME
// revision still in memory. The server must remain byte-for-byte unchanged.
async function scenarioFallbackNeverOverwritesCloud(browser, testEnv) {
  const email = `synthetic-fallback-guard-${RUN_ID}@example.test`;
  const uid = await createEmulatorUser(email, PASSWORD);
  const fullDocument = stateDocument(uid, 1_700_000_000_040, fullCloudData(uid, new Date().toISOString()));
  await seed(testEnv, async db => {
    await setDoc(doc(db, 'accountAccess', uid), accountAccessDocument(uid, email));
    await setDoc(doc(db, 'businesses', uid, 'state', 'main'), fullDocument);
  });
  const context = await newAppContext(browser);
  try {
    const { page, pageErrors } = await openApp(context, { email, password: PASSWORD });
    await waitForBoot(page);
    await page.waitForFunction(count => window.click360IsTenantDataHydrated?.() === true
      && window.click360GetTenantState?.()?.products?.length === count, CLOUD_PRODUCT_COUNT);
    let before;
    await seed(testEnv, async db => { before = (await getDocFromServer(doc(db, 'businesses', uid, 'state', 'main'))).data(); });
    const result = await page.evaluate(async () => {
      const originalGet = Storage.prototype.getItem;
      Storage.prototype.getItem = function(key) {
        if (String(key).includes('STATE:') || String(key).startsWith('CLICK360_TENANT:')) throw new Error('Synthetic storage acquisition fault');
        return originalGet.call(this, key);
      };
      try { window.click360ReloadState(); } finally { Storage.prototype.getItem = originalGet; }
      const immediately = { hydrated: window.click360IsTenantDataHydrated(), provenance: window.click360GetTenantStateProvenance(),
        products: window.click360GetTenantState().products.length };
      const pushed = await window.click360SyncNow();
      return { ...immediately, pushed };
    });
    assert(result.hydrated === false && result.provenance === 'fallback' && result.products === 0,
      `[F] fault must reproduce real fallback, got ${JSON.stringify(result)}`);
    assert(result.pushed === false, '[F] manual writer must refuse an unhydrated fallback even at the current revision');
    let after;
    await seed(testEnv, async db => { after = (await getDocFromServer(doc(db, 'businesses', uid, 'state', 'main'))).data(); });
    assert(JSON.stringify(after) === JSON.stringify(before), '[F] authoritative server document must remain byte-for-byte unchanged');
    assert(after.payload.data.products.length === 436, '[F] all 436 synthetic products stay authoritative');
    await page.evaluate(() => window.click360RefreshNow());
    await page.waitForFunction(() => window.click360IsTenantDataHydrated?.() === true
      && window.click360GetTenantState?.()?.products?.length === 436);
    assert(!pageErrors.length, `[F] page errors: ${JSON.stringify(pageErrors)}`);
    console.log('CLICK 360 r38 scenario F PASS: real storage fallback -> seed0 -> direct sync denied; independent server read retains exact 436-product document; cloud retry recovers.');
  } finally { await context.close(); }
}

async function scenarioExplicitNewTenantStillBootstraps(browser, testEnv) {
  const email = `synthetic-new-tenant-${RUN_ID}@example.test`;
  const uid = await createEmulatorUser(email, PASSWORD);
  await seed(testEnv, async db => {
    await setDoc(doc(db, 'accountAccess', uid), accountAccessDocument(uid, email));
    const missing = await getDocFromServer(doc(db, 'businesses', uid, 'state', 'main'));
    assert(!missing.exists(), '[G] new tenant must truly have no remote state');
  });
  const context = await newAppContext(browser);
  try {
    const { page, pageErrors } = await openApp(context, { email, password: PASSWORD });
    await waitForBoot(page);
    await page.waitForFunction(() => window.click360IsTenantDataHydrated?.() === true);
    let created;
    await seed(testEnv, async db => { created = (await getDocFromServer(doc(db, 'businesses', uid, 'state', 'main'))).data(); });
    assert(created?.ownerUid === uid && created?.businessId === uid, '[G] seeded identity must match exactly');
    assert(created?.reason === 'initial_tenant_seed' && created?.revision > 0, '[G] only explicit bootstrap creates the first revision');
    assert(created?.payload?.data?.products?.length === 0, '[G] empty new business is legitimate');
    const provenance = await page.evaluate(() => window.click360GetTenantStateProvenance());
    assert(provenance === 'remote', '[G] seed becomes hydrated only after the cloud transaction commits');
    assert(!pageErrors.length, `[G] page errors: ${JSON.stringify(pageErrors)}`);
    console.log('CLICK 360 r38 scenario G PASS: truly new tenant -> explicit seed -> authoritative matching identity/revision -> hydrated onboarding, with no weakening of existing-tenant protection.');
  } finally { await context.close(); }
}

// ── Runner ─────────────────────────────────────────────────────────────────
async function isUp(target) {
  try { return (await fetch(target)).ok; } catch { return false; }
}

/**
 * The checked-in firebase.json intentionally configures no emulators (the
 * repo's `npm run qa:rules` runs Firestore-only on CLI defaults), and this
 * test additionally needs the Auth emulator for a REAL signed-in user.
 * Rather than touch firebase.json, generate a disposable emulator config in
 * a temp dir from the REAL firestore.rules -- so the rules under test are
 * always the repo's own, byte for byte.
 */
function writeEmulatorConfig() {
  const dir = mkdtempSync(path.join(tmpdir(), 'click360-r37-2-2-'));
  writeFileSync(path.join(dir, 'firestore.rules'), RULES);
  writeFileSync(path.join(dir, 'firebase.json'), JSON.stringify({
    firestore: { rules: 'firestore.rules' },
    emulators: {
      auth: { host: '127.0.0.1', port: authPort },
      firestore: { host: '127.0.0.1', port: firestorePort },
      ui: { enabled: false }
    }
  }, null, 2));
  return dir;
}

async function run() {
  const alreadyRunning = (await isUp(`http://127.0.0.1:${firestorePort}/`)) && (await isUp(`http://127.0.0.1:${authPort}/`));
  const emulators = alreadyRunning ? null : spawn(
    path.join(root, 'node_modules/.bin/firebase'),
    ['emulators:start', '--only', 'firestore,auth', '--project', PROJECT_ID, '--config', path.join(writeEmulatorConfig(), 'firebase.json')],
    { cwd: root, stdio: 'ignore', env: { ...process.env, PATH: `${JAVA_DIRS.join(':')}:${process.env.PATH}` } }
  );
  const server = spawn(process.execPath, [path.join(root, 'node_modules/http-server/bin/http-server'), '.', '-p', String(port), '-c-1'], { cwd: root, stdio: 'ignore' });
  let testEnv = null;
  let browser = null;
  try {
    await waitForUrl(`http://127.0.0.1:${firestorePort}/`, 'Firestore emulator');
    await waitForUrl(`http://127.0.0.1:${authPort}/`, 'Auth emulator');
    await waitForUrl(url, 'App server');

    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { host: '127.0.0.1', port: firestorePort, rules: RULES }
    });
    browser = await chromium.launch();

    await scenarioCoreConvergenceAndPrint(browser, testEnv);
    await scenarioIdempotentRetry(browser, testEnv);
    await scenarioReconnectAfterNetworkCut(browser, testEnv);
    await scenarioKeepLocalNeverOverwritesCloud(browser, testEnv);
    await scenarioFallbackNeverOverwritesCloud(browser, testEnv);
    await scenarioExplicitNewTenantStillBootstraps(browser, testEnv);

    console.log('CLICK 360 r37.2.2 empty-device cloud recovery E2E PASS.');
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (testEnv) await testEnv.cleanup().catch(() => {});
    server.kill('SIGTERM');
    emulators?.kill('SIGTERM');
  }
}

await run();
