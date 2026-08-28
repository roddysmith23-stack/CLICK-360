import assert from 'node:assert/strict';

/**
 * PERMANENT REGRESSION GUARD (P0, 2026-08-28 SHARY incident).
 *
 * v16-domain.js's evaluateEntitlement() is the primary entitlement
 * evaluator. p0-tenant-guard.js's evaluateAccountAccess() is a standalone
 * fallback used only when window.CLICK360_V16_DOMAIN has not yet
 * registered (see accessStateFromData() in firebase-service.js). Because
 * the fallback exists precisely for when the primary is unavailable, it
 * cannot delegate to it -- it must be an independently-correct duplicate
 * of the same commercial contract.
 *
 * Before this harness existed, evaluateAccountAccess() had no branch for
 * 'founder_legacy' at all, silently misclassifying a real, valid,
 * permanent-access customer (SHARY) as allowed:false whenever the
 * fallback path was consulted -- the proven root cause of the real
 * production incident where her login intermittently failed with
 * AUTH_ACCOUNT_ACCESS_REJECTED and her inventory saves were blocked by
 * the same failure (writeGateStatus's very first check is AUTH_APPROVED,
 * never set while login is rejected). This harness asserts the two
 * evaluators produce a commercially COMPATIBLE decision (allowed,
 * readOnly) for every status either one currently recognizes, so they can
 * never silently diverge again.
 */

await import('./v16-domain.js');
await import('./p0-tenant-guard.js');
const domain = globalThis.CLICK360_V16_DOMAIN;
const guard = globalThis.CLICK360_P0_TENANT_GUARD;
assert(domain, 'v16-domain.js must register CLICK360_V16_DOMAIN');
assert(guard, 'p0-tenant-guard.js must register CLICK360_P0_TENANT_GUARD');

const NOW = 1_800_000_000_000; // fixed reference instant, arbitrary but stable
const DAY = 24 * 60 * 60 * 1000;

function compatible(primary, fallback) {
  return primary.allowed === fallback.allowed
    && primary.readOnly === fallback.readOnly
    && primary.mode === fallback.mode
    && primary.plan === fallback.plan;
}

function assertParity(label, data, serverNowMs = NOW) {
  const primary = domain.evaluateEntitlement(data, serverNowMs);
  const fallback = guard.evaluateAccountAccess(data, serverNowMs, 7);
  assert.ok(
    compatible(primary, fallback),
    `${label}: evaluators DISAGREE on commercial decision.\n` +
    `  input: ${JSON.stringify(data)}\n` +
    `  v16-domain.evaluateEntitlement  -> allowed=${primary.allowed} readOnly=${primary.readOnly} mode=${primary.mode}\n` +
    `  p0-tenant-guard.evaluateAccountAccess -> allowed=${fallback.allowed} readOnly=${fallback.readOnly} mode=${fallback.mode}`
  );
  return { primary, fallback };
}

// --- founder_legacy: the proven incident. Must be allowed:true, readOnly:false,
// unconditionally -- no dependency on expiresAt/clock/grace/trial fields. ---
{
  const { primary, fallback } = assertParity('founder_legacy (bare)', { status: 'founder_legacy' });
  assert.equal(primary.allowed, true);
  assert.equal(primary.readOnly, false);
  assert.equal(fallback.allowed, true);
  assert.equal(fallback.readOnly, false);
}
assertParity('founder_legacy + plan mirror', { status: 'founder_legacy', plan: 'founder_legacy' });
assertParity('founder_legacy + planCode mirror', { status: 'founder_legacy', planCode: 'founder_legacy' });
assertParity('founder_legacy + stray unrelated expiresAt (must not matter)', { status: 'founder_legacy', expiresAt: NOW - DAY });
assertParity('founder_legacy + stray unrelated expiresAt in future (must not matter)', { status: 'founder_legacy', expiresAt: NOW + 365 * DAY });
assertParity('founder_legacy via plan only, unrecognized status', { status: 'anything_else', plan: 'founder_legacy' });

// --- founder (internal/platform, distinct from founder_legacy) ---
assertParity('founder status', { status: 'founder' });
assertParity('founder plan', { status: 'weird', plan: 'founder' });

