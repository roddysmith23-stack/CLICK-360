'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('app.js', 'utf8');
const firebase = fs.readFileSync('firebase-service.js', 'utf8');
const runtime = fs.readFileSync('runtime-guard.js', 'utf8');
const worker = fs.readFileSync('service-worker.js', 'utf8');

const PENDING_REMOTE_SYNC_TTL_MS = 2 * 60 * 1000;
const SYNC_CONFLICT_TTL_MS = 10 * 60 * 1000;
const UNKNOWN_LOCK_AGE_MS = Number.MAX_SAFE_INTEGER;
const NON_MATERIAL_SYNC_SOURCES = new Set([
  'business_switch',
  'non_blocking_local_change',
  'cloud_confirmed',
  'remote_applied',
  'indexeddb_recovery_already_synced',
  'stale_sync_guard',
  'manual_local_recovery'
]);

function snapshotString(value) {
  return JSON.stringify(value || {});
}

const OPTIONAL_EMPTY_ARRAY_KEYS = new Set([
  'restaurantPayments', 'restaurantPrintHistory', 'restaurantEvents', 'restaurantRecipes',
  'vehicles', 'routes', 'loadSheets', 'routeSales', 'collections', 'returns',
  'routeSettlements', 'routeExpenses', 'routeCustomers', 'events', 'printHistory',
  'operationLedger', 'activationRequests'
]);
const OPTIONAL_EMPTY_OBJECT_KEYS = new Set(['userProfiles', 'policies', 'legal']);
function stripNonMaterial(value, key = '', path = []) {
  if (Array.isArray(value)) {
    const items = value.map((item) => stripNonMaterial(item, '', [...path, key, '[]']));
    if (!items.length && OPTIONAL_EMPTY_ARRAY_KEYS.has(key)) return undefined;
    return items;
  }
  if (!value || typeof value !== 'object') return value;
  if (key === 'userProfiles') {
    const pendingProfiles = Object.fromEntries(Object.entries(value).filter(([, profile]) => profile?.pendingSync === true));
    if (Object.keys(pendingProfiles).length === 0) return undefined;
    value = pendingProfiles;
  }
  const output = {};
  Object.keys(value).sort().forEach((itemKey) => {
    if (['activeBusinessId', 'updatedAt', 'updatedAtMs'].includes(itemKey)) return;
    if (itemKey === 'layout' && path.includes('tables')) return;
    if ((key === 'data' || path.includes('data')) && ['identity', 'version', 'legacyDataBusinessId'].includes(itemKey)) return;
    if (key === 'settings' && itemKey === 'appVersion') return;
    const next = stripNonMaterial(value[itemKey], itemKey, [...path, key].filter(Boolean));
    if (next !== undefined) output[itemKey] = next;
  });
  if (key === 'logistics' && Object.keys(output).length === 0) return undefined;
  if (OPTIONAL_EMPTY_OBJECT_KEYS.has(key) && Object.keys(output).length === 0) return undefined;
  return output;
}

function materialPayloadHash(payload) {
  return snapshotString(stripNonMaterial(JSON.parse(snapshotString(payload))));
}

function payload(activeBusinessId, products = [{ id: 'p-1', name: 'Producto QA', businessId: 'omega', updatedAtMs: 100 }], extra = {}) {
  return {
    schemaVersion: 10,
    ownerId: 'uid-founder',
    businessId: 'uid-founder',
    tenantKey: 'owner:uid-founder:business:uid-founder',
    data: {
      businesses: [{ id: 'omega', name: 'Omega' }, { id: 'alfa', name: 'Alfa' }],
      activeBusinessId,
      products,
      sales: [],
      movements: [],
      invoices: [],
      settings: {},
      updatedAtMs: 100,
      updatedAt: '2026-07-18T00:00:00.000Z',
      ...extra
    }
  };
}

