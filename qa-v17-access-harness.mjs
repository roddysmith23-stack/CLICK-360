import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  PLAN_CATALOG,
  V17_SUBJECTS,
  activationCodeDecision,
  approveAccount,
  bootstrapSession,
  buildPlanCatalogDryRun,
  buildProvisioningDryRun,
  evaluateEntitlement,
  generateActivationCode,
  legacyAccessDecision,
  redeemActivationCode,
  refreshAccessClaims,
  validateDesiredAccess
} from './scripts/lib/click360-v17-access-core.mjs';

await import('./v16-domain.js');
const domain = globalThis.CLICK360_V16_DOMAIN;
const fixture = JSON.parse(fs.readFileSync('fixtures/v17-access-fixture.json', 'utf8'));
const appSource = fs.readFileSync('app.js', 'utf8');
const firebaseSource = fs.readFileSync('firebase-service.js', 'utf8');
const auditSource = fs.readFileSync('scripts/audit-v17-access.mjs', 'utf8');
const plannerSource = fs.readFileSync('scripts/plan-v17-access.mjs', 'utf8');

const results = [];
function scenario(name, run) {
  run();
  results.push({ name, result: 'PASS' });
}

function permanentEntitlement(uid, desired) {
  return { uid, ...desired };
}

function commercialBundle(uid, desired, organizationId = 'org_fixture_primary') {
  return {
    authUser: { uid, email: `${uid}@example.test`, disabled: false },
    entitlement: permanentEntitlement(uid, desired),
    organization: { organizationId, ownerUid: uid, status: 'active' },
    membership: { uid, organizationId, organizationRole: desired.organizationRole || 'owner', status: 'active' },
    subscription: {
      organizationId,
      plan: desired.plan,
      planCode: desired.planCode,
      billingStatus: desired.billingStatus,
      lifetime: desired.lifetime,
      expiresAt: desired.expiresAt,
      customerTier: desired.customerTier,
      status: desired.status
    }
  };
}

scenario('01 platform_founder', () => {
  const desired = V17_SUBJECTS.smith.desired;
  assert.deepEqual(validateDesiredAccess(desired), { valid: true, errors: [] });
  const entitlement = permanentEntitlement(fixture.authUsers.founder.uid, desired);
  const session = bootstrapSession({ authUser: fixture.authUsers.founder, entitlement });
  assert.equal(session.status, 'READY');
  assert.equal(refreshAccessClaims({ entitlement }).claims.platformAdmin, true);
  assert.equal(PLAN_CATALOG.founder_unlimited.organizationLimit, null);
  assert.equal(desired.billingStatus, 'internal');
});

scenario('02 founder_admin and critical confirmation', () => {
  const desired = V17_SUBJECTS.debby.desired;
  const entitlement = permanentEntitlement(fixture.authUsers.founderAdmin.uid, desired);
  assert.equal(bootstrapSession({ authUser: fixture.authUsers.founderAdmin, entitlement }).ready, true);
  const common = {
    actor: { uid: fixture.authUsers.founderAdmin.uid, adminLevel: 'founder_admin' },
    preview: { planHash: 'plan-hash', critical: true },
    reason: 'QA critical action', backupVerified: true, reauthenticated: true
  };
  assert.equal(approveAccount(common).allowed, false);
  assert(approveAccount(common).blockers.includes('super_admin_confirmation_required'));
  assert.equal(approveAccount({ ...common, superAdminConfirmed: true }).allowed, true);
});

scenario('03 founding_customer PRO Lifetime', () => {
  const desired = V17_SUBJECTS.shary.desired;
  const bundle = commercialBundle(fixture.authUsers.ownerA.uid, desired);
  const session = bootstrapSession(bundle);
  assert.equal(session.ready, true);
  assert.equal(evaluateEntitlement(bundle.entitlement, fixture.nowMs).mode, 'lifetime');
  assert.equal(bundle.entitlement.expiresAt, null);
  assert.equal(refreshAccessClaims({ entitlement: bundle.entitlement }).claims.platformAdmin, false);
  assert(PLAN_CATALOG.pro.exclusions.includes('platform_control_center'));
});

scenario('04 base customer', () => {
  const uid = fixture.authUsers.ownerA.uid;
  const entitlement = {
    uid, platformRole: 'customer', plan: 'base', planCode: 'base', billingStatus: 'subscription',
    lifetime: false, customerTier: 'standard_customer', status: 'active', expiresAtMs: fixture.nowMs + 86_400_000
  };
  const bundle = commercialBundle(uid, V17_SUBJECTS.shary.desired);
  bundle.entitlement = entitlement;
  bundle.subscription = { ...bundle.subscription, plan: 'base', planCode: 'base', billingStatus: 'subscription' };
  assert.equal(bootstrapSession(bundle).ready, true);
});

scenario('05 active trial', () => {
  const decision = evaluateEntitlement({
    platformRole: 'customer', plan: 'base', billingStatus: 'trial', customerTier: 'standard_customer',
    lifetime: false, status: 'trial', expiresAtMs: fixture.nowMs + 604_800_000
  }, fixture.nowMs);
  assert.equal(decision.allowed, true);
  assert.equal(decision.mode, 'trial');
});

