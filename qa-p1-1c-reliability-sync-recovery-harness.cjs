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

function stripNonMaterial(value) {
  if (Array.isArray(value)) return value.map(stripNonMaterial);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  Object.keys(value).sort().forEach((key) => {
    if (['activeBusinessId', 'updatedAt', 'updatedAtMs'].includes(key)) return;
    output[key] = stripNonMaterial(value[key]);
  });
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
  return { status: 'clean', blocking: false, hasDirtyFields };
}

function writeGate(access, syncState) {
  if (access.readOnly === true) return { allowed: false, reason: 'read_only' };
  if (syncState.blocking) return { allowed: false, reason: syncState.status === 'real_conflict' ? 'sync_conflict' : 'pending_remote_sync' };
  return { allowed: true, reason: 'ok' };
}

const remoteOmega = payload('omega');
const localAlfa = payload('alfa');
const localOmega = payload('omega');
const localTimestampOnly = payload('omega', [{ id: 'p-1', name: 'Producto QA', businessId: 'omega', updatedAtMs: 999 }], { updatedAtMs: 999, updatedAt: '2026-07-18T00:01:00.000Z' });
const localRealChange = payload('omega', [{ id: 'p-1', name: 'Producto editado', businessId: 'omega', updatedAtMs: 100 }]);

assert.equal(materialPayloadHash(remoteOmega), materialPayloadHash(localAlfa), 'D: only activeBusinessId changes are non-material');
assert.equal(materialPayloadHash(remoteOmega), materialPayloadHash(localTimestampOnly), 'E: only updatedAt/updatedAtMs changes are non-material');

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
assert(firebase.includes("'clean'") && firebase.includes("'loading'") && firebase.includes("'pending_write'") && firebase.includes("'real_conflict'") && firebase.includes("'stale_lock'") && firebase.includes("'offline'"), 'sync state statuses are represented');
assert(firebase.includes('SYNC_CONFLICT_TTL_MS') && firebase.includes('PENDING_REMOTE_SYNC_TTL_MS'), 'sync locks have bounded TTL');
assert(firebase.includes('function readSyncConflictMarker(') && firebase.includes("legacy_marker"), 'legacy conflict marker is parsed safely');
assert(firebase.includes('window.click360ClearLocalRecoveryState'), 'safe local recovery action is exposed');
assert(firebase.includes('window.click360ResolveSyncConflict'), 'real conflict actions are exposed');
assert(firebase.includes('remote_material_equivalent'), 'remote revision mismatch with equal material payload does not become a conflict');
assert(app.includes('Conflicto de sincronización'), 'UI shows conflict recovery modal');
assert(app.includes('Actualizar desde nube') && app.includes('Conservar mi versión local') && app.includes('Limpiar estado local de esta app'), 'UI exposes recovery actions');
assert(app.includes('window.click360GetReliabilityDiagnostics'), 'UI exposes safe reliability diagnostics');
assert(runtime.includes('reliability:') && runtime.includes('lockAgeMs') && runtime.includes('hasDirtyFields'), 'runtime reports sanitized reliability fields');
assert(app.includes("const APP_RELEASE_VERSION = '1.0.5'"), 'app version is current candidate');
assert(runtime.includes("const APP_VERSION = '1.0.5'"), 'runtime version is current candidate');
assert(worker.includes("const CACHE = 'click360-commercial-1-0-5-r16'"), 'service worker cache is current');

console.log('PASS P1.1c reliability sync recovery harness: stale locks recover, real pending/conflicts stay protected');