function evaluateSyncState({
  local,
  remote,
  freshRemote = null,
  pendingMeta = null,
  conflictMarker = null,
  pendingWindowActive = false,
  schedulerActive = false,
  online = true,
  founderOrLifetime = true,
  now = 1_000_000
}) {
  const localFull = snapshotString(local);
  const localMaterial = materialPayloadHash(local);
  const remoteFull = remote ? snapshotString(remote) : '';
  const remoteMaterial = remote ? materialPayloadHash(remote) : '';
  const freshRemoteMaterial = freshRemote ? materialPayloadHash(freshRemote) : '';
  const materialEquivalent = !!remote && (localFull === remoteFull || localMaterial === remoteMaterial);
  const hasRemoteBaseline = !!remote;
  const pendingSource = String(pendingMeta?.source || '').toLowerCase();
  const conflictSource = String(conflictMarker?.source || '').toLowerCase();
  const nonMaterialSource = NON_MATERIAL_SYNC_SOURCES.has(pendingSource) || NON_MATERIAL_SYNC_SOURCES.has(conflictSource);
  const pendingAgeMs = pendingMeta ? Math.max(0, now - Number(pendingMeta.pendingCreatedAtMs || pendingMeta.savedAtMs || 0)) : 0;
  const conflictAgeMs = conflictMarker ? (conflictMarker.createdAtMs ? Math.max(0, now - conflictMarker.createdAtMs) : UNKNOWN_LOCK_AGE_MS) : 0;
  const stalePendingByTtl = pendingMeta && pendingAgeMs > PENDING_REMOTE_SYNC_TTL_MS && !schedulerActive && !pendingWindowActive;
  const staleConflictByTtl = conflictMarker && conflictAgeMs > SYNC_CONFLICT_TTL_MS && !schedulerActive && !pendingWindowActive;
  const revisionConflict = conflictMarker && Number(conflictMarker.remoteRevision || 0) > 0
    && Number(conflictMarker.baseRevision || conflictMarker.localRevision || 0) > 0
    && Number(conflictMarker.remoteRevision || 0) !== Number(conflictMarker.baseRevision || conflictMarker.localRevision || 0);
  const hasDirtyFields = !!local && !materialEquivalent && hasRemoteBaseline && !nonMaterialSource;
  const freshRemoteMatch = !!freshRemote && localMaterial === freshRemoteMaterial;
  const freshRemoteDivergence = !!freshRemote && localMaterial !== freshRemoteMaterial;
  const legacyConflictWithoutBaseline = conflictMarker?.legacy === true && !hasRemoteBaseline && founderOrLifetime;
  const staleLock = materialEquivalent
    || nonMaterialSource
    || legacyConflictWithoutBaseline
    || ((stalePendingByTtl || staleConflictByTtl) && !hasDirtyFields && founderOrLifetime);

  if (!online && (pendingMeta || conflictMarker)) return { status: 'offline', blocking: false, hasDirtyFields };
  if (conflictMarker) {
    if (staleLock && !revisionConflict) return { status: 'stale_lock', blocking: false, hasDirtyFields };
    if (revisionConflict || hasDirtyFields) return { status: 'real_conflict', blocking: true, hasDirtyFields };
    return { status: 'stale_lock', blocking: false, hasDirtyFields };
  }
  if (pendingMeta) {
    if (staleLock) return { status: 'stale_lock', blocking: false, hasDirtyFields };
    if (hasDirtyFields || !hasRemoteBaseline) return { status: 'pending_write', blocking: true, hasDirtyFields };
    return { status: 'loading', blocking: false, hasDirtyFields };
  }
  if (pendingWindowActive && schedulerActive) return { status: hasDirtyFields ? 'pending_write' : 'loading', blocking: hasDirtyFields, hasDirtyFields };
  if (freshRemoteDivergence) return { status: 'real_conflict', blocking: true, hasDirtyFields };
  if (hasDirtyFields && freshRemoteMatch) return { status: 'verified_clean', blocking: false, hasDirtyFields };
  if (hasDirtyFields) return { status: 'needs_review', blocking: true, hasDirtyFields };
  return { status: 'clean', blocking: false, hasDirtyFields };
}

function writeGate(access, syncState) {
  if (access.readOnly === true) return { allowed: false, reason: 'read_only' };
  if (syncState.status === 'needs_review') return { allowed: false, reason: 'sync_verification_required' };
  if (syncState.blocking) return { allowed: false, reason: syncState.status === 'real_conflict' ? 'sync_conflict' : 'pending_remote_sync' };
  return { allowed: true, reason: 'ok' };
}

const remoteOmega = payload('omega');
const localAlfa = payload('alfa');
const localOmega = payload('omega');
const localTimestampOnly = payload('omega', [{ id: 'p-1', name: 'Producto QA', businessId: 'omega', updatedAtMs: 999 }], { updatedAtMs: 999, updatedAt: '2026-07-18T00:01:00.000Z' });
const localRealChange = payload('omega', [{ id: 'p-1', name: 'Producto editado', businessId: 'omega', updatedAtMs: 100 }]);
const localCompatibilityDefaults = payload('omega', undefined, {
  version:'CLICK360_V16', operationLedger:[], identity:{ businessId:'uid-founder' }, logistics:{ vehicles:[], routes:[], events:[] },
  settings:{ appVersion:'1.0.5', legacyDataBusinessId:'omega', activationRequests:[], policies:{}, legal:{}, userProfiles:{ 'uid-founder':{ uid:'uid-founder', name:'QA', pendingSync:false } } }
});
const remoteWithoutCompatibilityDefaults = payload('omega');
const localPendingProfile = payload('omega', undefined, {
  settings:{ userProfiles:{ 'uid-founder':{ uid:'uid-founder', name:'Pendiente', pendingSync:true } } }
});

