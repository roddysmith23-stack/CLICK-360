'use strict';
// Execute the production writer, including its transaction callback. No SDK,
// credentials or production endpoints: the transaction stores only in memory.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(process.env.CLICK360_GUARD_SOURCE || 'firebase-service.js', 'utf8');
const start = source.indexOf('function syncError(');
const end = source.indexOf("async function pushLocalToFirestore(reason = 'auto'");
assert(start > 0 && end > start);
const writer = source.slice(start, end);
const identity = { ownerUid: 'qa-owner', ownerId: 'qa-owner', businessId: 'qa-business', tenantKey: 'owner:qa-owner:business:qa-business' };
function payload(material = true) {
  return { identity: { ...identity }, data: {
    businesses: [{ id: 'qa-business', name: material ? 'Synthetic Shop' : 'Mi Negocio' }], activeBusinessId: 'qa-business',
    products: Array.from({ length: material ? 436 : 0 }, (_, i) => ({ id: `qa-product-${i}`, stock: 10, qty: 10 })),
    sales: Array.from({ length: material ? 24 : 0 }, (_, i) => ({ id: `qa-sale-${i}` })),
    movements: Array.from({ length: material ? 69 : 0 }, (_, i) => ({ id: `qa-movement-${i}` })),
    settings: { labelTemplates: [], labelProfiles: [] },
  } };
}
async function runCase(test) {
  const local = test.local || payload(test.materialLocal === true);
  const remote = test.remote === null ? null : { ...identity, revision: 12, payload: test.remote || payload(true) };
  const context = { ...identity, authUid: 'qa-owner', ...(test.context || {}) };
  const storage = new Map();
  if (test.priorMaterial) storage.set('REMOTE_MATERIAL_SEEN', '1');
  const observations = { writes: 0, errors: [], localPreserved: JSON.stringify(local) };
  let hydrated = test.hydrated !== false;
  const sandbox = {
    console: { warn() {} }, Date, JSON, Number, String, Array, Object, Set, Map, Error,
    auth: { currentUser: { uid: 'qa-owner' } }, ACTIVE_CONTEXT: context, STATE_DOC: {}, AUTH_EPOCH: 1,
    AUTH_APPROVED: true, IS_RESTORING_REMOTE: false, PULL_COMPLETE: true,
    LAST_REMOTE_REVISION: remote ? 12 : 0, LOCAL_WRITE_PENDING_UNTIL: 0,
    INITIAL_TENANT_SEED_REQUIRED: test.reason === 'initial_tenant_seed', MAX_CLOUD_PAYLOAD_BYTES: 1e9,
    TENANT_MATERIAL_EVIDENCE: new Set(),
    tenantGuard: { canWrite: () => true }, navigator: { onLine: true },
    legacyMigrationRequired: () => false, getSyncState: () => ({ status: 'clean' }),
    isActiveSyncScope: () => true, isEffectiveReadOnly: () => false,
    buildBusinessPayload: () => local, sameTenant: () => true,
    activeIdentityIsValid: () => !test.invalidIdentity,
    snapshotString: JSON.stringify, materialPayloadHash: JSON.stringify,
    safeStorageGet: key => storage.get(key), safeStorageSet: (key, value) => storage.set(key, value),
    tenantStorageKeyFor: (_, key) => key, quarantineIncident: () => {},
    setSyncStatus: (status, message) => { if (status === 'error') observations.errors.push(message); },
    buildV10StateDocument: p => ({ ...identity, revision: 13, payload: p }),
    remoteMatchesContext: () => true, rememberAppliedRemotePayload: () => {},
    applyRemotePayload: () => {}, clearSyncConflict: () => {}, markSyncConflict: () => {}, recordTelemetryOnce: () => {},
    window: {
      click360IsTenantDataHydrated: () => hydrated,
      click360GetTenantStateProvenance: () => test.provenance || (hydrated ? 'remote' : 'seed'),
      CLICK360_P0_TENANT_GUARD: { utf8Bytes: () => 100, guardedWrite: async (_, __, fn) => { await fn(); return true; } },
    },
    db: { runTransaction: async fn => fn({
      get: async () => { if (test.loseHydrationDuringRead) hydrated = false; return { exists: !!remote, data: () => remote }; },
      set: () => { observations.writes++; },
    }) },
  };
  if (test.missingProvenance) delete sandbox.window.click360GetTenantStateProvenance;
  vm.createContext(sandbox);
  vm.runInContext(writer + '\nthis.runWriter = pushLocalToFirestoreOnce;', sandbox);
  const ok = await sandbox.runWriter(test.reason || 'online_reconnect', test.force === true);
  assert.equal(observations.writes, test.allow ? 1 : 0, `${test.name}: unsafe transaction write`);
  assert.equal(ok, test.allow === true, `${test.name}: result must match safety decision`);
  assert.equal(JSON.stringify(local), observations.localPreserved, `${test.name}: never discard the local candidate`);
}
const cases = [
  { name: '436/24/69 remote vs unhydrated 0/0/0', hydrated: false },
  { name: 'seed Mi Negocio even when hydration flag is stale', provenance: 'seed' },
  { name: 'fallback with non-empty poisoned state', materialLocal: true, provenance: 'fallback' },
  { name: 'unresolved business identity', materialLocal: true, invalidIdentity: true, context: { ownerUid: '' } },
  { name: 'same revision cannot authorize unexpected empty replacement' },
  { name: 'force keep-local cannot authorize empty replacement', force: true },
  { name: 'hydration lost while awaiting transaction read', materialLocal: true, loseHydrationDuringRead: true },
  { name: 'unhydrated non-empty state also denied', materialLocal: true, hydrated: false },
  { name: 'missing document cannot be seeded by reconnect', remote: null },
  { name: 'explicit legitimate new tenant', remote: null, reason: 'initial_tenant_seed', provenance: 'explicit_initial', hydrated: false, allow: true },
  { name: 'hydrated material mutation remains allowed', materialLocal: true, allow: true },
  { name: 'missing runtime provenance fails closed', materialLocal: true, missingProvenance: true },
  { name: 'prior material evidence survives an empty remote', remote: payload(false), priorMaterial: true },
  { name: 'prior material evidence forbids mistaken new-tenant seed', remote: null, reason: 'initial_tenant_seed', hydrated: false, priorMaterial: true },
  { name: 'legitimate hydrated empty tenant may save settings', remote: payload(false), allow: true },
];
const emptyWithTemplates = payload(false);
emptyWithTemplates.data.settings.labelTemplates = [{ id: 'qa-template' }];
emptyWithTemplates.data.settings.labelProfiles = [{ id: 'qa-profile' }];
emptyWithTemplates.data.auditLogs = [{ id: 'qa-existing-audit' }];
cases.push({ name: 'preserved templates/audit cannot disguise missing commerce', local: emptyWithTemplates });
const emptyWithCash = payload(false);
emptyWithCash.data.cashSessions = [{ id: 'qa-open-cash' }];
cases.push({ name: 'retained cash session cannot disguise empty inventory/sales/movements', local: emptyWithCash });
const partialCore = payload(false);
partialCore.data.movements = [{ id: 'qa-surviving-movement' }];
cases.push({ name: 'one surviving core ledger cannot disguise missing products and sales', local: partialCore });
(async () => {
  const failures = [];
  for (const test of cases) {
    try { await runCase(test); console.log(`PASS ${test.name}`); }
    catch (error) { failures.push(error.message); console.error(`FAIL ${error.message}`); }
  }
  if (failures.length) throw new Error(`${failures.length}/${cases.length} safety regressions failed`);
  console.log(`PASS qa-no-empty-tenant-overwrite: ${cases.length} production-writer transaction scenarios`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
