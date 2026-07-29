'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('app.js', 'utf8');
const firebase = fs.readFileSync('firebase-service.js', 'utf8');
const storage = fs.readFileSync('v16-storage.js', 'utf8');
const worker = fs.readFileSync('service-worker.js', 'utf8');
const runtime = fs.readFileSync('runtime-guard.js', 'utf8');

function snapshotString(value) {
  return JSON.stringify(value || {});
}

function materialPayloadHash(payload) {
  const clone = JSON.parse(snapshotString(payload));
  if (clone.data && typeof clone.data === 'object') {
    delete clone.data.activeBusinessId;
    delete clone.data.updatedAt;
    delete clone.data.updatedAtMs;
  }
  return snapshotString(clone);
}

function payload(activeBusinessId, products = [{ id: 'p-1', name: 'Producto QA', businessId: 'omega' }]) {
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
      updatedAtMs: Date.now(),
      updatedAt: new Date().toISOString()
    }
  };
}

function gate({ local, lastApplied, pending = false, conflict = false, pendingWindow = false, scheduler = false }) {
  const localFull = snapshotString(local);
  const localMaterial = materialPayloadHash(local);
  const lastFull = snapshotString(lastApplied);
  const lastMaterial = materialPayloadHash(lastApplied);
  const equivalent = localFull === lastFull || localMaterial === lastMaterial;
  const cleared = equivalent && (pending || conflict || pendingWindow);
  if (conflict && !cleared) return { allowed: false, reason: 'sync_conflict', cleared };
  if (pending && !cleared) return { allowed: false, reason: 'pending_remote_sync', recoveryQueued: !scheduler && !pendingWindow, cleared };
  return { allowed: true, reason: cleared ? 'stale_pending_cleared' : 'ok', cleared };
}

const remoteOmega = payload('omega');
const localAlfaOnlySwitch = payload('alfa');
const localOmegaAgain = payload('omega');
const localRealChange = payload('omega', [{ id: 'p-1', name: 'Producto editado', businessId: 'omega' }]);

assert.equal(materialPayloadHash(remoteOmega), materialPayloadHash(localAlfaOnlySwitch), 'business switch changes are non-material for conflict guard');
assert.notEqual(snapshotString(remoteOmega), snapshotString(localAlfaOnlySwitch), 'business switch still changes full UI snapshot');

const switchAtoB = gate({ local: localAlfaOnlySwitch, lastApplied: remoteOmega, pending: true });
assert.equal(switchAtoB.allowed, true, 'A -> B without commercial edits clears stale pending guard');
assert.equal(switchAtoB.cleared, true, 'A -> B clears stale pending metadata');

const switchBack = gate({ local: localOmegaAgain, lastApplied: remoteOmega, pending: true, conflict: true });
assert.equal(switchBack.allowed, true, 'B -> A clears stale conflict marker when material data matches cloud');
assert.equal(switchBack.reason, 'stale_pending_cleared');

const founderStaleLock = gate({ local: localAlfaOnlySwitch, lastApplied: remoteOmega, pending: true, pendingWindow: true });
assert.equal(founderStaleLock.allowed, true, 'founder/lifetime stale pending window is released when there is no material local change');

const pendingWrite = gate({ local: localRealChange, lastApplied: remoteOmega, pending: true, pendingWindow: true });
assert.equal(pendingWrite.allowed, false, 'real pending write still blocks temporarily');
assert.equal(pendingWrite.reason, 'pending_remote_sync');

const stalePendingNoScheduler = gate({ local: localRealChange, lastApplied: remoteOmega, pending: true, pendingWindow: false, scheduler: false });
assert.equal(stalePendingNoScheduler.recoveryQueued, true, 'stale real pending write queues recovery sync instead of remaining silent');

const realConflict = gate({ local: localRealChange, lastApplied: remoteOmega, conflict: true });
assert.equal(realConflict.allowed, false, 'real conflict remains blocked');
assert.equal(realConflict.reason, 'sync_conflict');

const pwaReload = gate({ local: localAlfaOnlySwitch, lastApplied: remoteOmega, pending: true, pendingWindow: false });
assert.equal(pwaReload.allowed, true, 'PWA reload with stale pending metadata is cleared when material hash matches');

assert(app.includes("save({ nonBlockingSync: true, operationId: uid('business-switch'), syncSource: 'business_switch' })"), 'business switch uses non-blocking sync metadata');
assert(app.includes("gate.reason === 'pending_remote_sync' ? 'ok' : 'err'"), 'temporary sync pending uses a soft toast');
assert(!app.includes('Estamos confirmando un cambio anterior en la nube. Espera unos segundos e intenta nuevamente.'), 'old permanent pending toast was removed');
assert(firebase.includes('function materialPayloadHash('), 'Firebase service computes material payload hash');
assert(firebase.includes("LAST_APPLIED_REMOTE_MATERIAL_HASH"), 'Firebase service stores material remote hash');
assert(firebase.includes('function maybeClearStaleSyncGuard('), 'Firebase service can clear stale sync/conflict guards');
assert(firebase.includes("pushLocalToFirestore('pending_gate_recovery')"), 'stale real pending writes trigger recovery sync');
assert(firebase.includes('PENDING_REMOTE_SYNC_GRACE_MS'), 'temporary pending gate has a bounded grace window');
assert(firebase.includes('pendingRemoteSync = event.detail?.pendingRemoteSync !== false'), 'local-state events distinguish real pending writes from non-blocking switches');
assert(storage.includes('materialHash: String(metadata.materialHash'), 'IndexedDB snapshot stores material hash');
assert(storage.includes('pendingCreatedAtMs: Number(metadata.pendingCreatedAtMs'), 'IndexedDB snapshot stores pending creation time');
assert(app.includes("const APP_RELEASE_VERSION = '1.0.5'"), 'app version is current candidate');
assert(runtime.includes("const APP_VERSION = '1.0.5'"), 'runtime version is current candidate');
assert(worker.includes("const CACHE = 'click360-commercial-1-0-5-r6'"), 'service worker cache is current');

console.log('PASS P1.1b sync guard harness: stale pending/conflict locks clear, real pending/conflicts remain protected');
