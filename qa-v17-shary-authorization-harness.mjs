import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stableHash } from './scripts/lib/click360-data-core.mjs';
import { firestoreHash } from './scripts/lib/click360-v16-admin-core.mjs';
import { validateV17ProvisioningAuthorization } from './scripts/lib/click360-v17-provisioning-engine.mjs';
import { parseSharyArgs } from './scripts/apply-shary-v17.mjs';
import {
  SHARY_V17_ARTIFACT_PATHS,
  SHARY_V17_AUTHORIZATION,
  SHARY_V17_RELATED_PATHS,
  SHARY_V17_TARGET_PATHS,
  reconstructApprovedInventoryHash,
  validateAdcPrincipal,
  validateApprovedSharyPlan,
  validateSharyInvocation
} from './scripts/lib/click360-v17-shary-authorization.mjs';

const results = [];
function scenario(name, run) {
  run();
  results.push({ name, result: 'PASS' });
}

function validArgs() {
  const authorization = SHARY_V17_AUTHORIZATION;
  return {
    project: authorization.projectId,
    subject: authorization.subjectKey,
    uid: authorization.uid,
    email: authorization.email,
    'organization-id': authorization.organizationId,
    plan: authorization.desiredAccess.plan,
    'plan-code': authorization.desiredAccess.planCode,
    'billing-status': authorization.desiredAccess.billingStatus,
    'approved-plan-hash': authorization.approvedPlanHash,
    'expected-audit-hash': authorization.sourceAuditHash,
    'expected-inventory-hash': authorization.sourceInventoryHash,
    'expected-account-hash': authorization.expectedAccountHash,
    'expected-claims-hash': authorization.expectedClaimsHash,
    'expected-tenant-manifest-hash': authorization.expectedTenantManifestHash,
    'actor-uid': authorization.actor.uid,
    'actor-auth-email': authorization.actor.authEmail,
    'actor-admin-email': authorization.actor.administrativeEmail,
    reason: 'Controlled Shary V17 authorization',
    reauthenticated: true,
    'reauthenticated-at': new Date().toISOString(),
    confirm: authorization.confirmation
  };
}

scenario('01 exact Shary authorization is accepted', () => {
  assert.equal(validateSharyInvocation(validArgs(), 'apply').valid, true);
  assert.equal(SHARY_V17_AUTHORIZATION.uid, '3UTjgHd1QNSvqlcXNKQ6tL79X7u2');
  assert.equal(SHARY_V17_AUTHORIZATION.organizationId, 'org_6ac74bfaacbf493f2987709b');
});

scenario('02 any identity, organization or plan override is rejected', () => {
  for (const [key, value] of [
    ['project', 'xyfi-6b90e'], ['subject', 'smith'], ['uid', 'other-uid'], ['email', 'other@example.test'],
    ['organization-id', 'org_other'], ['plan', 'base'], ['plan-code', 'base'], ['billing-status', 'trial']
  ]) {
    assert.throws(() => validateSharyInvocation({ ...validArgs(), [key]: value }, 'apply'), /AUTHORIZATION_REJECTED/);
  }
});

scenario('03 all approved hashes and actor fields are mandatory', () => {
  for (const key of [
    'approved-plan-hash', 'expected-audit-hash', 'expected-inventory-hash', 'expected-account-hash',
    'expected-claims-hash', 'expected-tenant-manifest-hash', 'actor-uid', 'actor-auth-email', 'actor-admin-email'
  ]) {
    assert.throws(() => validateSharyInvocation({ ...validArgs(), [key]: 'tampered' }, 'apply'), /AUTHORIZATION_REJECTED/);
  }
});

scenario('04 reauthentication, reason and literal confirmation are enforced', () => {
  assert.throws(() => validateSharyInvocation({ ...validArgs(), reauthenticated: false }, 'apply'), /reauthentication/);
  assert.throws(() => validateSharyInvocation({ ...validArgs(), reason: 'short' }, 'apply'), /reason_required/);
  assert.throws(() => validateSharyInvocation({ ...validArgs(), confirm: 'APPLY' }, 'apply'), /confirmation/);
  const stale = new Date(Date.now() - SHARY_V17_AUTHORIZATION.reauthenticationMaxAgeMs - 1).toISOString();
  assert.throws(() => validateSharyInvocation({ ...validArgs(), 'reauthenticated-at': stale }, 'apply'), /reauthentication_expired/);
});

scenario('05 only preview, apply and explicit rollback commands exist', () => {
  assert.throws(() => validateSharyInvocation(validArgs(), 'apply-smith'), /command_not_allowed/);
  const rollbackArgs = { ...validArgs(), confirm: SHARY_V17_AUTHORIZATION.rollbackConfirmation };
  assert.equal(validateSharyInvocation(rollbackArgs, 'rollback').valid, true);
});

scenario('06 production allowlist excludes tenants, plans and other subjects', () => {
  assert.equal(SHARY_V17_TARGET_PATHS.length, 7);
  assert(SHARY_V17_TARGET_PATHS.every((pathValue) => !pathValue.startsWith('businesses/')));
  assert(SHARY_V17_TARGET_PATHS.every((pathValue) => !pathValue.startsWith('plans/')));
  assert(SHARY_V17_TARGET_PATHS.every((pathValue) => !pathValue.includes(SHARY_V17_AUTHORIZATION.actor.uid)));
  assert.equal(new Set(SHARY_V17_TARGET_PATHS).size, SHARY_V17_TARGET_PATHS.length);
  assert(SHARY_V17_RELATED_PATHS.includes(`businesses/${SHARY_V17_AUTHORIZATION.uid}/state/main`));
  assert.equal(SHARY_V17_RELATED_PATHS.some((pathValue) => /^businesses\/(?!3UTjgHd1QNSvqlcXNKQ6tL79X7u2\/state\/main$)/.test(pathValue)), false);
});

