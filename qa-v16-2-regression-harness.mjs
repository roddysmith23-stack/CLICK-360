import assert from 'node:assert/strict';
import fs from 'node:fs';

await import('./v16-domain.js');
const domain = globalThis.CLICK360_V16_DOMAIN;
const app = fs.readFileSync('app.js', 'utf8');
const firebase = fs.readFileSync('firebase-service.js', 'utf8');
const flow = fs.readFileSync('access-flow.js', 'utf8');
const rules = fs.readFileSync('firestore.rules', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const worker = fs.readFileSync('service-worker.js', 'utf8');
const storage = fs.readFileSync('v16-storage.js', 'utf8');
const robots = fs.readFileSync('robots.txt', 'utf8');
const sitemap = fs.readFileSync('sitemap.xml', 'utf8');

assert.equal(domain.APP_VERSION, '16.2');
assert.equal(domain.TRIAL_DAYS, 7);
assert.equal(domain.evaluateEntitlement({ status: 'active', plan: 'pro', planCode: 'pro_lifetime', lifetime: true }).plan, 'pro');
assert.equal(domain.evaluateEntitlement({ status: 'active', planCode: 'founder_unlimited', lifetime: true }).mode, 'founder');
assert.equal(domain.timestampMs(1_800_000_000), 1_800_000_000_000);
assert.equal(domain.evaluateEntitlement({ status: 'trial', trialStartedAt: 1_800_000_000, trialDays: 30 }, 1_800_000_000_000).trialEndsAtMs, 1_800_604_800_000);

assert(flow.includes("IDENTITY_RECONCILIATION_REQUIRED: 'identity_reconciliation_required'"));
assert(flow.includes("TRIAL_ACTIVE: 'trial_active'") && flow.includes("PAID_BASE: 'paid_base'") && flow.includes("MEMBER: 'member'"));
assert(firebase.includes("trialRequested && account.status === 'not_found' && APPROVED_LOOKUP_STATUS === 'not_found'"));
assert(firebase.includes("APPROVED_LOOKUP_STATUS !== 'not_found'"), 'trial bootstrap is blocked until historical identity is definitively absent');
assert(firebase.includes('ownerId: user.uid') && firebase.includes('tenantKey: tenantKeyFor(user.uid, user.uid)'));
assert(firebase.includes("setPendingUser(user, data, 'worker_module_upgrade')"), 'workers cannot open the monolithic owner snapshot');

assert(app.includes("toast('Guardando el cambio de forma segura...', 'ok')"));
assert(!app.includes('Cambio guardado en la nube. El modo sin conexion no esta disponible'), 'online-only mode never announces success before commit');
assert(firebase.includes("pushLocalToFirestore('online_only_change').then"));
assert(app.includes("window.addEventListener('click360-online-only-commit'"));
assert(app.includes('onlineOnlyCommitCheckpoints.get(key)') && app.includes('checkpoint.previousState'), 'failed cloud-only writes restore only their correlated confirmed state');
assert(app.includes('function localStorageReady(') && app.includes("mode: navigator.onLine ? 'online_only_safe' : 'unavailable'"));
assert(app.includes("mode: 'localstorage_cache'") && app.includes('localFallbackReady'), 'healthy localStorage remains an offline fallback when IndexedDB fails');
assert(app.includes('async function commitCriticalMutation(') && app.includes("await window.click360SyncNow()"), 'critical commercial changes wait for cloud confirmation when online');
assert(app.includes('const actionLock = acquireCriticalAction(reason)') && app.includes('duplicate_operation_restore'), 'duplicate critical actions restore the first in-flight operation');
assert(app.includes('deferSync: true') && app.includes("options.deferSync !== true"), 'critical mutations do not start a second automatic cloud write');
assert(app.includes('allowIndexedDbOffline: true') && app.includes('pendingRemoteSync: true'), 'offline critical changes require a verified pending snapshot');
assert(firebase.includes("source: 'indexeddb_recovery'") && firebase.includes('offlineRecoveryDecision') && firebase.includes("recoveryDecision.action === 'conflict'"), 'pending offline data cannot be overwritten by a changed remote revision');
assert(app.includes('window.click360PrepareInitialTenantState = async function'));
assert(firebase.includes('click360PrepareInitialTenantState?.(ACTIVE_CONTEXT)'));
assert(!firebase.includes('const localPersisted = window.click360PersistTenantState?.() === true'), 'initial bootstrap no longer passes through the AUTH_APPROVED mutation gate');
assert(storage.includes('pendingRemoteSync: metadata.pendingRemoteSync === true') && storage.includes('baseRevision: Number(metadata.baseRevision || 0)'), 'IndexedDB persists pending state and its remote base revision');
assert(firebase.includes('operationId: String(event.detail?.operationId') && app.includes('commitCheckpointKey(event.detail || {})'), 'cloud-only rollback is correlated to the exact operation');
assert(app.includes("movement.operationId === operationId") && app.includes("item.status === 'cancelled'"), 'cash and cancellation paths have idempotent verification markers');
assert(app.includes('function latestCashSession(') && app.includes("return session?.status === 'open' ? session : null;"), 'cash operations use the latest session state');
assert(app.includes('const closeMovements = activeSession') && app.includes('movement.cashSessionId === activeSession.id'), 'a reopened register closes only its own movements');
assert(app.includes("cashSessionId: activeSession?.id || ''") && app.includes('sale.cashSessionId'), 'sales and closing reports retain their cash session identity');
assert(app.includes("deletedById.get(`${businessId}:${p.id}`)"), 'product tombstones are scoped by business');
assert(!app.includes('Error de Renderizado') && !app.includes('e.stack || e.message}</pre>'), 'raw render errors are not shown to customers');
assert(!firebase.includes('UID de usuario:') && !firebase.includes('usando este UID en Firestore'));
assert(firebase.includes('profileUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()') && rules.includes('"profileUpdatedAt"'), 'profile freshness uses a server timestamp');
assert(firebase.includes('reanchorTrustedClock') && firebase.includes('accessClockNow?.(previousAccess'), 'account listeners preserve a monotonic trusted clock');

assert(rules.includes('return hasAccountAccess() ? activeAccountOwnerUser() : legacyOwnerUser();'));
assert(rules.includes('!exists(/databases/$(database)/documents/approvedUsers/$(request.auth.uid))'));
assert(rules.includes('!exists(/databases/$(database)/documents/approvedUsersByEmail/$(request.auth.token.email))'));
assert(rules.includes('request.resource.data.ownerId == request.auth.uid'));
assert(rules.includes('request.resource.data.tenantKey == "owner:" + request.auth.uid + ":business:" + request.auth.uid'));
assert(rules.includes('return ownerReadUser() && request.auth.uid == businessId;'), 'monolithic tenant reads are owner-only');
assert(!rules.includes('validWorkerStateUpdate') && !rules.includes('workerListMutationAllowed'), 'worker access to the monolithic tenant snapshot is disabled');

for (const source of [app, firebase, html, worker]) {
  assert(!source.includes('mvp-launch-v16-1-2-r1'));
}
assert(worker.includes("const CACHE = 'click360-mvp-launch-v16-2-r1'"));
assert(html.includes('<link rel="canonical" href="https://click-360.web.app/"'));
assert(robots.includes('https://click-360.web.app/sitemap.xml'));
assert(sitemap.includes('<loc>https://click-360.web.app/</loc>'));

console.log('PASS V16.2 regression: exact trial, identity resolution, cloud-only commit, worker access, rules, cache and canonical URL');
