/**
 * r37 (Section 41-49 offline audit): modular/worker-mode writes were
 * unconditionally blocked while offline in writeGateStatus() -- unlike
 * legacy/owner mode, which only blocks when ONLINE_ONLY_SAFE (local
 * storage itself unavailable). A worker with a perfectly healthy local
 * device could not sell, close cash, or print while offline, purely
 * because of a mode check that had nothing to do with whether the write
 * could actually be queued safely.
 *
 * Separately, the "online" reconnect handler only ever flushed
 * legacy-mode's pending write (checked STATE_DOC, called
 * pushLocalToFirestore directly) -- a modular session had NO reconnect
 * trigger at all, so even a write that DID get queued locally would sit
 * stuck as "pending" until an unrelated event happened to sync it.
 *
 * Both gaps are fixed together: modular mode now matches legacy mode's
 * own ONLINE_ONLY_SAFE standard, and the reconnect handler is mode-aware.
 */
const assert = require('assert');
const fs = require('fs');

const service = fs.readFileSync('firebase-service.js', 'utf8');

const gateBody = service.slice(service.indexOf('function writeGateStatus('), service.indexOf('function publishAccessState('));
assert(gateBody.length > 100, 'writeGateStatus() function body not found');

const modularBlock = gateBody.slice(gateBody.indexOf('if (MODULAR_MODE) {'), gateBody.indexOf('const syncState = getSyncState('));
assert(
  /if \(ONLINE_ONLY_SAFE && !navigator\.onLine\) return \{ allowed:false, reason:'offline_online_only' \};/.test(modularBlock),
  'modular-mode writes must only block offline when ONLINE_ONLY_SAFE (matching legacy mode\'s own standard), not unconditionally on !navigator.onLine'
);
assert(
  !/if \(!navigator\.onLine\) return \{ allowed:false, reason:'offline_online_only' \};/.test(modularBlock),
  'modular-mode must NOT unconditionally block every write while offline -- a worker with healthy local storage must be able to sell/close-cash/print offline like an owner can'
);

const onlineHandler = service.slice(service.indexOf('window.addEventListener("online"'), service.indexOf('window.addEventListener("online"') + 900);
assert(onlineHandler.includes('MODULAR_MODE'), 'the online-reconnect handler must be mode-aware');
assert(onlineHandler.includes('pushModularState("online_reconnect")'), 'reconnecting must flush a modular session\'s queued offline write via pushModularState(), not silently leave it pending until an unrelated event fires');
assert(onlineHandler.includes('pushLocalToFirestore("online_reconnect")'), 'reconnecting must still flush a legacy session\'s queued offline write (unchanged behavior)');

console.log('PASS r37 modular offline-write harness: modular/worker-mode writes are gated the same way legacy/owner writes are (ONLINE_ONLY_SAFE, not unconditional), and the online-reconnect handler flushes the queued write for both modes');