assert.equal(materialPayloadHash(remoteOmega), materialPayloadHash(localAlfa), 'D: only activeBusinessId changes are non-material');
assert.equal(materialPayloadHash(remoteOmega), materialPayloadHash(localTimestampOnly), 'E: only updatedAt/updatedAtMs changes are non-material');
assert.equal(materialPayloadHash(remoteWithoutCompatibilityDefaults), materialPayloadHash(localCompatibilityDefaults), 'E2: deterministic local compatibility defaults are non-material');
assert.notEqual(materialPayloadHash(remoteWithoutCompatibilityDefaults), materialPayloadHash(localPendingProfile), 'E3: an explicitly pending profile remains material and protected');

const oldConflictNoDirty = evaluateSyncState({ local: localOmega, remote: remoteOmega, conflictMarker: { legacy: true, createdAtMs: 0 } });
assert.equal(oldConflictNoDirty.status, 'stale_lock', 'A: old SYNC_CONFLICT_PENDING without dirty fields is stale');
assert.equal(oldConflictNoDirty.blocking, false, 'A: old stale conflict does not block founder');

const oldPendingSameHash = evaluateSyncState({ local: localOmega, remote: remoteOmega, pendingMeta: { source: 'local_change', pendingCreatedAtMs: 1 } });
assert.equal(oldPendingSameHash.status, 'stale_lock', 'B: old pendingRemoteSync with matching material hash is stale');
assert.equal(oldPendingSameHash.blocking, false, 'B: matching material hash does not block');

const switchA = evaluateSyncState({ local: localAlfa, remote: remoteOmega, pendingMeta: { source: 'business_switch', pendingCreatedAtMs: 999_000 } });
assert.equal(switchA.status, 'stale_lock', 'C: business switch A -> B does not become conflict');
const switchBack = evaluateSyncState({ local: localOmega, remote: remoteOmega, pendingMeta: { source: 'business_switch', pendingCreatedAtMs: 999_100 }, conflictMarker: { legacy: true, createdAtMs: 0 } });
assert.equal(switchBack.blocking, false, 'C: business switch B -> A does not block');

const pendingReal = evaluateSyncState({ local: localRealChange, remote: remoteOmega, pendingMeta: { source: 'local_change', pendingCreatedAtMs: 999_500 }, pendingWindowActive: true, schedulerActive: true });
assert.equal(pendingReal.status, 'pending_write', 'F: real pending write is classified separately');
assert.equal(pendingReal.blocking, true, 'F: real pending write blocks temporarily');
const pendingResolved = evaluateSyncState({ local: localRealChange, remote: localRealChange });
assert.equal(pendingResolved.status, 'clean', 'F: pending write releases after cloud confirms matching state');

const iphoneFalseGreen = evaluateSyncState({ local: localRealChange, remote: remoteOmega });
assert.equal(iphoneFalseGreen.status, 'needs_review', 'F2: material difference without pending metadata must never fall through to clean');
assert.equal(iphoneFalseGreen.blocking, true, 'F2: unexplained material difference blocks writes until a fresh server read');
assert.equal(writeGate({ readOnly:false }, iphoneFalseGreen).reason, 'sync_verification_required', 'F2: write gate exposes the safe verification requirement');

const iphoneFreshMatch = evaluateSyncState({ local: localRealChange, remote: remoteOmega, freshRemote: localRealChange });
assert.equal(iphoneFreshMatch.status, 'verified_clean', 'F3: a fresh server read can explain an obsolete baseline without rewriting it');
assert.equal(iphoneFreshMatch.blocking, false, 'F3: matching fresh server material safely releases the gate');

const iphoneFreshDivergence = evaluateSyncState({ local: localRealChange, remote: remoteOmega, freshRemote: remoteOmega });
assert.equal(iphoneFreshDivergence.status, 'real_conflict', 'F4: a fresh server mismatch remains a blocking conflict');
assert.equal(iphoneFreshDivergence.blocking, true, 'F4: divergent server material cannot be overwritten');

const realConflict = evaluateSyncState({
  local: localRealChange,
  remote: remoteOmega,
  conflictMarker: { source: 'listener', createdAtMs: 999_500, baseRevision: 7, remoteRevision: 8 }
});
assert.equal(realConflict.status, 'real_conflict', 'G: real revision conflict remains protected');
assert.equal(writeGate({ readOnly: false }, realConflict).reason, 'sync_conflict', 'G: real conflict maps to sync_conflict gate');

