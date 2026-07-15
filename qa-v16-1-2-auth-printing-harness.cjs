const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const accessSource = fs.readFileSync('access-flow.js', 'utf8');
const printingSource = fs.readFileSync('printing-service.js', 'utf8');
const firebase = fs.readFileSync('firebase-service.js', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const worker = fs.readFileSync('service-worker.js', 'utf8');

const accessRoot = {};
vm.runInNewContext(accessSource, { window: accessRoot, globalThis: accessRoot, Set, Object, Date }, { filename: 'access-flow.js' });
const flow = accessRoot.CLICK360_ACCESS_FLOW;
assert(flow, 'access state machine loads');
assert.deepEqual(Array.from(Object.values(flow.STATES)), [
  'loading', 'unauthenticated', 'authenticated_resolving', 'invalid_invitation', 'recoverable_error',
  'authenticated_no_access', 'identity_reconciliation_required', 'pending', 'blocked',
  'legacy_migration_required', 'online_only_safe', 'founder', 'paid_base', 'paid_pro',
  'lifetime', 'trial_active', 'trial_expired', 'member', 'ready'
]);
for (const state of ['unauthenticated', 'invalid_invitation', 'recoverable_error', 'authenticated_no_access']) {
  assert.equal(flow.gatePolicy(state, true).showPublicActions, true, `${state} keeps public actions`);
}
assert.equal(flow.gatePolicy('invalid_invitation', true).showRetry, true);
assert.equal(flow.gatePolicy('recoverable_error', true).showRetry, true);
assert.equal(flow.gatePolicy('blocked', true).showPublicActions, false);
assert.equal(flow.gatePolicy('identity_reconciliation_required', true).showRetry, true);
assert.equal(flow.stateForAccess({ mode: 'founder' }), 'founder');
assert.equal(flow.stateForAccess({ mode: 'paid_base' }), 'paid_base');
assert.equal(flow.stateForAccess({ mode: 'trial_active' }), 'trial_active');
assert.equal(flow.stateForAccess({ mode: 'member' }), 'member');
assert.equal(flow.stateForAccess({ mode: 'founder' }, true), 'online_only_safe');

const now = Date.now();
const explicit = { ownerId: 'owner-a', tokenLength: 12, sessionId: 'session-a', createdAtMs: now - 1000 };
const invite = { flow: 'invite', ownerId: 'owner-a', inviteToken: '123456789012', inviteSession: 'session-a' };
assert.equal(flow.invitationIntentValid(explicit, invite, now), true);
assert.equal(flow.invitationIntentValid(explicit, { ...invite, inviteSession: 'stale-session' }, now), false);
assert.equal(flow.invitationIntentValid({ ...explicit, createdAtMs: now - 31 * 60 * 1000 }, invite, now), false);
assert.deepEqual(Array.from(flow.RESOLUTION_ORDER), [
  'firebase_auth_uid', 'account_access', 'entitlement', 'tenant_state', 'legacy_guard',
  'approved_user_compatibility', 'explicit_invitation'
]);

const primaryAccount = firebase.indexOf('const account = await resolveAccountAccess(user, epoch, { allowCreate: false');
const compatibilityAccount = firebase.indexOf('let approved = await isApprovedUser(user, epoch)');
const explicitInvitation = firebase.indexOf('const invitation = await acceptInvitationFromUrl(user, epoch)');
assert(primaryAccount > 0 && primaryAccount < compatibilityAccount && compatibilityAccount < explicitInvitation, 'UID account access is resolved before compatibility and explicit invitations');
assert(firebase.includes("if (account.status === 'ready' && account.state?.allowed)"));
assert(firebase.includes('getIdTokenResult?.(true)'), 'time-limited access uses a fresh Google server-issued token clock');
assert(firebase.includes('createdNow ? serverTimestampMs(data.lastSeenAt) : await trustedAuthServerNowMs(user)'));
assert(firebase.indexOf('if (!unlockApp()) return false') < firebase.indexOf('touchAccountAccessActivity(user, expectedEpoch)'), 'lastSeen activity is secondary to successful entry');
assert(!firebase.includes('message.includes('), 'gate actions never depend on customer-facing wording');
assert(!firebase.toLowerCase().includes('shary10mmvv@gmail.com'), 'no customer email is hard-coded into access logic');
assert(firebase.indexOf('const current = await transaction.get(stateDoc)') < firebase.indexOf('transaction.set(stateDoc, documentData)'), 'first tenant bootstrap reads and validates before its transactional write');
assert(firebase.includes("if (reason === 'initial_tenant_seed' && expectedRevision === 0)"), 'a concurrent first tenant is loaded instead of overwritten');
assert(!firebase.includes('STATE_DOC.set('), 'first tenant bootstrap cannot blindly overwrite a tenant');
assert(firebase.includes('inviteSession') && firebase.includes("sessionStorage.setItem(EXPLICIT_INVITATION_KEY"));
assert(firebase.includes("['flow', 'invite', 'ownerId', 'inviteHash', 'inviteToken', 'token', 'inviteSession']"));
assert(firebase.includes("ACCESS_UI_STATES.INVALID_INVITATION") && firebase.includes('Continuar con mi cuenta'));
assert(firebase.includes('const schedulerKey = context ? `${AUTH_EPOCH}:${context.authUid}:${context.tenantKey}`') && firebase.includes('isActiveSyncScope(context, stateDoc, expectedEpoch, user)'));

const printRoot = { navigator: {}, isSecureContext: true, print() {}, addEventListener() {} };
vm.runInNewContext(printingSource, {
  window: printRoot,
  globalThis: printRoot,
  Object,
  Map,
  Promise,
  String,
  Number,
  Array,
  Math,
  setTimeout() { return 1; },
  Node: function Node() {}
}, { filename: 'printing-service.js' });
const printing = printRoot.CLICK360_PRINTING;
assert.equal(printing.VERSION, '16.2');
for (const method of ['providers', 'status', 'discover', 'connect', 'disconnect', 'forgetDevice', 'print', 'printLabel', 'printReceipt', 'testPrint']) {
  assert.equal(typeof printing[method], 'function', `printing provider API exposes ${method}`);
}
const m02 = printing.status('m02x-bluetooth');
assert.equal(m02.supported, false);
assert.equal(m02.state, 'validation_required');
assert.match(m02.reason, /protocolo/i);
assert.equal(printing.status('system').supported, true);
assert(printingSource.includes("root.removeEventListener('afterprint', clean)"), 'system print cleanup cannot leak into a later job');
assert(printingSource.includes("job.media === 'label' ? [width, height]"), 'label PDF preserves the requested physical dimensions');

assert(app.includes('function printingView()') && app.includes('Centro de impresión'));
assert(app.includes('printerForget') && app.includes('printingCopies'));
assert(app.includes('salesForBiz().filter') && app.includes("s.businessId !== business.id"), 'receipt lookup is limited to the current business');
assert(app.includes('Comprobante interno. No válido como factura electrónica.'));
assert(!/Heredar(?: del)? negocio/i.test(app), 'internal inheritance wording is absent from customer UI');
assert.equal((app.match(/data-clock-format="full"/g) || []).length, 1, 'date and time have one primary rendered location');
assert(html.indexOf('access-flow.js') < html.indexOf('firebase-service.js'));
assert(html.indexOf('printing-service.js') < html.indexOf('app.js'));
assert(worker.includes("'./access-flow.js'") && worker.includes("'./printing-service.js'"));

console.log('PASS V16.2 auth: explicit states, UID-first resolution, stale-invite defense, server clock and secondary lastSeen');
console.log('PASS V16.2 printing: provider contract, safe M02X status, system/PDF fallback and current-business receipts');
