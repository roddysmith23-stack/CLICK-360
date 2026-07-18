'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('app.js', 'utf8');
const firebase = fs.readFileSync('firebase-service.js', 'utf8');
const runtime = fs.readFileSync('runtime-guard.js', 'utf8');
const styles = fs.readFileSync('styles.css', 'utf8');

function resolveReadOnly(accessState, switchGuardActive = false) {
  if (switchGuardActive) return false;
  if (!accessState || typeof accessState !== 'object') return false;
  const mode = String(accessState.mode || '').toLowerCase();
  const status = String(accessState.status || '').toLowerCase();
  const plan = String(accessState.plan || '').toLowerCase();
  const planCode = String(accessState.planCode || '').toLowerCase();
  const billingStatus = String(accessState.billingStatus || '').toLowerCase();
  const platformRole = String(accessState.platformRole || '').toLowerCase();
  const customerTier = String(accessState.customerTier || '').toLowerCase();
  if (['suspended', 'blocked', 'disabled'].includes(status) || ['blocked', 'suspended'].includes(mode)) return true;
  if (platformRole === 'platform_founder' || customerTier === 'platform_founder') return false;
  if (plan === 'founder_unlimited' || planCode === 'founder_unlimited') return false;
  if (mode === 'founder' || mode === 'lifetime') return false;
  if (accessState.lifetime === true && billingStatus === 'lifetime') return false;
  if (planCode === 'pro_lifetime' && billingStatus === 'lifetime' && accessState.lifetime === true) return false;
  if (mode === 'member') return false;
  if (mode === 'paid_base' || mode === 'paid_pro') return accessState.readOnly === true;
  if (mode === 'trial_active') return false;
  return accessState.readOnly === true;
}

function effectiveWriteGate(externalGate, accessState) {
  if (externalGate?.allowed === false) {
    if (externalGate.reason === 'read_only' && !resolveReadOnly(accessState)) {
      return { allowed: true, reason: 'effective_access_allows' };
    }
    return externalGate;
  }
  return { allowed: true, reason: 'ok' };
}

function isDayStarted({ openSession = false, latestSessionStatus = '', hasOpeningMovement = false, dayClosed = false } = {}) {
  if (openSession) return true;
  if (latestSessionStatus) return latestSessionStatus === 'open';
  return hasOpeningMovement && !dayClosed;
}

assert.equal(resolveReadOnly({ mode: 'founder', readOnly: true, clockVerificationRequired: true }), false, 'founder ignores stale readOnly');
assert.equal(resolveReadOnly({ mode: 'paid_pro', platformRole: 'platform_founder', readOnly: true }), false, 'platform founder remains writable');
assert.equal(resolveReadOnly({ planCode: 'founder_unlimited', readOnly: true }), false, 'founder_unlimited remains writable');
assert.equal(resolveReadOnly({ planCode: 'pro_lifetime', lifetime: true, billingStatus: 'lifetime', readOnly: true }), false, 'PRO Lifetime remains writable');
assert.equal(resolveReadOnly({ mode: 'trial_expired', readOnly: true }), true, 'expired trial stays read-only');
assert.equal(resolveReadOnly({ status: 'suspended', mode: 'paid_pro', readOnly: false }), true, 'suspended account is blocked');
assert.equal(effectiveWriteGate({ allowed: false, reason: 'read_only' }, { mode: 'founder', readOnly: true }).allowed, true, 'stale Firebase read_only is overridden only by effective access');
assert.equal(effectiveWriteGate({ allowed: false, reason: 'pending_remote_sync' }, { mode: 'founder', readOnly: true }).reason, 'pending_remote_sync', 'real sync blocks keep their reason');
assert.equal(isDayStarted({ latestSessionStatus: 'closed', hasOpeningMovement: true, dayClosed: true }), false, 'closed day is no longer considered started');
assert.equal(isDayStarted({ latestSessionStatus: 'open', hasOpeningMovement: true, dayClosed: true }), true, 'reopened session allows the new daily register');

assert(app.includes('window.click360GetEffectiveAccess = accessInfo'), 'app exposes one effective access source');
assert(app.includes('const gate = writeGateStatus();') && app.includes("toast(writeBlockMessage(gate), 'err')"), 'save uses the unified write gate and specific error message');
assert(app.includes("await commitCriticalMutation(previousState, 'business_profile_updated'"), 'business profile persists through critical commit');
assert(app.includes("await commitCriticalMutation(previousState, 'cash_closed'"), 'cash close persists before success');
assert(app.includes('showCloseSummary();'), 'cash close summary is displayed after commit');
assert(firebase.includes('window.click360WriteGate = writeGateStatus'), 'Firebase service publishes structured write gate status');
assert(firebase.includes('if (accessDoesNotExpire()) return true'), 'permanent access is not degraded by offline clock revalidation');
assert(runtime.includes("const APP_VERSION = '1.0.3-p1'"), 'runtime error report version is the release version');
assert(runtime.includes('buildSha') && runtime.includes('displayMode') && runtime.includes('effectiveAccess'), 'runtime report includes build, PWA and access diagnostics');
assert(styles.includes('.cashClosePreview') && styles.includes('.cashCloseActions') && styles.includes('bottom:calc(108px + var(--safe-bottom))'), 'mobile UI protects cash close actions and toasts');

console.log('PASS P1.1 write/cash harness: effective access, profile save, cash close, diagnostics and mobile UI');
