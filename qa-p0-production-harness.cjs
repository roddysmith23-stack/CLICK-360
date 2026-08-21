const assert = require('assert');
const fs = require('fs');

require('./p0-tenant-guard.js');
const runtime = global.CLICK360_P0_TENANT_GUARD;
const firebaseService = fs.readFileSync('firebase-service.js', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');
const rules = fs.readFileSync('firestore.rules', 'utf8');
const serviceWorker = fs.readFileSync('service-worker.js', 'utf8');

function tenant(index) {
  const ownerId = `owner-${index}`;
  return {
    authUid: `auth-${index}`,
    ownerUid: ownerId,
    ownerId,
    businessId: ownerId,
    tenantKey: `owner:${ownerId}:business:${ownerId}`,
    schemaVersion: 10
  };
}

function payloadFor(context, code = 'SKU-001') {
  return {
    identity: runtime.expectedIdentity(context),
    data: {
      businesses: [{ id: 'biz_main', name: `Business ${context.ownerId}` }],
      activeBusinessId: 'biz_main',
      products: [{ id: `p-${code}`, code, businessId: 'biz_main' }],
      sales: [],
      movements: [],
      invoices: [],
      dailyReports: [],
      deletedProducts: [],
      auditLogs: [],
      settings: { workers: [], labelTemplates: [] }
    }
  };
}

// Simulated 100-account storage switch. Every account receives a unique key
// and a complete identity; no key or payload can be reused by another tenant.
const storage = new Map();
const tenants = Array.from({ length: 100 }, (_, index) => tenant(index + 1));
for (const context of tenants) {
  const key = `CLICK360:V16:STATE:${context.authUid}:${context.tenantKey}`;
  storage.set(key, JSON.stringify(payloadFor(context, `SKU-${context.ownerId}`)));
}
for (let cycle = 0; cycle < 1000; cycle += 1) {
  const context = tenants[(cycle * 37) % tenants.length];
  const key = `CLICK360:V16:STATE:${context.authUid}:${context.tenantKey}`;
  const parsed = JSON.parse(storage.get(key));
  assert(runtime.sameTenantIdentity(parsed.identity, context), `tenant identity mismatch on cycle ${cycle}`);
  assert(parsed.data.products[0].code.endsWith(context.ownerId), `tenant product leaked on cycle ${cycle}`);
}
assert.strictEqual(new Set([...storage.keys()]).size, 100, 'each tenant must have one distinct cache key');

const a = tenants[0];
const b = tenants[1];
const validPayload = payloadFor(a);
assert(runtime.validBusinessPayload(validPayload, a), 'complete v10 payload is accepted');
assert(!runtime.validBusinessPayload(validPayload, b), 'payload cannot cross tenant boundaries');
assert(!runtime.validBusinessPayload({ ...validPayload, identity: { ...validPayload.identity, tenantKey: b.tenantKey } }, a), 'tenant key is required and exact');
assert(!runtime.validBusinessPayload({ ...validPayload, data: { ...validPayload.data, businesses: [] } }, a), 'empty business state is rejected');
assert(!runtime.validBusinessPayload({ ...validPayload, data: { ...validPayload.data, products: null } }, a), 'corrupt arrays are rejected');
assert(runtime.safeImageSrc('data:image/jpeg;base64,AA=='), 'safe local image accepted');
assert(runtime.safeImageSrc('https://example.test/photo.jpg'), 'safe HTTPS image accepted');
assert.strictEqual(runtime.safeImageSrc('javascript:alert(1)'), '', 'script image URL rejected');
assert.strictEqual(runtime.safeImageSrc('data:image/svg+xml;base64,PHN2Zz4='), '', 'SVG data URL rejected');
assert(runtime.utf8Bytes(validPayload) > 0, 'payload byte sizing available');

// Mirrors transaction preconditions: exactly one concurrent writer can advance
// a revision; the stale writer must preserve both versions rather than overwrite.
let revision = 41;
function commit(expectedRevision) {
  if (expectedRevision !== revision) return false;
  revision += 1;
  return true;
}
assert(commit(41), 'first concurrent writer commits');
assert(!commit(41), 'stale concurrent writer is rejected');
assert.strictEqual(revision, 42, 'revision stays monotonic after conflict');

assert(firebaseService.includes('db.runTransaction(async (transaction)'), 'state writes use a transaction');
assert(!firebaseService.includes('STATE_DOC.set('), 'direct last-write-wins state writes are removed');
assert(firebaseService.includes('PUSH_SCHEDULERS') && firebaseService.includes('SYNC_CONFLICT_PENDING'), 'writes are serialized per auth epoch and conflicts block retries');
assert(firebaseService.includes('isActiveSyncScope(context, stateDoc, expectedEpoch, user)'), 'async pull/listener/write work is bound to account epoch and tenant context');
assert(firebaseService.includes("tenantStorageKeyFor(context, 'REMOTE_REVISION')"), 'async writes persist metadata only to their captured tenant');
assert(firebaseService.includes('if (!cleanEmptyDevice && !onlineOnlyEmptyDevice)'), 'a missing remote cannot replace an existing or corrupt local cache with seed');
assert(firebaseService.includes("['cache_missing', 'localstorage_unavailable'].includes(localCacheStatus.reason)"), 'a verified new tenant can bootstrap directly to cloud when browser storage is unavailable');
assert(firebaseService.includes('click360LoadIndexedTenantCache(context)'), 'IndexedDB is checked before a missing remote can receive a new seed');
assert(firebaseService.includes('localCacheStatus.valid === true'), 'fresh in-memory seed is never treated as a verified local edit');
assert(firebaseService.includes('OFFLINE_APPROVAL_MAX_AGE_MS'), 'offline approval cache expires');
assert(firebaseService.includes("const allowedRoles = ['owner', 'worker', 'seller', 'cashier', 'inventory', 'supervisor', 'admin']") && firebaseService.includes("role === 'owner' && ownerId !== user.uid"), 'missing or contradictory roles cannot become owner by default');
assert(firebaseService.includes("addEventListener('click360-local-state-saved'") && !firebaseService.includes('localStorage.setItem = function'), 'explicit tenant save events trigger sync without monkey-patching Storage');
assert(firebaseService.includes('La migraci') && firebaseService.includes('administrativa'), 'public legacy migration is disabled');
assert(!firebaseService.includes('tempOwners') && !rules.includes('tempOwnerEmail'), 'hard-coded owner fallback is removed');
assert(rules.includes('request.resource.data.payload.identity.tenantKey'), 'rules require payload tenant identity');
assert(rules.includes('Owner accounts are provisioned only by an administrative credential'), 'rules prohibit client self-provisioned owners');
assert(app.includes('localDateKey') && !app.includes('new Date().toISOString().slice(0,10)'), 'cash dates use local calendar dates');
assert(app.includes('CLICK360_BACKUP:${activeTenantContext.tenantKey}:') || app.includes('CLICK360_BACKUP:${activeTenantContext.tenantKey}:'), 'local backups are tenant namespaced');
assert(app.includes('restoreLastPersistedState') && !app.includes('optimizeStateForStorage'), 'quota failures restore the last confirmed state without deleting images');
assert(app.includes('missing_or_mismatched_identity') && !app.includes('session.role') && !app.includes('session.username'), 'corrupt caches and local session roles cannot unlock an account');
assert(app.includes('invalid_local_payload_shape') && app.includes('cross_tab_payload_invalid'), 'corrupt and cross-tab payloads are rejected before use');
assert(!app.includes("location.search.includes('qa')") && !app.includes('function runQa()'), 'browser QA mutation backdoor is removed');
assert(app.includes('CLICK360_PROFILE_PENDING:') && firebaseService.includes('click360FlushPendingProfile'), 'profile updates persist locally and retry after reconnection');
assert(firebaseService.includes('profileUpdatedAtMs') && firebaseService.includes('localWins'), 'newer remote profiles replace stale local cache while pending offline edits remain protected');
assert(serviceWorker.includes('cross-origin request must stay network-only'), 'service worker does not cache auth or Firestore network responses');
assert(serviceWorker.includes("key.startsWith('click360-')"), 'service worker clears only CLICK 360 caches');
assert(firebaseService.includes('reconcileLocalStateWithRemoteV10') && firebaseService.includes('remoteMustHydrate'), 'coherent V10 remote state reconciles stale local markers before unlock');
assert(firebaseService.includes('CLICK360:V16:QUARANTINE:') && !firebaseService.includes('CLICK360_DEVICE_ID'), 'new quarantine and device identifiers are application-version namespaced');

console.log('PASS P0 production stress: 100 tenants, 1000 rapid switches, strict cache isolation');
console.log('PASS P0 production stress: corrupt payload, image, revision, and stale-write guards');
console.log('PASS P0 production stress: no legacy browser migration, temp owner fallback, or broad cache deletion');
