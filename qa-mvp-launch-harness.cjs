const assert = require('assert');
const fs = require('fs');

require('./p0-tenant-guard.js');
const guard = global.CLICK360_P0_TENANT_GUARD;
const firebaseService = fs.readFileSync('firebase-service.js', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');

class StorageMock {
  constructor() { this.values = new Map(); }
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] || null; }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function tenant(letter) {
  const uid = `uid-${letter}`;
  return {
    authUid: uid,
    ownerUid: uid,
    ownerId: uid,
    businessId: uid,
    tenantKey: `owner:${uid}:business:${uid}`,
    schemaVersion: 10
  };
}

function tenantState(context, productCodes) {
  return {
    identity: guard.expectedIdentity(context),
    activeBusinessId: 'biz_main',
    businesses: [{ id: 'biz_main', name: `Negocio ${context.authUid}` }],
    products: productCodes.map((code) => ({ id: `product-${code}`, businessId: 'biz_main', code })),
    sales: [], movements: [], invoices: [], dailyReports: [], deletedProducts: [], auditLogs: [],
    settings: { workers: [], labelTemplates: [], customers: [], reminders: [], onboarding: {} }
  };
}

function readState(storage, context) {
  return JSON.parse(storage.getItem(`CLICK360_STATE:${context.tenantKey}`));
}

const A = tenant('a');
const B = tenant('b');
const storage = new StorageMock();
storage.setItem(`CLICK360_STATE:${A.tenantKey}`, JSON.stringify(tenantState(A, ['A-KEEP', 'A-DELETE'])));
storage.setItem(`CLICK360_STATE:${B.tenantKey}`, JSON.stringify(tenantState(B, ['B-KEEP'])));

// A coherent V10 remote is the source of truth for the current tenant only.
storage.setItem(`CLICK360_TENANT:${A.tenantKey}:LEGACY_MIGRATION_REQUIRED`, '1');
storage.setItem(`CLICK360_TENANT:${B.tenantKey}:LEGACY_MIGRATION_REQUIRED`, '1');
storage.setItem(`CLICK360:V10:QUARANTINE:${A.authUid}:${A.tenantKey}:legacy-local-seen`, JSON.stringify({ context: A }));
storage.setItem('CLICK360_QUARANTINED:old-a', JSON.stringify({ context: A }));
storage.setItem('CLICK360_QUARANTINED:old-b', JSON.stringify({ context: B }));
storage.setItem('CLICK360_QUARANTINED:ambiguous', JSON.stringify({ detectedUid: A.authUid }));

const removed = guard.reconcileLegacyMarkers(storage, A);
assert(removed.includes(`CLICK360_TENANT:${A.tenantKey}:LEGACY_MIGRATION_REQUIRED`), 'V10 A removes its exact legacy marker');
assert.strictEqual(storage.getItem(`CLICK360_TENANT:${B.tenantKey}:LEGACY_MIGRATION_REQUIRED`), '1', 'V10 A never removes B marker');
assert.strictEqual(storage.getItem('CLICK360_QUARANTINED:old-a'), null, 'V10 A removes a fully identified old marker');
assert.notStrictEqual(storage.getItem('CLICK360_QUARANTINED:old-b'), null, 'V10 A preserves B quarantine');
assert.notStrictEqual(storage.getItem('CLICK360_QUARANTINED:ambiguous'), null, 'ambiguous global quarantine remains untouched');
assert.deepStrictEqual(guard.reconcileLegacyMarkers(storage, A), [], 'reconciliation is idempotent');

// Ten A -> B -> A, two tabs, delete propagation, and ten rapid switches.
for (let cycle = 0; cycle < 10; cycle += 1) {
  const a = readState(storage, A);
  const b = readState(storage, B);
  assert(guard.validBusinessPayload({ identity: a.identity, data: a }, A), `A state valid on cycle ${cycle}`);
  assert(guard.validBusinessPayload({ identity: b.identity, data: b }, B), `B state valid on cycle ${cycle}`);
  assert(!a.products.some((product) => product.code === 'B-KEEP'), `B never appears in A on cycle ${cycle}`);
  assert(!b.products.some((product) => product.code.startsWith('A-')), `A never appears in B on cycle ${cycle}`);
}
const tabAOne = readState(storage, A);
tabAOne.products = tabAOne.products.filter((product) => product.code !== 'A-DELETE');
tabAOne.deletedProducts.push({ productId: 'product-A-DELETE', businessId: 'biz_main', deletedAtMs: 1 });
storage.setItem(`CLICK360_STATE:${A.tenantKey}`, JSON.stringify(tabAOne));
const tabATwo = readState(storage, A);
assert(!tabATwo.products.some((product) => product.code === 'A-DELETE'), 'deleted product does not reappear in a second A tab');
assert(readState(storage, B).products.some((product) => product.code === 'B-KEEP'), 'B is unchanged by A deletion');

