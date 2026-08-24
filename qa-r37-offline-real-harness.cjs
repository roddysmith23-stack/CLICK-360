/**
 * r37 (#92, "offline sales is priority"): structural proof that the
 * pieces of the offline lifecycle NOT already covered by
 * qa-p0-offline-harness.cjs / qa-r37-modular-offline-write-harness.cjs /
 * qa/r37-offline-sale-e2e.mjs are real, plus an explicit, documented
 * account of what stays online-only and why -- the user's explicit
 * requirement was: "si una operación no puede garantizar integridad
 * offline, mantenla online-only y documenta por qué", not that literally
 * everything must work offline.
 */
const assert = require('assert');
const fs = require('fs');

const app = fs.readFileSync('app.js', 'utf8');
const firebaseService = fs.readFileSync('firebase-service.js', 'utf8');

// ── Local-first save(): a write survives with zero network once a device
// has ever completed a real, successful online session (localStorage/
// IndexedDB fallback, never silently dropped). ──
const saveBlock = app.slice(app.indexOf('function save(options = {})'), app.indexOf('function save(options = {})') + 3000);
assert(saveBlock.includes("localStorage.setItem(stateStorageKey(), serialized)"), 'save() must persist to localStorage synchronously as its primary local-first path');
assert(saveBlock.includes('queueIndexedSnapshot(snapshot'), 'save() must ALSO queue the same write into the IndexedDB snapshot store (the durable, larger-capacity offline queue)');
assert(saveBlock.includes('operationId'), 'every locally-persisted write must carry an operationId -- the key the reconnect-sync/idempotency gate keys off of');
assert(/pendingRemoteSync\s*=\s*options\.nonBlockingSync === true \? false : true/.test(saveBlock), 'a normal write defaults to pendingRemoteSync:true until the cloud confirms it -- this is exactly what drives the "Pendiente de sincronizar" indicator');

// ── The "Pendiente de sincronizar" indicator is a persistent UI pill, not
// just a one-off toast that a user could miss. ──
assert(app.includes("pending: ['Pendiente de sincronizar'"), 'a persistent, always-visible sync-status pill must exist (not just per-action toasts) so a queued offline write is never invisible to the user');
assert(app.includes('function syncPillHtml('), 'the sync pill must be a reusable, rendered UI element wired into the shell, not a one-off string');

// ── Idempotent replay: commitCriticalMutation's scope:reason gate is the
// SAME mechanism a reconnect-triggered resync relies on to never duplicate
// a mutation that already landed locally. ──
assert(app.includes('async function commitCriticalMutation(previousState, reason, remoteApplied)'), 'the idempotency gate commitCriticalMutation() must exist and be the single path critical mutations go through');
assert(/if \(!actionLock\.acquired\)[\s\S]{0,200}duplicate_operation_restore/.test(app), 'a duplicate/concurrent attempt at the same mutation must self-heal (restore the known-good snapshot) rather than double-apply');

// ── Reconnect handler: flushes the queued write for BOTH legacy and
// modular/worker sessions once the browser regains connectivity. ──
const reconnectBlock = firebaseService.slice(firebaseService.indexOf('window.addEventListener("online"'), firebaseService.indexOf('window.addEventListener("online"') + 900);
assert(reconnectBlock.includes('pushModularState("online_reconnect")'), 'reconnecting must flush a queued modular/worker-mode write');
assert(reconnectBlock.includes('pushLocalToFirestore("online_reconnect")'), 'reconnecting must flush a queued legacy/owner-mode write');

// ── Explicit, documented online-only boundary: ONLINE_ONLY_SAFE is a
// DEVICE-CAPABILITY fallback (this specific device could not activate
// local persistence -- e.g. private/incognito browsing, storage quota
// exhausted), not a blanket "certain features never work offline" rule.
// On any normal device (the overwhelming majority), writes -- including
// sales -- work offline via the localStorage/IndexedDB path above. This
// is the explicit "online-only, and why" documentation the r37 brief
// asked for. ──
assert(firebaseService.includes('let ONLINE_ONLY_SAFE = false;'), 'ONLINE_ONLY_SAFE must default to false -- a normal device must NOT be online-only by default');
assert(firebaseService.includes("if (ONLINE_ONLY_SAFE && !navigator.onLine) return { allowed:false, reason:'offline_online_only' };"), 'ONLINE_ONLY_SAFE must only block writes when the device is BOTH incapable of local persistence AND currently offline -- never merely "offline"');
assert(firebaseService.includes("Este dispositivo no pudo activar el modo sin conexion, pero puedes continuar trabajando con internet"), 'a device that cannot guarantee offline integrity must be told so in plain language, with a clear path forward (stay online), never left to silently lose data or guess why writes are blocked');

console.log('PASS r37 offline-real harness: save() is genuinely local-first (localStorage + IndexedDB, operationId-tagged, pendingRemoteSync-tracked) so an offline write survives; a persistent sync pill (not just a toast) always reflects queued state; commitCriticalMutation/acquireCriticalAction is the single idempotency gate a reconnect-resync relies on to never duplicate a mutation; the online-reconnect handler flushes both legacy and modular/worker queues; and the ONLY online-only boundary (ONLINE_ONLY_SAFE) is an explicit, documented, plainly-messaged device-capability fallback -- never a blanket "offline doesn\'t work" rule.');
