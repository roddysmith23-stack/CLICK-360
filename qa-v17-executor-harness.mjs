import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stableHash } from './scripts/lib/click360-data-core.mjs';
import {
  V17_PROVISIONING_ORDER,
  V17_SUBJECTS,
  buildProvisioningDryRun,
  computeV17PlanHash,
  resolveAuthIdentity
} from './scripts/lib/click360-v17-access-core.mjs';
import {
  buildV17ExecutionManifest,
  changedTopLevelKeys,
  evaluateActionPrecondition
} from './scripts/lib/click360-v17-executor-core.mjs';

const results = [];
function scenario(name, run) {
  run();
  results.push({ name, result: 'PASS' });
}

const authUsers = [
  { uid: V17_SUBJECTS.smith.confirmedUid, email: V17_SUBJECTS.smith.requiredEmail, disabled: false },
  { uid: V17_SUBJECTS.debby.confirmedUid, email: V17_SUBJECTS.debby.requiredEmail, disabled: false },
  { uid: V17_SUBJECTS.shary.confirmedUid, email: V17_SUBJECTS.shary.requiredEmail, disabled: false }
];

function makeSubjectPlan(subjectKey, options = {}) {
  const definition = V17_SUBJECTS[subjectKey];
  if (subjectKey === 'lia') {
    return {
      label: definition.label,
      ...buildProvisioningDryRun({
        subjectKey,
        resolution: { status: 'AUTH_NOT_CREATED', confirmed: false, user: null, candidates: [] },
        current: {}
      })
    };
  }
  const user = authUsers.find((candidate) => candidate.uid === definition.confirmedUid);
  const organizationId = subjectKey === 'shary' ? 'org_shary_fixture' : null;
  const current = subjectKey === 'shary'
    ? { accountAccess: { exists: true, hash: 'shary-before', revision: 1, businessId: user.uid } }
    : subjectKey === 'debby'
      ? { approvedUser: { exists: true, hash: 'debby-before', email: 'wrong@example.test' } }
      : {};
  return {
    label: definition.label,
    ...buildProvisioningDryRun({
      subjectKey,
      resolution: { status: 'CONFIRMED', confirmed: true, user, candidates: [user] },
      organizationId,
      current: { ...current, ...options.current }
    })
  };
}

function makePlan() {
  const plan = {
    projectId: 'click-360',
    modelVersion: 17,
    auditReportHash: 'fixture-audit-hash',
    auditInventoryHash: 'fixture-inventory-hash',
    mode: 'DRY_RUN_ONLY',
    applyEnabled: false,
    recommendation: 'APPLY',
    executionState: 'LOCKED_DRY_RUN',
    technicalBlockers: [],
    operationalLocks: ['production_apply_explicitly_forbidden_in_current_phase'],
    productionOrder: [...V17_PROVISIONING_ORDER],
    planCatalog: {
      actions: [{
        path: 'plans/pro',
        operation: 'CREATE_IF_ABSENT',
        desired: { planId: 'pro', active: true, version: 17 }
      }]
    },
    subjects: {
      shary: makeSubjectPlan('shary'),
      smith: makeSubjectPlan('smith'),
      debby: makeSubjectPlan('debby'),
      lia: makeSubjectPlan('lia')
    },
    backupManifest: { destinationPattern: 'adminBackups/{backupId}', tenantIntegrityManifest: [] },
    applyProtocol: ['verified_backup_before_write'],
    rollbackProtocol: ['hash_guarded_restore']
  };
  plan.planHash = computeV17PlanHash(plan);
  return plan;
}

function currentState(plan) {
  const currentByPath = {};
  for (const action of [
    ...plan.planCatalog.actions,
    ...Object.values(plan.subjects).flatMap((subject) => subject.actions)
  ]) {
    if (action.path.includes('{') || action.path.startsWith('auth/')) continue;
    if (action.operation === 'MERGE_WITH_HASH_PRECONDITION') {
      currentByPath[action.path] = {
        exists: true,
        hash: action.beforeHash,
        data: action.path.startsWith('approvedUsers/')
          ? { email: 'wrong@example.test', name: 'Preserve me' }
          : { revision: 1 }
      };
    } else {
      currentByPath[action.path] = { exists: false, hash: stableHash(null), data: null };
    }
  }
  return currentByPath;
}