// --- lifetime ---
assertParity('lifetime status', { status: 'lifetime' });
assertParity('lifetime flag + active + pro_lifetime planCode', { status: 'active', planCode: 'pro_lifetime', lifetime: true, billingStatus: 'lifetime' });
assertParity('pro_lifetime not yet activated', { status: 'active', planCode: 'pro_lifetime', lifetime: false });

// --- trial / trial_active (real Timestamp-shaped trialStartedAt, not the legacy *Ms field) ---
assertParity('trial active, 2 of 7 days used', { status: 'trial', trialStartedAt: NOW - 2 * DAY }, NOW);
assertParity('trial expired, 8 of 7 days used', { status: 'trial', trialStartedAt: NOW - 8 * DAY }, NOW);
assertParity('trial_active alias', { status: 'trial_active', trialStartedAt: NOW - DAY }, NOW);
assertParity('trial with Firestore-Timestamp-shaped trialStartedAt', { status: 'trial', trialStartedAt: { seconds: Math.floor((NOW - 2 * DAY) / 1000), nanoseconds: 0 } }, NOW);
{
  // Must actually read the real field name (trialStartedAt), not the
  // legacy trialStartedAtMs -- this was one of the divergences fixed here.
  const data = { status: 'trial', trialStartedAt: NOW - 2 * DAY };
  const primary = domain.evaluateEntitlement(data, NOW);
  const fallback = guard.evaluateAccountAccess(data, NOW, 7);
  assert.equal(primary.readOnly, false, 'sanity: 2-day-old trial must be active in the primary evaluator');
  assert.equal(fallback.readOnly, false, 'fallback must also see an active trial from the real trialStartedAt field, not report it as instantly expired');
}

// --- expired / trial_expired ---
assertParity('expired status', { status: 'expired' });
assertParity('trial_expired status', { status: 'trial_expired' });

// --- active / paid_* with subscription expiry ---
assertParity('active base, no expiry set', { status: 'active', plan: 'base' });
assertParity('paid_base, not yet expired', { status: 'paid_base', expiresAt: NOW + 30 * DAY }, NOW);
assertParity('paid_base, expired', { status: 'paid_base', expiresAt: NOW - DAY }, NOW);
assertParity('paid_pro, not yet expired', { status: 'paid_pro', expiresAt: NOW + 30 * DAY }, NOW);
assertParity('paid_pro, expired', { status: 'paid_pro', expiresAt: NOW - DAY }, NOW);
assertParity('paid_business, not yet expired', { status: 'paid_business', planCode: 'business', expiresAt: NOW + 30 * DAY }, NOW);
assertParity('paid_business, expired', { status: 'paid_business', planCode: 'business', expiresAt: NOW - DAY }, NOW);
assertParity('paid_enterprise, not yet expired', { status: 'paid_enterprise', planCode: 'enterprise', expiresAt: NOW + 30 * DAY }, NOW);
assertParity('paid_enterprise, expired', { status: 'paid_enterprise', planCode: 'enterprise', expiresAt: NOW - DAY }, NOW);
assertParity('active unknown plan normalizes to base', { status: 'active', planCode: 'unknown_legacy_value' }, NOW);
assertParity('paid_base with seconds-shaped server time', { status: 'paid_base', expiresAt: NOW - DAY }, Math.floor(NOW / 1000));
assertParity('trial with seconds-shaped server time', { status: 'trial', trialStartedAt: NOW - 2 * DAY }, Math.floor(NOW / 1000));

// --- member ---
assertParity('member status', { status: 'member' });

// --- pending / unrecognized (both must agree this is NOT allowed) ---
{
  const { primary, fallback } = assertParity('unrecognized status', { status: 'some_unknown_future_status' });
  assert.equal(primary.allowed, false);
  assert.equal(fallback.allowed, false);
}
assertParity('no status at all', {});

console.log('qa-entitlement-evaluator-parity-harness: PASS -- v16-domain.evaluateEntitlement and p0-tenant-guard.evaluateAccountAccess agree on allowed/readOnly/mode/plan for every status checked, including founder_legacy.');
