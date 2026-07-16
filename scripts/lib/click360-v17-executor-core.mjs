import { stableHash } from './click360-data-core.mjs';
import {
  REQUIRED_PROJECT_ID,
  V17_PROVISIONING_ORDER,
  V17_SUBJECTS,
  computeV17PlanHash,
  normalizeEmail
} from './click360-v17-access-core.mjs';

export const V17_EXECUTOR_MODE = 'DRY_RUN_ONLY';
export const V17_EXECUTOR_APPLY_ENABLED = false;

function isPlaceholderPath(pathValue) {
  return String(pathValue || '').includes('{');
}

function isAuthClaimsPath(pathValue) {
  return /^auth\/[^/]+\/customClaims$/.test(String(pathValue || ''));
}

function isForbiddenTenantStatePath(pathValue) {
  return /^businesses\/[^/]+\/state\/main$/.test(String(pathValue || ''));
}

function isAllowedV17ActionPath(pathValue) {
  const value = String(pathValue || '');
  return [
    /^plans\/(founder_unlimited|pro|base)$/,
    /^users\/[^/]+$/,
    /^entitlements\/[^/]+$/,
    /^organizations\/[^/]+$/,
    /^organizations\/[^/]+\/members\/[^/]+$/,
    /^userOrganizations\/[^/]+\/organizations\/[^/]+$/,
    /^subscriptions\/[^/]+$/,
    /^accountAccess\/[^/]+$/,
    /^approvedUsers\/[^/]+$/,
    /^auth\/[^/]+\/customClaims$/,
    /^activationRequests\/\{requestId\}$/,
    /^activationCodes\/\{codeHash\}$/
  ].some((pattern) => pattern.test(value));
}

function sortedKeys(value = {}) {
  return Object.keys(value || {}).sort();
}

function valueHash(value) {
  return stableHash(value === undefined ? { __click360Undefined: true } : value);
}

export function changedTopLevelKeys(current = {}, desired = {}) {
  return sortedKeys(desired).filter((key) => {
    if (desired[key] === 'SERVER_TIMESTAMP') return true;
    return valueHash(current?.[key]) !== valueHash(desired[key]);
  });
}

export function evaluateActionPrecondition(action = {}, current = {}) {
  const pathValue = String(action.path || '');
  if (isForbiddenTenantStatePath(pathValue)) {
    return { passed: false, status: 'FORBIDDEN', reason: 'tenant_state_write_forbidden' };
  }
  if (!isAllowedV17ActionPath(pathValue)) {
    return { passed: false, status: 'FORBIDDEN', reason: 'path_not_in_v17_allowlist' };
  }
  if (isPlaceholderPath(pathValue)) {
    return { passed: true, status: 'DEFERRED', reason: 'identity_or_server_id_required' };
  }
  if (isAuthClaimsPath(pathValue)) {
    return current.identityConfirmed === true
      ? { passed: true, status: 'PASS', reason: 'auth_identity_confirmed' }
      : { passed: false, status: 'FAIL', reason: 'auth_identity_not_confirmed' };
  }
  if (action.operation === 'CREATE_IF_ABSENT') {
    return current.exists === false
      ? { passed: true, status: 'PASS', reason: 'document_absent' }
      : { passed: false, status: 'FAIL', reason: 'create_only_document_exists' };
  }
  if (action.operation === 'MERGE_WITH_HASH_PRECONDITION') {
    if (current.exists !== true) return { passed: false, status: 'FAIL', reason: 'precondition_document_missing' };
    if (!action.beforeHash) return { passed: false, status: 'FAIL', reason: 'expected_before_hash_missing' };
    return current.hash === action.beforeHash
      ? { passed: true, status: 'PASS', reason: 'before_hash_matches' }
      : { passed: false, status: 'FAIL', reason: 'before_hash_mismatch' };
  }
  if (action.operation === 'NOOP') {
    const mismatchedKeys = action.desired == null
      ? []
      : sortedKeys(action.desired).filter((key) => (
          action.desired[key] !== 'SERVER_TIMESTAMP'
          && valueHash(current.data?.[key]) !== valueHash(action.desired[key])
        ));
    if (mismatchedKeys.length) {
      return { passed: false, status: 'FAIL', reason: 'noop_desired_mismatch', mismatchedKeys };
    }
    return { passed: true, status: 'NOOP', reason: 'already_matches_or_no_change_requested' };
  }
  if (action.operation === 'REFRESH_AFTER_TRANSACTION') {
    return current.identityConfirmed === true
      ? { passed: true, status: 'PASS', reason: 'claims_refresh_after_firestore' }
      : { passed: false, status: 'FAIL', reason: 'claims_identity_not_confirmed' };
  }
  return { passed: false, status: 'FAIL', reason: 'unsupported_operation' };
}