const pwaReloadOldLock = evaluateSyncState({ local: localOmega, remote: remoteOmega, conflictMarker: { legacy: true, createdAtMs: 0 } });
assert.equal(pwaReloadOldLock.blocking, false, 'H: PWA reload with old lock does not remain permanently blocked');

const founderStaleLock = evaluateSyncState({ local: localOmega, remote: remoteOmega, pendingMeta: { source: 'local_change', pendingCreatedAtMs: 1 }, founderOrLifetime: true });
assert.equal(writeGate({ readOnly: false }, founderStaleLock).allowed, true, 'I: founder/lifetime can continue after stale lock cleanup');
assert.equal(writeGate({ readOnly: true }, founderStaleLock).reason, 'read_only', 'J: suspended/trial-expired readOnly still blocks before sync guard');

assert(firebase.includes('function getSyncState('), 'Firebase service exposes structured sync state');
assert(firebase.includes("'clean'") && firebase.includes("'verified_clean'") && firebase.includes("'needs_review'") && firebase.includes("'loading'") && firebase.includes("'pending_write'") && firebase.includes("'real_conflict'") && firebase.includes("'stale_lock'") && firebase.includes("'offline'"), 'sync state statuses are represented');
assert(firebase.includes('async function verifyRemoteSyncState('), 'support verification performs an explicit server-only read');
assert(firebase.includes("stateDoc.get({ source: 'server' })"), 'fresh sync verification bypasses cache');
assert(firebase.includes("reason: 'sync_verification_required'"), 'write gate blocks unexplained material differences');
assert(firebase.includes("remoteHashKind: 'last_applied_baseline'"), 'diagnostic labels the cached baseline honestly');
assert(firebase.includes('LAST_FRESH_REMOTE_VERIFICATION = verification'), 'fresh evidence is retained ephemerally for the exact local material hash');
assert(!firebase.includes("safeStorageSet(tenantStorageKey('LAST_APPLIED_REMOTE_MATERIAL_HASH'), remoteMaterialHash);\n\t\t\t      LAST_FRESH_REMOTE_VERIFICATION"), 'fresh diagnostic evidence does not rewrite the last-applied baseline');
assert(firebase.includes('SYNC_CONFLICT_TTL_MS') && firebase.includes('PENDING_REMOTE_SYNC_TTL_MS'), 'sync locks have bounded TTL');
assert(firebase.includes('function readSyncConflictMarker(') && firebase.includes("legacy_marker"), 'legacy conflict marker is parsed safely');
assert(firebase.includes('window.click360ClearLocalRecoveryState'), 'safe local recovery action is exposed');
assert(firebase.includes('window.click360ResolveSyncConflict'), 'real conflict actions are exposed');
assert(firebase.includes('remote_material_equivalent'), 'remote revision mismatch with equal material payload does not become a conflict');
assert(app.includes('Conflicto de sincronización'), 'UI retains true-conflict recovery modal');
assert(app.includes('Actualizar desde nube') && app.includes('Conservar mi versión local') && app.includes('Reparar sincronización'), 'UI exposes recovery actions for meaningful local data');
assert(app.includes('window.click360GetReliabilityDiagnostics'), 'UI exposes safe reliability diagnostics');
assert(app.includes("window.click360VerifyRemoteSyncState?.({ reason:'ui_diagnostic' })"), 'support diagnostic performs a read-only fresh verification before copying');
assert(app.includes("verification?.ok && verification.localMatchesRemote === true"), 'cash close only releases after a fresh material match');
assert(runtime.includes('reliability:') && runtime.includes('lockAgeMs') && runtime.includes('hasDirtyFields'), 'runtime reports sanitized reliability fields');
assert(app.includes("const APP_RELEASE_VERSION = '1.0.5'"), 'app version is current candidate');
assert(runtime.includes("const APP_VERSION = '1.0.5'"), 'runtime version is current candidate');
assert(app.includes("const APP_ASSET_VERSION = 'commercial-1-0-5-r38-1-sync-integrity'"), 'app asset version is current recovery release');
assert(worker.includes("const CACHE = 'click360-commercial-1-0-5-r38-1-sync-integrity'"), 'service worker cache is current recovery release');
assert(app.includes('Este dispositivo está vacío y no reemplazará los datos de la nube.'), 'empty device receives safe cloud-recovery UX');
assert(firebase.includes("action: 'refresh_cloud_empty_local'"), 'empty keep-local is reclassified to cloud refresh');
assert(firebase.includes('preventedEmptyOverwrite: true'), 'empty overwrite is explicitly prevented');
assert(firebase.includes("reason: 'manual_keep_local_after_readback'"), 'manual keep-local verifies remote readback before success');

console.log('PASS P1.1c reliability sync recovery harness: stale locks recover, empty devices pull cloud, true conflicts stay protected');
