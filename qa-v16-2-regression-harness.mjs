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
const config = fs.readFileSync('firebase-config.js', 'utf8');
const styles = fs.readFileSync('styles.css', 'utf8');
const runtime = fs.readFileSync('runtime-guard.js', 'utf8');
const tenantGuard = fs.readFileSync('p0-tenant-guard.js', 'utf8');
const robots = fs.readFileSync('robots.txt', 'utf8');
const sitemap = fs.readFileSync('sitemap.xml', 'utf8');

assert.equal(domain.APP_VERSION, '16.2');
assert.equal(domain.TRIAL_DAYS, 7);
assert.equal(domain.evaluateEntitlement({ status: 'active', plan: 'pro', planCode: 'pro_lifetime', billingStatus: 'lifetime', lifetime: true }).plan, 'pro');
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
assert(app.includes('function writeGateStatus()') && firebase.includes('window.click360WriteGate = writeGateStatus'), 'all writes use the unified effective access gate');
assert(app.includes("external.reason === 'read_only' && !access.readOnly") && app.includes('effective_access_allows'), 'stale readOnly cannot block founder/lifetime writes after effective access resolves');
assert(app.includes('function writeBlockMessage(') && app.includes('pending_remote_sync') && app.includes('offline_online_only'), 'write failures keep a specific user/support reason');
assert(firebase.includes('function resolveEffectiveReadOnly(') && firebase.includes('isEffectiveReadOnly()'), 'Firebase write guard shares the same readOnly precedence');
assert(tenantGuard.includes("rawPlan === 'pro_lifetime'") && tenantGuard.includes("billingStatus === 'lifetime'"), 'tenant guard fallback recognizes PRO Lifetime without V17 rules');
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
assert(app.includes('function showCashCloseSummary(')
  && app.includes("stage = 'cash_close_verify_closed'")
  && app.includes('showCashCloseSummary(closeDetails, committed);')
  && app.indexOf("const committed = await commitCriticalMutation(previousState, 'cash_closed'") < app.indexOf('showCashCloseSummary(closeDetails, committed);'), 'cash summary opens only after the close is persisted and verified');
assert(app.includes('const closeMovements = activeSession') && app.includes('movement.cashSessionId === activeSession.id'), 'a reopened register closes only its own movements');
assert(app.includes("cashSessionId: basis.activeSession?.id || ''") && app.includes('sale.cashSessionId'), 'sales and closing reports retain their cash session identity');
assert(app.includes("deletedById.get(`${businessId}:${p.id}`)"), 'product tombstones are scoped by business');
assert(!app.includes('Error de Renderizado') && !app.includes('e.stack || e.message}</pre>'), 'raw render errors are not shown to customers');
assert(!firebase.includes('UID de usuario:') && !firebase.includes('usando este UID en Firestore'));
assert(firebase.includes('profileUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()') && rules.includes('"profileUpdatedAt"'), 'profile freshness uses a server timestamp');
assert(app.includes("addAudit('business_profile_updated'") && app.includes("await commitCriticalMutation(previousState, 'business_profile_updated'"), 'business profile saves through the critical write path and active business verification');
assert(firebase.includes('reanchorTrustedClock') && firebase.includes('accessClockNow?.(previousAccess'), 'account listeners preserve a monotonic trusted clock');
assert(config.includes('window.location.hostname === "click-360.web.app" ? "click-360.web.app" : "click-360.firebaseapp.com"'), 'official Hosting uses same-origin Firebase Auth redirect helper for iOS/Brave');
assert(firebase.includes("AUTH_REDIRECT_PENDING_KEY = 'CLICK360:V16_2:AUTH_REDIRECT_PENDING'"));
assert(firebase.includes('await auth.getRedirectResult()'), 'redirect result is explicitly resolved before treating the user as unauthenticated');
assert(firebase.includes('AUTH_USER_NULL_AFTER_REDIRECT') && firebase.includes('AUTH_REDIRECT_NO_RESULT') && firebase.includes('AUTH_PERSISTENCE_FAILED'), 'redirect/persistence login loop codes are visible');
assert(!firebase.includes('if (auth.currentUser) await auth.signOut();'), 'login no longer signs out an existing user before Google can resolve redirect state');
for (const code of [
  'AUTH_ACCOUNT_NOT_FOUND',
  'AUTH_ACCESS_REJECTED',
  'AUTH_APPROVED_USERS_REJECTED',
  'AUTH_ACCOUNT_ACCESS_REJECTED',
  'FIRESTORE_PERMISSION_DENIED',
  'BOOTSTRAP_PREPARE_FAILED',
  'BOOTSTRAP_CREATE_FAILED',
  'UNKNOWN_LOGIN_GATE_FAILURE'
]) {
  assert(firebase.includes(code), `login gate exposes ${code}`);
}

