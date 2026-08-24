/**
 * r37 (Section 7, second bug): the reliability/diagnostic panel could
 * report status "clean" while simultaneously showing localHash !=
 * remoteHash -- alarming for anyone reading the diagnostic even though the
 * actual sync-correctness decision (materialEquivalent/hasDirtyFields,
 * both derived from materialMatchesLastApplied(hashes)) was always right.
 *
 * Root cause: getSyncState()'s DISPLAY-only localHash used the FULL
 * payload hash (payloadHash, which includes volatile fields like
 * updatedAt/updatedAtMs and therefore differs on nearly every read) while
 * remoteHash used the MATERIAL hash of the last applied remote snapshot --
 * an apples-to-oranges comparison. A live-browser E2E cannot exercise
 * getSyncState() directly (buildBusinessPayload() requires a real
 * Firebase auth.currentUser, which this offline test harness has no way
 * to bootstrap), so this is a structural regression gate instead: it
 * proves the source wires localHash from the material hash, matching
 * remoteHash's semantics, and that the actual clean/dirty decision above
 * never used either of these two display fields.
 */
const assert = require('assert');
const fs = require('fs');

const service = fs.readFileSync('firebase-service.js', 'utf8');

const getSyncStateBody = service.slice(
  service.indexOf('function getSyncState('),
  service.indexOf('function clearLocalPendingSyncMetadata')
);
assert(getSyncStateBody.length > 200, 'getSyncState() function body not found in firebase-service.js');

assert(
  /localHash:\s*hashFingerprint\(hashes\.materialHash\)/.test(getSyncStateBody),
  'getSyncState() must build the diagnostic localHash from hashes.materialHash (matching remoteHash\'s material-only semantics), not the full payloadHash -- otherwise a genuinely clean state shows a false mismatch to whoever reads the reliability report'
);
assert(
  !/localHash:\s*hashFingerprint\(hashes\.payloadHash\)/.test(getSyncStateBody),
  'getSyncState() must NOT build localHash from the full hashes.payloadHash -- that includes volatile fields (updatedAt/updatedAtMs) absent from remoteHash\'s material hash, guaranteeing a mismatch even when genuinely clean'
);
assert(
  /remoteHash:\s*hashFingerprint\(lastMaterial/.test(getSyncStateBody),
  'getSyncState() must keep building remoteHash from the material-only lastMaterial value'
);

assert(
  /const materialEquivalent = materialMatchesLastApplied\(hashes\);/.test(getSyncStateBody),
  'the actual clean/dirty decision must be computed via materialMatchesLastApplied(hashes), independently of the localHash/remoteHash display fields'
);
assert(
  /const hasDirtyFields = !!hashes\.payload && !materialEquivalent/.test(getSyncStateBody),
  'hasDirtyFields must derive from materialEquivalent, not from comparing the display-only localHash/remoteHash fields'
);

console.log('PASS r37 reliability hash-labels harness: getSyncState() diagnostic localHash/remoteHash both use the material hash (directly comparable), while the real clean/dirty decision stays independent of those display fields');