function authState() {
  return Object.fromEntries(authUsers.map((user) => [user.uid, {
    ...user,
    identityConfirmed: true,
    customClaims: {},
    claimsHash: stableHash({})
  }]));
}

const actor = {
  uid: V17_SUBJECTS.smith.confirmedUid,
  authEmail: V17_SUBJECTS.smith.requiredEmail,
  administrativeEmail: V17_SUBJECTS.smith.administrativeEmail,
  reason: 'V17 fixture preflight',
  reauthenticated: true
};

scenario('01 confirmed Smith and Debby identities are exact', () => {
  for (const subjectKey of ['smith', 'debby']) {
    const resolution = resolveAuthIdentity(V17_SUBJECTS[subjectKey], authUsers);
    assert.equal(resolution.status, 'CONFIRMED');
    assert.equal(resolution.user.uid, V17_SUBJECTS[subjectKey].confirmedUid);
    assert.equal(resolution.user.email, V17_SUBJECTS[subjectKey].requiredEmail);
  }
  assert.equal(V17_SUBJECTS.smith.administrativeEmail, 'roddysmithceo@gmail.com');
});

scenario('02 ordered manifest stays write-disabled and recommends APPLY', () => {
  const plan = makePlan();
  const manifest = buildV17ExecutionManifest({
    plan,
    currentByPath: currentState(plan),
    authByUid: authState(),
    actor
  });
  assert.equal(manifest.recommendation, 'APPLY');
  assert.equal(manifest.mode, 'DRY_RUN_ONLY');
  assert.equal(manifest.applyEnabled, false);
  assert.equal(manifest.productionWriteOperations, 0);
  assert.deepEqual(manifest.productionOrder, ['shary', 'smith', 'debby', 'lia']);
  assert(manifest.actionResults.every((result) => result.precondition.passed));
});

scenario('03 Debby correction changes only email and server timestamp', () => {
  const plan = makePlan();
  const action = plan.subjects.debby.actions.find((candidate) => candidate.path.startsWith('approvedUsers/'));
  assert.equal(action.operation, 'MERGE_WITH_HASH_PRECONDITION');
  assert.deepEqual(Object.keys(action.desired).sort(), ['email', 'updatedAt']);
  assert.equal(action.preserveUnspecifiedFields, true);
  assert.deepEqual(changedTopLevelKeys({ email: 'wrong@example.test' }, action.desired), ['email', 'updatedAt']);
});

