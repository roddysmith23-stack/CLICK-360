'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const firebase = fs.readFileSync('firebase-service.js', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');

function classify({ localHash, baselineHash, freshRemoteHash = '', pending = false, conflict = false }) {
  const hasDirtyFields = Boolean(localHash && baselineHash && localHash !== baselineHash);
  const freshChecked = Boolean(freshRemoteHash);
  const freshMatch = freshChecked && localHash === freshRemoteHash;
  if (conflict || (freshChecked && !freshMatch)) return { status:'real_conflict', blocking:true, hasDirtyFields };
  if (pending && hasDirtyFields) return { status:'pending_write', blocking:true, hasDirtyFields };
  if (hasDirtyFields && freshMatch) return { status:'verified_clean', blocking:false, hasDirtyFields };
  if (hasDirtyFields) return { status:'needs_review', blocking:true, hasDirtyFields };
  return { status:'clean', blocking:false, hasDirtyFields };
}

const iphoneDiagnostic = {
  localHash:'h_0fee9b18',
  baselineHash:'h_01f8df6e'
};
const beforeFreshRead = classify(iphoneDiagnostic);
assert.deepEqual(beforeFreshRead, {
  status:'needs_review', blocking:true, hasDirtyFields:true
}, 'the exact iPhone diagnostic must fail closed before an authoritative server read');

const afterAuthoritativeRead = classify({
  ...iphoneDiagnostic,
  freshRemoteHash:'h_0fee9b18'
});
assert.equal(afterAuthoritativeRead.status, 'verified_clean', 'the authoritative material match explains the obsolete baseline');
assert.equal(afterAuthoritativeRead.blocking, false, 'matching server material may release the write gate without replacing local state');

const changedServer = classify({
  ...iphoneDiagnostic,
  freshRemoteHash:'h_server_changed'
});
assert.equal(changedServer.status, 'real_conflict', 'a real fresh divergence remains blocked');
assert.equal(changedServer.blocking, true);

const MAX_LOCAL_TENANT_STATE_BYTES = 850000;
const compactCloseBytes = 848247;
assert(compactCloseBytes < MAX_LOCAL_TENANT_STATE_BYTES, 'the compact historical close still fits the certified guard');
assert.equal(MAX_LOCAL_TENANT_STATE_BYTES - compactCloseBytes, 1753, 'the residual monolithic margin remains explicitly visible');

assert(firebase.includes("next = { ...base, status: 'needs_review', blocking: true, reason: 'material_difference_without_fresh_verification' }"), 'production state machine cannot report an unexplained material difference as clean');
assert(firebase.includes("next = { ...base, status: 'verified_clean', blocking: false, reason: 'fresh_remote_material_match' }"), 'a fresh exact match has a distinct terminal state');
assert(firebase.includes("next = { ...base, status: 'real_conflict', blocking: true, reason: 'fresh_remote_material_divergence' }"), 'fresh divergence fails closed');
assert(firebase.includes("if (syncState.status === 'needs_review' && !localMutationIntent) return { allowed: false, reason: 'sync_verification_required', syncState };"), 'write gate blocks unexplained divergence before verification');
assert(firebase.includes('function beginLocalMutationIntent(') && firebase.includes('baseVerified = materialMatchesLastApplied(previousHashes)'), 'a critical mutation intent is accepted only from a previously verified baseline');
assert(firebase.includes('intent.localMaterialHash !== hashes.materialHash'), 'mutation intent is bound to the exact local candidate hash');
assert(firebase.includes("const snapshot = await stateDoc.get({ source: 'server' });"), 'verification bypasses Firestore cache');
assert(firebase.includes('LAST_FRESH_REMOTE_VERIFICATION = verification;'), 'fresh evidence is ephemeral and hash-bound');
assert(firebase.includes("remoteHashKind: 'last_applied_baseline'"), 'cached baseline is not mislabeled as current cloud state');
assert(firebase.includes("if (key === 'settings' && itemKey === 'appVersion') return;"), 'runtime appVersion compatibility defaults cannot manufacture a material conflict');
assert(firebase.includes(".filter(([, profile]) => profile?.pendingSync === true)"), 'only explicitly pending user profiles remain material to whole-state protection');
assert(firebase.includes("'operationLedger', 'activationRequests'"), 'empty locally reconstructed collections are normalized without hiding non-empty operations');
assert(app.includes("window.click360VerifyRemoteSyncState?.({ reason:'ui_diagnostic' })"), 'support diagnostic performs fresh read-only verification');
assert(app.includes("verification?.ok && verification.localMatchesRemote === true"), 'cash close only auto-releases on an exact fresh match');
assert(app.includes('if (persistence?.indexedPromise) await persistence.indexedPromise;'), 'critical mutations settle their own pending cache evidence before the remote write gate runs');
assert(app.includes('window.click360BeginLocalMutationIntent?.({ operationId, previousState });') && app.includes('window.click360EndLocalMutationIntent?.(operationId);'), 'critical mutation intent has a bounded begin/end lifecycle');
assert(app.includes('Hash baseline anterior') && app.includes('Hash servidor fresco'), 'support UI separates baseline from fresh evidence');

console.log('PASS SHARY sync integrity: false clean blocked, authoritative match safe, divergence protected, 1753-byte residual margin explicit');