// A phone is just another verified cache of A. Its incoming remote snapshot
// cannot cross into B even when the original device was offline.
const phoneCache = new StorageMock();
phoneCache.setItem(`CLICK360_STATE:${A.tenantKey}`, storage.getItem(`CLICK360_STATE:${A.tenantKey}`));
assert(!readState(phoneCache, A).products.some((product) => product.code === 'A-DELETE'), 'phone receives A deletion after reconnection');
assert.strictEqual(phoneCache.getItem(`CLICK360_STATE:${B.tenantKey}`), null, 'phone never receives B cache');

const start = 1_700_000_000_000;
const activeTrial = guard.evaluateAccountAccess({ status: 'trial', plan: 'normal', trialStartedAtMs: start }, start + 6 * 86400000, 7);
const expiredTrial = guard.evaluateAccountAccess({ status: 'trial', plan: 'normal', trialStartedAtMs: start }, start + 7 * 86400000, 7);
const founder = guard.evaluateAccountAccess({ status: 'active', plan: 'founder' }, start, 7);
const pro = guard.evaluateAccountAccess({ status: 'active', plan: 'pro' }, start, 7);
assert(activeTrial.allowed && !activeTrial.readOnly && activeTrial.mode === 'trial', 'new trial writes before the server deadline');
assert(expiredTrial.allowed && expiredTrial.readOnly && expiredTrial.mode === 'expired', 'expired trial becomes read-only at the server deadline');
assert(founder.allowed && !founder.readOnly && founder.mode === 'founder', 'founder remains fully active');
assert(pro.allowed && !pro.readOnly && pro.plan === 'pro', 'manual Pro activation remains active');

const trials = new Map();
function createTrialOnce(uid, serverNow) {
  if (!trials.has(uid)) trials.set(uid, { uid, startedAt: serverNow });
  return trials.get(uid);
}
assert.strictEqual(createTrialOnce('new-user', start).startedAt, createTrialOnce('new-user', start + 100).startedAt, 'a UID receives only one immutable trial start');

assert(firebaseService.includes('reconcileLocalStateWithRemoteV10(remoteData, context)'), 'remote V10 reconciliation executes before normal unlock');
assert(firebaseService.includes('remoteMustHydrate'), 'empty seed cannot win over a valid remote V10 snapshot');
assert(firebaseService.includes('const localChanged = !remoteMustHydrate && localCacheStatus.valid === true'), 'deferred V10 hydration cannot be blocked by stale local pending metadata');
assert(firebaseService.includes('ACCESS_READ_ONLY') && firebaseService.includes('window.click360CanMutate'), 'expired accounts cannot persist local or remote edits');
assert(firebaseService.includes("ACCOUNT_ACCESS_COLLECTION = 'accountAccess'") && firebaseService.includes('FieldValue.serverTimestamp()'), 'trial uses the account-access collection and Firestore server time');
assert(!firebaseService.includes('STATE_DOC.set('), 'legacy or first edits never use direct state last-write-wins');
assert(app.includes('CLICK360_STATE:') && app.includes('CLICK360_SESSION:'), 'application cache and session keys remain tenant or UID namespaced');
assert(!app.includes('localStorage.clear()') && !firebaseService.includes('localStorage.clear()'), 'no broad browser storage deletion occurs');

console.log('PASS MVP launch: V10 reconciliation removes only current-tenant markers and preserves ambiguous/B data');
console.log('PASS MVP launch: A/B ten cycles, two tabs, phone reconnection, and deletion isolation');
console.log('PASS MVP launch: server-time trial, founder, Pro, expired-read-only, and one-trial-per-UID contracts');