export function rollbackForAction(action = {}, current = {}) {
  if (isPlaceholderPath(action.path)) {
    return { strategy: 'DEFERRED', condition: 'no document exists until authenticated activation begins' };
  }
  if (isAuthClaimsPath(action.path)) {
    return {
      strategy: 'RESTORE_CUSTOM_CLAIMS',
      condition: 'restore exact claims backup only if the post-apply claims hash still matches the provisioning job'
    };
  }
  if (action.operation === 'CREATE_IF_ABSENT') {
    return {
      strategy: 'DELETE_CREATED_DOCUMENT',
      condition: 'only if audit proves this job created it and its current hash equals the recorded after hash'
    };
  }
  if (action.operation === 'MERGE_WITH_HASH_PRECONDITION') {
    return {
      strategy: 'RESTORE_FROM_VERIFIED_BACKUP',
      condition: `only if the current document still matches the job after hash; expected before hash ${current.hash || action.beforeHash || 'missing'}`
    };
  }
  return { strategy: 'NO_ACTION', condition: 'no production mutation planned' };
}

function actorDecision(actor = {}) {
  const smith = V17_SUBJECTS.smith;
  const blockers = [];
  if (actor.uid !== smith.confirmedUid) blockers.push('actor_uid_not_super_admin');
  if (normalizeEmail(actor.authEmail) !== normalizeEmail(smith.requiredEmail)) blockers.push('actor_auth_email_mismatch');
  if (normalizeEmail(actor.administrativeEmail) !== normalizeEmail(smith.administrativeEmail)) blockers.push('actor_administrative_email_mismatch');
  if (actor.reauthenticated !== true) blockers.push('reauthentication_not_recorded');
  if (!String(actor.reason || '').trim()) blockers.push('reason_required');
  return { passed: blockers.length === 0, blockers };
}

function validateProductionOrder(plan = {}) {
  return stableHash(plan.productionOrder || []) === stableHash(V17_PROVISIONING_ORDER);
}

function actionScopeDecision(subjectKey, subject = {}, action = {}) {
  const actionPath = String(action.path || '');
  if (subjectKey === 'plan_catalog') {
    return /^plans\/(founder_unlimited|pro|base)$/.test(actionPath)
      ? { passed: true, reason: 'catalog_path_allowed' }
      : { passed: false, reason: 'catalog_path_out_of_scope' };
  }
  if (subjectKey === 'lia' && !subject.uid) {
    return ['activationRequests/{requestId}', 'activationCodes/{codeHash}'].includes(actionPath)
      ? { passed: true, reason: 'pending_activation_path_allowed' }
      : { passed: false, reason: 'unauthenticated_subject_path_out_of_scope' };
  }

  const uid = String(subject.uid || '');
  if (!uid) return { passed: false, reason: 'subject_uid_missing' };
  const allowedPaths = [
    `users/${uid}`,
    `entitlements/${uid}`,
    `accountAccess/${uid}`,
    `approvedUsers/${uid}`,
    `auth/${uid}/customClaims`
  ];
  const organizationId = String(subject.organizationId || '');
  if (organizationId) {
    allowedPaths.push(
      `organizations/${organizationId}`,
      `organizations/${organizationId}/members/${uid}`,
      `userOrganizations/${uid}/organizations/${organizationId}`,
      `subscriptions/${organizationId}`
    );
  }
  const passed = allowedPaths.includes(actionPath);
  return passed
    ? { passed: true, reason: 'subject_path_allowed' }
    : { passed: false, reason: 'subject_path_out_of_scope' };
}