assert(rules.includes('return hasAccountAccess() ? activeAccountOwnerUser() : legacyOwnerUser();'));
assert(rules.includes('!exists(/databases/$(database)/documents/approvedUsers/$(request.auth.uid))'));
assert(rules.includes('!exists(/databases/$(database)/documents/approvedUsersByEmail/$(request.auth.token.email))'));
assert(rules.includes('request.resource.data.ownerId == request.auth.uid'));
assert(rules.includes('request.resource.data.tenantKey == "owner:" + request.auth.uid + ":business:" + request.auth.uid'));
assert(rules.includes('data.planCode == "pro_lifetime"') && rules.includes('data.billingStatus == "lifetime"'), 'rules source matches the live PRO Lifetime compatibility hotfix');
assert(rules.includes('return ownerReadUser() && request.auth.uid == businessId;'), 'monolithic tenant reads are owner-only');
assert(!rules.includes('validWorkerStateUpdate') && !rules.includes('workerListMutationAllowed'), 'worker access to the monolithic tenant snapshot is disabled');

assert(app.includes('id="reminderDueDate" type="date"') && app.includes('id="reminderDueTime" type="time"'), 'reminder date and time use separate mobile-safe controls');
assert(!app.includes('id="reminderDue" type="datetime-local"'), 'wide datetime-local reminder input is not used');
assert(app.includes('class="reminderDueGrid"') && fs.readFileSync('styles.css', 'utf8').includes('.reminderDueGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))'), 'reminder due controls are responsive and bounded');
assert(app.includes('id="pImageGal" accept="image/*" hidden') && app.includes('id="pImageCam" accept="image/*" capture="environment" hidden'), 'product gallery and camera inputs are separate');
assert(app.includes('id="iImageGal" accept="image/*" hidden') && app.includes('id="iImageCam" accept="image/*" capture="environment" hidden'), 'invoice gallery and camera inputs are separate');
assert(app.includes("galleryInput.removeAttribute('capture')") && app.includes("cameraInput.setAttribute('capture', 'environment')"), 'gallery never forces capture and camera prefers environment capture');
assert(app.includes('event.target.value =') && app.includes('galleryInput.click()') && app.includes('cameraInput.click()'), 'image inputs clear their value and use independent handlers');
assert(styles.includes('bottom:calc(108px + var(--safe-bottom))') && styles.includes('.main{padding-bottom:calc(118px + var(--safe-bottom))'), 'mobile safe area keeps toasts and bottom nav away from critical actions');
assert(styles.includes('.cashClosePreview') && styles.includes('.cashCloseActions') && styles.includes('flex-wrap:wrap'), 'cash close modal buttons wrap on small screens');
assert(app.includes('Registro pausado') && app.includes('Disponible en una fase posterior'), 'workers remain paused with clearer UI instead of an active-looking form');
assert(runtime.includes('setReleaseMetadata') && runtime.includes('buildSha') && runtime.includes('displayMode') && runtime.includes('effectiveAccess') && runtime.includes('activeBusinessId'), 'runtime reports include release, PWA mode, route, access and sanitized business context');

for (const source of [app, firebase, html, worker]) {
  assert(!source.includes('mvp-launch-v16-1-2-r1'));
}
assert(!styles.includes('mvp-launch-v16-2-p0-r1'), 'CSS image assets must not retain the previous P0 cache version');
assert(styles.includes('assets/logo.png?v=commercial-1-0-5-stability-ops-r1') && styles.includes('assets/banner-click360-home.png?v=commercial-1-0-5-stability-ops-r1'));
assert(worker.includes("const CACHE = 'click360-commercial-1-0-5-stability-ops-r1'"));
assert(html.includes('<link rel="canonical" href="https://click-360.web.app/"'));
assert(robots.includes('https://click-360.web.app/sitemap.xml'));
assert(sitemap.includes('<loc>https://click-360.web.app/</loc>'));

console.log('PASS V16.2 regression: exact trial, identity resolution, cloud-only commit, worker access, rules, cache and canonical URL');