scenario('04 organization role is stored in membership, not entitlement', () => {
  const plan = makePlan();
  const entitlement = plan.subjects.shary.actions.find((action) => action.path.startsWith('entitlements/')).desired;
  const membership = plan.subjects.shary.actions.find((action) => /\/members\//.test(action.path)).desired;
  assert.equal(Object.hasOwn(entitlement, 'organizationRole'), false);
  assert.equal(membership.organizationRole, 'owner');
  assert.equal(plan.subjects.debby.organizationMode, 'PLATFORM_ONLY_MEMBERSHIP_DEFERRED');
});

scenario('05 a stale hash blocks the entire manifest', () => {
  const plan = makePlan();
  const current = currentState(plan);
  current[`accountAccess/${V17_SUBJECTS.shary.confirmedUid}`].hash = 'stale-hash';
  const manifest = buildV17ExecutionManifest({ plan, currentByPath: current, authByUid: authState(), actor });
  assert.equal(manifest.recommendation, 'DO_NOT_APPLY');
  assert(manifest.technicalBlockers.some((blocker) => blocker.includes('before_hash_mismatch')));
});

scenario('06 wrong actor or missing reauthentication blocks execution', () => {
  const plan = makePlan();
  const manifest = buildV17ExecutionManifest({
    plan,
    currentByPath: currentState(plan),
    authByUid: authState(),
    actor: { ...actor, uid: V17_SUBJECTS.debby.confirmedUid, reauthenticated: false }
  });
  assert.equal(manifest.recommendation, 'DO_NOT_APPLY');
  assert(manifest.technicalBlockers.includes('actor_uid_not_super_admin'));
  assert(manifest.technicalBlockers.includes('reauthentication_not_recorded'));
});

scenario('07 tampered plan hash is rejected', () => {
  const plan = makePlan();
  plan.subjects.shary.uid = 'cross-tenant-uid';
  assert.throws(() => buildV17ExecutionManifest({
    plan, currentByPath: currentState(plan), authByUid: authState(), actor
  }), /plan hash verification failed/i);
});

scenario('08 recomputed cross-tenant scope is still rejected', () => {
  const plan = makePlan();
  plan.subjects.shary.actions[0].path = `users/${V17_SUBJECTS.debby.confirmedUid}`;
  plan.planHash = computeV17PlanHash(plan);
  const manifest = buildV17ExecutionManifest({
    plan, currentByPath: currentState(plan), authByUid: authState(), actor
  });
  assert.equal(manifest.recommendation, 'DO_NOT_APPLY');
  assert(manifest.technicalBlockers.some((blocker) => blocker.includes('subject_path_out_of_scope')));
});

scenario('09 recomputed cross-organization scope is rejected', () => {
  const plan = makePlan();
  const membership = plan.subjects.shary.actions.find((action) => /\/members\//.test(action.path));
  membership.path = `organizations/org_other/members/${V17_SUBJECTS.shary.confirmedUid}`;
  plan.planHash = computeV17PlanHash(plan);
  const manifest = buildV17ExecutionManifest({
    plan, currentByPath: currentState(plan), authByUid: authState(), actor
  });
  assert.equal(manifest.recommendation, 'DO_NOT_APPLY');
  assert(manifest.technicalBlockers.some((blocker) => blocker.includes('subject_path_out_of_scope')));
});

scenario('10 state/main and arbitrary paths are forbidden', () => {
  assert.equal(evaluateActionPrecondition({
    path: `businesses/${V17_SUBJECTS.shary.confirmedUid}/state/main`,
    operation: 'CREATE_IF_ABSENT'
  }, { exists: false }).reason, 'tenant_state_write_forbidden');
  assert.equal(evaluateActionPrecondition({
    path: 'adminBackups/unsafe', operation: 'CREATE_IF_ABSENT'
  }, { exists: false }).reason, 'path_not_in_v17_allowlist');
});

scenario('11 a mismatched NOOP is rejected', () => {
  const decision = evaluateActionPrecondition({
    path: `users/${V17_SUBJECTS.smith.confirmedUid}`,
    operation: 'NOOP',
    desired: { uid: V17_SUBJECTS.smith.confirmedUid, platformRole: 'platform_founder' }
  }, {
    exists: true,
    data: { uid: V17_SUBJECTS.smith.confirmedUid, platformRole: 'customer' }
  });
  assert.equal(decision.passed, false);
  assert.equal(decision.reason, 'noop_desired_mismatch');
});

scenario('12 source DO_NOT_APPLY cannot be upgraded by executor', () => {
  const plan = makePlan();
  plan.recommendation = 'DO_NOT_APPLY';
  plan.planHash = computeV17PlanHash(plan);
  const manifest = buildV17ExecutionManifest({
    plan, currentByPath: currentState(plan), authByUid: authState(), actor
  });
  assert.equal(manifest.recommendation, 'DO_NOT_APPLY');
  assert(manifest.technicalBlockers.includes('source_plan_not_recommended_for_apply'));
});

scenario('13 executable contains no production write implementation', () => {
  const source = fs.readFileSync('scripts/admin-access-v17.mjs', 'utf8');
  for (const forbidden of [
    'runTransaction(', 'setCustomUserClaims(', '.create(', '.update(', '.delete(',
    'batch.commit(', 'transaction.set(', 'transaction.update(', 'transaction.delete('
  ]) {
    assert.equal(source.includes(forbidden), false, `unexpected write primitive: ${forbidden}`);
  }
  assert(source.includes('V17_APPLY_NOT_AUTHORIZED'));
  assert(source.includes('productionWriteOperations'));
});

console.log(`PASS V17 executor harness: ${results.length} scenarios`);
for (const result of results) console.log(`PASS ${result.name}`);