export function buildV17ExecutionManifest({ plan, currentByPath = {}, authByUid = {}, actor = {} }) {
  if (plan?.projectId !== REQUIRED_PROJECT_ID) throw new Error(`Executor refuses project ${plan?.projectId || 'missing'}.`);
  if (plan.mode !== 'DRY_RUN_ONLY' || plan.applyEnabled !== false) throw new Error('Executor requires a write-disabled dry-run plan.');
  if (plan.executionState !== 'LOCKED_DRY_RUN') throw new Error('Executor requires a locked dry-run execution state.');
  if (computeV17PlanHash(plan) !== plan.planHash) throw new Error('Dry-run plan hash verification failed.');
  if (!validateProductionOrder(plan)) throw new Error('The provisioning order is not the approved V17 order.');

  const actorCheck = actorDecision(actor);
  const catalogActions = (plan.planCatalog?.actions || []).map((action) => ({ subjectKey: 'plan_catalog', action }));
  const subjectActions = [];
  for (const subjectKey of plan.productionOrder) {
    const subject = plan.subjects?.[subjectKey];
    if (!subject) throw new Error(`Plan is missing subject ${subjectKey}.`);
    for (const action of subject.actions || []) subjectActions.push({ subjectKey, action });
  }

  const actionResults = [...catalogActions, ...subjectActions].map(({ subjectKey, action }) => {
    const subject = subjectKey === 'plan_catalog' ? null : plan.subjects[subjectKey];
    const scope = actionScopeDecision(subjectKey, subject, action);
    const authUid = isAuthClaimsPath(action.path) ? action.path.split('/')[1] : null;
    const current = authUid
      ? {
          exists: !!authByUid[authUid],
          hash: authByUid[authUid]?.claimsHash || null,
          data: authByUid[authUid]?.customClaims || {},
          identityConfirmed: authByUid[authUid]?.identityConfirmed === true
        }
      : currentByPath[action.path] || { exists: false, hash: stableHash(null), data: null };
    const precondition = scope.passed
      ? evaluateActionPrecondition(action, current)
      : { passed: false, status: 'FORBIDDEN', reason: scope.reason };
    const desiredHash = action.desired == null ? null : stableHash(action.desired);
    const changedKeys = action.desired && !isAuthClaimsPath(action.path)
      ? changedTopLevelKeys(current.data || {}, action.desired)
      : sortedKeys(action.desired || {});
    return {
      subjectKey,
      path: action.path,
      operation: action.operation,
      before: { exists: current.exists === true, hash: current.hash || stableHash(null) },
      desiredHash,
      changedKeys,
      preserveUnspecifiedFields: action.preserveUnspecifiedFields === true,
      precondition,
      scope,
      backup: {
        required: !['NOOP'].includes(action.operation),
        fullDocumentRequiredAtApply: current.exists === true,
        destination: `adminBackups/{backupId}/manifest/${subjectKey}`
      },
      rollback: rollbackForAction(action, current)
    };
  });

  const preconditionsPassed = actionResults.every((result) => result.precondition.passed);
  const technicalBlockers = [
    ...(plan.technicalBlockers || []),
    ...(plan.recommendation === 'APPLY' ? [] : ['source_plan_not_recommended_for_apply']),
    ...actorCheck.blockers,
    ...actionResults.filter((result) => !result.precondition.passed).map((result) => `${result.path}:${result.precondition.reason}`)
  ];
  const recommendation = technicalBlockers.length === 0 && preconditionsPassed ? 'APPLY' : 'DO_NOT_APPLY';
  return {
    projectId: plan.projectId,
    mode: V17_EXECUTOR_MODE,
    applyEnabled: V17_EXECUTOR_APPLY_ENABLED,
    productionWriteOperations: 0,
    planHash: plan.planHash,
    auditReportHash: plan.auditReportHash,
    recommendation,
    executionState: 'LOCKED_DRY_RUN',
    productionOrder: [...plan.productionOrder],
    actor: {
      uid: actor.uid || null,
      authEmail: normalizeEmail(actor.authEmail),
      administrativeEmail: normalizeEmail(actor.administrativeEmail),
      reason: String(actor.reason || ''),
      reauthenticated: actor.reauthenticated === true,
      validation: actorCheck
    },
    technicalBlockers: [...new Set(technicalBlockers)],
    operationalLocks: [...new Set([...(plan.operationalLocks || []), 'executor_contains_no_write_implementation'])],
    actionResults,
    backupProtocol: {
      createBeforeWrite: true,
      verifyReadbackBeforeWrite: true,
      includeAuthClaims: true,
      includeFullExistingDocuments: true,
      includeTenantIntegrityManifest: true,
      destination: 'adminBackups/{backupId}'
    },
    auditProtocol: {
      destination: 'auditLogs/{auditId}',
      provisioningJob: 'provisioningJobs/{jobId}',
      recordPreviewHash: true,
      recordBeforeAndAfterHashes: true
    }
  };
}