scenario('07 approved inventory can be reconstructed after authorized artifacts', () => {
  const accountPath = `accountAccess/${SHARY_V17_AUTHORIZATION.uid}`;
  const source = [
    { path: accountPath, hash: 'account-before', createTime: '2026-01-01', updateTime: '2026-01-02' },
    { path: 'unrelated/doc', hash: 'unchanged', createTime: '2026-01-01', updateTime: '2026-01-01' }
  ];
  const payload = {
    targetsBefore: SHARY_V17_TARGET_PATHS.map((pathValue) => pathValue === accountPath
      ? { path: pathValue, exists: true, hash: 'account-before', data: {}, createTime: '2026-01-01', updateTime: '2026-01-02' }
      : { path: pathValue, exists: false, hash: stableHash(null), data: null, createTime: null, updateTime: null })
  };
  const backup = {
    backupId: SHARY_V17_AUTHORIZATION.backupId,
    uid: SHARY_V17_AUTHORIZATION.uid,
    planHash: SHARY_V17_AUTHORIZATION.approvedPlanHash,
    payload,
    payloadHash: firestoreHash(payload)
  };
  const after = [
    { path: accountPath, hash: 'account-after', createTime: '2026-01-01', updateTime: '2026-01-03' },
    { path: SHARY_V17_TARGET_PATHS[0], hash: 'created', createTime: '2026-01-03', updateTime: '2026-01-03' },
    { path: SHARY_V17_ARTIFACT_PATHS[0], hash: 'backup', createTime: '2026-01-03', updateTime: '2026-01-03' },
    { path: 'unrelated/doc', hash: 'unchanged', createTime: '2026-01-01', updateTime: '2026-01-01' }
  ];
  assert.equal(reconstructApprovedInventoryHash(after, backup), stableHash(source));
});

scenario('08 wrapper is pinned and never iterates Smith, Debby or Lía', () => {
  const source = fs.readFileSync('scripts/apply-shary-v17.mjs', 'utf8');
  assert(source.includes('SHARY_V17_AUTHORIZATION'));
  assert(source.includes('SHARY_V17_TARGET_PATHS'));
  assert.equal(source.includes('subjects.smith.actions'), false);
  assert.equal(source.includes('subjects.debby.actions'), false);
  assert.equal(source.includes('subjects.lia.actions'), false);
  assert.equal(source.includes('businesses/${'), false);
});

scenario('09 local approved plan artifact validates when present', () => {
  const planPath = 'artifacts/v17-confirmed-identities-plan-2026-07-16/CLICK360_V17_DRY_RUN.json';
  if (!fs.existsSync(planPath)) return;
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  assert.equal(validateApprovedSharyPlan(plan).valid, true);
});

scenario('10 ADC principal must be the verified administrative identity', () => {
  assert.equal(validateAdcPrincipal({
    email: SHARY_V17_AUTHORIZATION.actor.administrativeEmail,
    emailVerified: true,
    projectId: SHARY_V17_AUTHORIZATION.projectId
  }).valid, true);
  assert.throws(() => validateAdcPrincipal({
    email: 'someone-else@example.test', emailVerified: true, projectId: SHARY_V17_AUTHORIZATION.projectId
  }), /adc_principal_email_mismatch/);
  assert.throws(() => validateAdcPrincipal({
    email: SHARY_V17_AUTHORIZATION.actor.administrativeEmail, emailVerified: false, projectId: SHARY_V17_AUTHORIZATION.projectId
  }), /adc_principal_email_unverified/);
});

scenario('11 engine rejects a production identity outside the Shary allowlist before any I/O', () => {
  const targetActions = SHARY_V17_TARGET_PATHS.map((pathValue) => ({ path: pathValue, operation: 'CREATE_IF_ABSENT', desired: {} }));
  const context = {
    projectId: SHARY_V17_AUTHORIZATION.projectId,
    subjectKey: SHARY_V17_AUTHORIZATION.subjectKey,
    uid: 'not-shary',
    email: SHARY_V17_AUTHORIZATION.email,
    organizationId: SHARY_V17_AUTHORIZATION.organizationId,
    targetActions,
    targetPaths: [...SHARY_V17_TARGET_PATHS],
    relatedPaths: [...SHARY_V17_RELATED_PATHS],
    artifactPaths: [...SHARY_V17_ARTIFACT_PATHS],
    tenantManifest: [{}, {}, {}, {}],
    claimsAction: { desired: {} }
  };
  assert.throws(() => validateV17ProvisioningAuthorization({ context, command: 'apply', evidence: {} }), /production_identity_not_allowlisted/);
});

scenario('12 CLI separates the commercial plan from the immutable plan file', () => {
  const parsed = parseSharyArgs(['--plan', 'pro', '--plan-file', 'approved.json']);
  assert.equal(parsed.plan, 'pro');
  assert.equal(parsed['plan-file'], 'approved.json');
  assert.throws(() => parseSharyArgs(['--plan', 'pro', '--plan', 'approved.json']), /duplicate_argument_plan/);
});

console.log(`PASS V17 Shary authorization harness: ${results.length} scenarios`);
for (const result of results) console.log(`PASS ${result.name}`);