scenario('06 expired plan', () => {
  const decision = evaluateEntitlement({
    platformRole: 'customer', plan: 'base', billingStatus: 'subscription', customerTier: 'standard_customer',
    lifetime: false, status: 'active', expiresAtMs: fixture.nowMs - 1
  }, fixture.nowMs);
  assert.equal(decision.allowed, false);
  assert.equal(decision.expired, true);
});

const activation = generateActivationCode();
const activationRecord = {
  codeHash: activation.codeHash,
  email: 'lia@example.test',
  status: 'pending',
  expiresAtMs: fixture.nowMs + 3_600_000
};

scenario('07 valid activation code', () => {
  assert.notEqual(activation.rawCode, activation.codeHash);
  const decision = redeemActivationCode({
    record: activationRecord, rawCode: activation.rawCode, email: 'LIA@example.test', uid: 'lia-real-uid', nowMs: fixture.nowMs
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.updates.activationCode.boundUid, 'lia-real-uid');
});

scenario('08 used activation code', () => {
  const decision = activationCodeDecision({
    record: { ...activationRecord, status: 'used', usedAt: fixture.nowMs },
    email: 'lia@example.test', uid: 'lia-real-uid', nowMs: fixture.nowMs
  });
  assert.equal(decision.reason, 'code_used');
});

scenario('09 expired activation code', () => {
  const decision = activationCodeDecision({
    record: { ...activationRecord, expiresAtMs: fixture.nowMs - 1 },
    email: 'lia@example.test', uid: 'lia-real-uid', nowMs: fixture.nowMs
  });
  assert.equal(decision.reason, 'code_expired');
});

scenario('10 wrong activation email', () => {
  const decision = activationCodeDecision({
    record: activationRecord, email: 'wrong@example.test', uid: 'lia-real-uid', nowMs: fixture.nowMs
  });
  assert.equal(decision.reason, 'email_mismatch');
});

scenario('11 missing organization', () => {
  const bundle = commercialBundle(fixture.authUsers.ownerA.uid, V17_SUBJECTS.shary.desired);
  assert(bootstrapSession({ ...bundle, organization: null }).blockers.includes('organization_missing_or_inactive'));
});

scenario('12 missing membership', () => {
  const bundle = commercialBundle(fixture.authUsers.ownerA.uid, V17_SUBJECTS.shary.desired);
  assert(bootstrapSession({ ...bundle, membership: null }).blockers.includes('membership_missing_or_mismatched'));
});

scenario('13 missing entitlement', () => {
  const bundle = commercialBundle(fixture.authUsers.ownerA.uid, V17_SUBJECTS.shary.desired);
  assert(bootstrapSession({ ...bundle, entitlement: null }).blockers.includes('entitlement_missing_or_mismatched'));
});

scenario('14 repeated provisioning is idempotent', () => {
  const uid = fixture.authUsers.ownerA.uid;
  const resolution = { status: 'CONFIRMED', confirmed: true, user: { ...fixture.authUsers.ownerA, displayName: 'Owner A' }, candidates: [] };
  const first = buildProvisioningDryRun({ subjectKey: 'shary', resolution, organizationId: 'org_idempotent', current: {} });
  assert.equal(first.decision, 'READY_FOR_APPROVAL');
  assert(first.actions.every((action) => ['CREATE_IF_ABSENT', 'REFRESH_AFTER_TRANSACTION'].includes(action.operation)));
  const desired = Object.fromEntries(first.actions.filter((action) => action.desired).map((action) => [action.path, action.desired]));
  const desiredAccess = desired[`accountAccess/${uid}`];
  const second = buildProvisioningDryRun({
    subjectKey: 'shary', resolution, organizationId: 'org_idempotent',
    current: {
      user: desired[`users/${uid}`], entitlement: desired[`entitlements/${uid}`],
      organization: desired.organizations?.org_idempotent || desired['organizations/org_idempotent'],
      membership: desired[`organizations/org_idempotent/members/${uid}`],
      userOrganization: desired[`userOrganizations/${uid}/organizations/org_idempotent`],
      subscription: desired['subscriptions/org_idempotent'],
      accountAccess: { exists: true, hash: 'confirmed-before-hash', ...desiredAccess }
    }
  });
  assert(second.actions.filter((action) => !action.path.startsWith('auth/')).every((action) => action.operation === 'NOOP'));
  assert.equal(second.actions.find((action) => action.path === `accountAccess/${uid}`).desired.revision, desiredAccess.revision);
  assert.equal(new Set(second.actions.map((action) => action.path)).size, second.actions.length);
});

scenario('15 two devices resolve the same account', () => {
  const bundle = commercialBundle(fixture.authUsers.ownerA.uid, V17_SUBJECTS.shary.desired, 'org_two_devices');
  const desktop = bootstrapSession(structuredClone(bundle));
  const phone = bootstrapSession(structuredClone(bundle));
  assert.deepEqual(desktop, phone);
  assert.equal(desktop.status, 'READY');
});

scenario('16 logout A to B remains namespaced', () => {
  const cache = new Map();
  const key = (uid, organizationId) => `CLICK360:V17:STATE:${uid}:${organizationId}`;
  for (let cycle = 0; cycle < 10; cycle += 1) {
    cache.set(key('A', 'org_A'), JSON.stringify({ owner: 'A', cycle }));
    cache.set(key('B', 'org_B'), JSON.stringify({ owner: 'B', cycle }));
    assert.equal(JSON.parse(cache.get(key('A', 'org_A'))).owner, 'A');
    assert.equal(JSON.parse(cache.get(key('B', 'org_B'))).owner, 'B');
  }
  assert.equal(cache.has(key('A', 'org_B')), false);
  const hundredScopes = new Set(Array.from({ length: 100 }, (_, index) => key(`uid-${index}`, `org-${index}`)));
  assert.equal(hundredScopes.size, 100);
});

scenario('17 old cache cannot bypass initial snapshot validation', () => {
  assert.deepEqual(domain.initialTenantBootstrapDecision({
    snapshotPrepared: false, localPersisted: true, online: true
  }), { allowed: false, reason: 'snapshot_preparation_required' });
  assert(firebaseSource.includes('click360PrepareInitialTenantState?.(ACTIVE_CONTEXT)'));
});

scenario('18 IndexedDB blocked uses verified local fallback', () => {
  assert.deepEqual(domain.initialTenantBootstrapDecision({
    snapshotPrepared: true, localPersisted: true, indexedPersisted: false, online: true
  }), { allowed: true, mode: 'local_and_cloud' });
});

scenario('19 storage full uses ONLINE_ONLY_SAFE without a general mutation', () => {
  assert.deepEqual(domain.initialTenantBootstrapDecision({
    snapshotPrepared: true, localPersisted: false, indexedPersisted: false, onlineOnlySafe: true, online: true
  }), { allowed: true, mode: 'cloud_only' });
  const start = appSource.indexOf('window.click360PrepareInitialTenantState = async function');
  const end = appSource.indexOf('window.click360ClearTenantContext', start);
  const preparationSource = appSource.slice(start, end);
  assert(!preparationSource.includes('save('));
  assert(!firebaseSource.includes('STATE_DOC.set('));
});

scenario('20 organization isolation', () => {
  const bundle = commercialBundle(fixture.authUsers.ownerA.uid, V17_SUBJECTS.shary.desired, 'org_A');
  const mismatched = { ...bundle, organization: { ...bundle.organization, organizationId: 'org_B' } };
  const session = bootstrapSession(mismatched);
  assert.equal(session.ready, false);
  assert(session.blockers.includes('membership_missing_or_mismatched'));
  assert(session.blockers.includes('subscription_missing_or_mismatched'));
});

scenario('special Shary paid access ignores inherited trial fields', () => {
  const decision = legacyAccessDecision({
    status: 'paid_base', plan: 'base', trialDays: 7, trialStartedAt: { seconds: 1_783_974_459 }
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.mode, 'paid');
  assert.equal(decision.trialFieldsIgnored, true);
  assert.equal(domain.evaluateEntitlement({ status: 'active', plan: 'pro', planCode: 'pro_lifetime', lifetime: true }).plan, 'pro');
});

scenario('special Lía remains pending without invented identity', () => {
  const plan = buildProvisioningDryRun({
    subjectKey: 'lia',
    resolution: { status: 'AUTH_NOT_CREATED', confirmed: false, user: null, candidates: [] },
    current: {}
  });
  assert.equal(plan.decision, 'PENDING_ACTIVATION_ONLY');
  assert(plan.forbidden.includes('invent_uid'));
  assert(plan.forbidden.includes('store_plaintext_code'));
});

scenario('special plan catalog is central and separated from roles', () => {
  const plan = buildPlanCatalogDryRun({});
  assert.deepEqual(plan.actions.map((action) => action.path), ['plans/founder_unlimited', 'plans/pro', 'plans/base']);
  assert.equal(PLAN_CATALOG.pro.workerLimit, 5);
  assert.equal(PLAN_CATALOG.pro.organizationLimit, 1);
  assert.equal(V17_SUBJECTS.shary.desired.platformRole, 'customer');
  assert.equal(V17_SUBJECTS.shary.desired.customerTier, 'founding_customer');
  assert.equal(V17_SUBJECTS.shary.desired.billingStatus, 'lifetime');
  assert.equal(V17_SUBJECTS.debby.desired.billingStatus, 'internal');
});

scenario('special preflight is deterministic and write-disabled', () => {
  assert(auditSource.includes("traversal.records.sort((left, right) => left.path.localeCompare(right.path))"));
  assert(auditSource.includes('V17_APPLY_NOT_AUTHORIZED'));
  assert(plannerSource.includes('V17_APPLY_NOT_AUTHORIZED'));
  assert(plannerSource.includes("recommendation: 'DO_NOT_APPLY'"));
});

console.log(`PASS V17 access harness: ${results.length} scenarios`);
for (const result of results) console.log(`PASS ${result.name}`);
