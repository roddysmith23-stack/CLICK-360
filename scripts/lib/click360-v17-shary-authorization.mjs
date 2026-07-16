import { stableHash } from './click360-data-core.mjs';
import { firestoreHash, normalizeEmail } from './click360-v16-admin-core.mjs';
import { computeV17PlanHash } from './click360-v17-access-core.mjs';

const UID = '3UTjgHd1QNSvqlcXNKQ6tL79X7u2';
const PLAN_HASH = 'e95c038115be1b7571674ca9e3f3a33782cc2cf3ec2cf91b1ed8214d9a62e9ef';
const RUN_KEY = stableHash({ namespace: 'click360-v17-shary', uid: UID, planHash: PLAN_HASH }).slice(0, 24);

export const SHARY_V17_AUTHORIZATION = Object.freeze({
  projectId: 'click-360',
  subjectKey: 'shary',
  uid: UID,
  email: 'shary10mmvv@gmail.com',
  organizationId: 'org_6ac74bfaacbf493f2987709b',
  approvedPlanHash: PLAN_HASH,
  approvedSubjectPlanHash: 'dcf9cde82aceae076daa1bd09a3a7a6c320b0474b002dec16e82998246a89243',
  sourceAuditHash: '08602dcc7e968c4df9c51185a412bc5725bd61280c36c35313b2968dffdae1a2',
  sourceInventoryHash: '1f3cbefb5e53deac093ff9c756c3555900be9ef40f3aa8916eff72f308c16228',
  expectedAccountHash: 'f39e08da6af4109983bdda059c3e2458c4e39953fc1374e93b42e4ef7b45450c',
  expectedClaimsHash: '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
  expectedTenantManifestHash: '660694bedf568e52c763c20fef148839817604c112c8d2f9ba922b720c315dee',
  expectedTargetActionsHash: 'b1b0e861bd5e5a9c64078d08a52c01ecba9e1d3d776b1df24ad805c36ff82ec8',
  expectedClaimsActionHash: 'bad5e2e354c15eee7493a5e5f1b7befc5bf45864ca3bb684133f031c549bf471',
  actor: Object.freeze({
    uid: 'iESlWpF92JXaGDoYTQ28ThWs93y1',
    authEmail: 'roddysmith23@hotmail.com',
    administrativeEmail: 'roddysmithceo@gmail.com',
    adminLevel: 'super_admin'
  }),
  desiredAccess: Object.freeze({
    platformRole: 'customer',
    organizationRole: 'owner',
    plan: 'pro',
    planCode: 'pro_lifetime',
    billingStatus: 'lifetime',
    customerTier: 'founding_customer',
    lifetime: true,
    expiresAt: null,
    status: 'active'
  }),
  confirmation: `APPLY:CLICK360:V17:SHARY:${UID}:${PLAN_HASH}`,
  rollbackConfirmation: `ROLLBACK:CLICK360:V17:SHARY:${UID}:${PLAN_HASH}`,
  backupId: `v17-shary-backup-${RUN_KEY}`,
  provisioningJobId: `v17-shary-job-${RUN_KEY}`,
  auditLogId: `v17-shary-audit-${RUN_KEY}`,
  reauthenticationMaxAgeMs: 10 * 60 * 1000
});

export const SHARY_V17_TARGET_PATHS = Object.freeze([
  `users/${UID}`,
  `entitlements/${UID}`,
  'organizations/org_6ac74bfaacbf493f2987709b',
  `organizations/org_6ac74bfaacbf493f2987709b/members/${UID}`,
  `userOrganizations/${UID}/organizations/org_6ac74bfaacbf493f2987709b`,
  'subscriptions/org_6ac74bfaacbf493f2987709b',
  `accountAccess/${UID}`
]);

export const SHARY_V17_RELATED_PATHS = Object.freeze([
  `approvedUsers/${UID}`,
  'approvedUsersByEmail/shary10mmvv@gmail.com',
  `businesses/${UID}/state/main`,
  'adminAuditLogs/ddp2uf6WoHNh1AcscXdj',
  'adminBackups/iPNGKV3QHLNww0Tkq4uJ'
]);

export const SHARY_V17_ARTIFACT_PATHS = Object.freeze([
  `adminBackups/${SHARY_V17_AUTHORIZATION.backupId}`,
  `provisioningJobs/${SHARY_V17_AUTHORIZATION.provisioningJobId}`,
  `auditLogs/${SHARY_V17_AUTHORIZATION.auditLogId}`
]);

function assertion(condition, code) {
  if (!condition) throw new Error(`SHARY_V17_AUTHORIZATION_REJECTED:${code}`);
}

function desiredActionMap(plan) {
  const actions = plan?.subjects?.shary?.actions || [];
  return new Map(actions.map((action) => [action.path, action]));
}

export function validateApprovedSharyPlan(plan) {
  const authorization = SHARY_V17_AUTHORIZATION;
  assertion(plan?.projectId === authorization.projectId, 'project_mismatch');
  assertion(plan?.mode === 'DRY_RUN_ONLY' && plan?.applyEnabled === false, 'source_plan_not_locked');
  assertion(plan?.recommendation === 'APPLY' && plan?.executionState === 'LOCKED_DRY_RUN', 'source_plan_not_approved');
  assertion(computeV17PlanHash(plan) === authorization.approvedPlanHash, 'plan_hash_mismatch');
  assertion(plan.planHash === authorization.approvedPlanHash, 'declared_plan_hash_mismatch');
  assertion(plan.auditReportHash === authorization.sourceAuditHash, 'audit_hash_mismatch');
  assertion(plan.auditInventoryHash === authorization.sourceInventoryHash, 'inventory_hash_mismatch');
  assertion(plan.subjects?.shary?.planHash === authorization.approvedSubjectPlanHash, 'subject_plan_hash_mismatch');
  assertion(plan.subjects?.shary?.uid === authorization.uid, 'uid_mismatch');
  assertion(normalizeEmail(plan.subjects?.shary?.requiredEmail) === authorization.email, 'email_mismatch');
  assertion(plan.subjects?.shary?.organizationId === authorization.organizationId, 'organization_mismatch');
  assertion(plan.subjects?.shary?.decision === 'READY_FOR_APPROVAL', 'subject_not_ready');
  for (const [key, value] of Object.entries(authorization.desiredAccess)) {
    assertion(plan.subjects?.shary?.desired?.[key] === value, `desired_${key}_mismatch`);
  }
  assertion(stableHash(plan.backupManifest?.tenantIntegrityManifest || []) === authorization.expectedTenantManifestHash, 'tenant_manifest_hash_mismatch');

  const actionMap = desiredActionMap(plan);
  assertion(actionMap.size === SHARY_V17_TARGET_PATHS.length + 1, 'unexpected_action_count');
  for (const pathValue of SHARY_V17_TARGET_PATHS) assertion(actionMap.has(pathValue), `missing_action:${pathValue}`);
  assertion(actionMap.has(`auth/${authorization.uid}/customClaims`), 'claims_action_missing');
  for (const action of actionMap.values()) {
    assertion(!/^businesses\/[^/]+\/state\/main$/.test(action.path), 'tenant_state_action_forbidden');
    assertion(SHARY_V17_TARGET_PATHS.includes(action.path) || action.path === `auth/${authorization.uid}/customClaims`, `path_not_allowlisted:${action.path}`);
  }
  assertion(actionMap.get(`accountAccess/${authorization.uid}`)?.operation === 'MERGE_WITH_HASH_PRECONDITION', 'account_operation_mismatch');
  assertion(actionMap.get(`accountAccess/${authorization.uid}`)?.beforeHash === authorization.expectedAccountHash, 'account_before_hash_mismatch');
  assertion(actionMap.get(`auth/${authorization.uid}/customClaims`)?.operation === 'REFRESH_AFTER_TRANSACTION', 'claims_operation_mismatch');
  assertion(stableHash(SHARY_V17_TARGET_PATHS.map((pathValue) => actionMap.get(pathValue))) === authorization.expectedTargetActionsHash, 'target_actions_hash_mismatch');
  assertion(stableHash(actionMap.get(`auth/${authorization.uid}/customClaims`)) === authorization.expectedClaimsActionHash, 'claims_action_hash_mismatch');
  for (const pathValue of SHARY_V17_TARGET_PATHS.filter((item) => !item.startsWith('accountAccess/'))) {
    assertion(actionMap.get(pathValue)?.operation === 'CREATE_IF_ABSENT', `create_only_required:${pathValue}`);
  }
  return { valid: true, actionMap };
}

export function validateSharyInvocation(args, command, nowMs = Date.now()) {
  const authorization = SHARY_V17_AUTHORIZATION;
  const expected = {
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
    'actor-admin-email': authorization.actor.administrativeEmail
  };
  for (const [key, value] of Object.entries(expected)) {
    const actual = key.includes('email') ? normalizeEmail(args[key]) : String(args[key] || '');
    assertion(actual === value, `argument_${key}_mismatch`);
  }
  assertion(['preview', 'apply', 'rollback'].includes(command), 'command_not_allowed');
  assertion(String(args.reason || '').trim().length >= 12, 'reason_required');
  assertion(args.reauthenticated === true, 'reauthentication_attestation_required');
  const reauthenticatedAtMs = Date.parse(String(args['reauthenticated-at'] || ''));
  assertion(Number.isFinite(reauthenticatedAtMs), 'reauthentication_time_invalid');
  assertion(reauthenticatedAtMs <= nowMs + 30_000, 'reauthentication_time_in_future');
  assertion(nowMs - reauthenticatedAtMs <= authorization.reauthenticationMaxAgeMs, 'reauthentication_expired');
  const expectedConfirmation = command === 'rollback' ? authorization.rollbackConfirmation : authorization.confirmation;
  assertion(String(args.confirm || '') === expectedConfirmation, 'literal_confirmation_mismatch');
  return { valid: true, reauthenticatedAtMs, expectedConfirmation };
}

export function validateFreshAudit(freshAudit, { allowAppliedArtifacts = false } = {}) {
  const authorization = SHARY_V17_AUTHORIZATION;
  assertion(freshAudit?.projectId === authorization.projectId, 'fresh_audit_project_mismatch');
  assertion(freshAudit?.mode === 'FIREBASE_READ_ONLY', 'fresh_audit_not_read_only');
  assertion(Number(freshAudit?.productionWriteOperations) === 0, 'fresh_audit_declares_writes');
  assertion(freshAudit?.integrity?.allReadbacksUnchanged === true, 'fresh_audit_readback_failed');
  const shary = freshAudit?.subjects?.shary;
  assertion(shary?.identity?.confirmed === true, 'fresh_shary_identity_unconfirmed');
  assertion(shary?.identity?.user?.uid === authorization.uid, 'fresh_shary_uid_mismatch');
  assertion(normalizeEmail(shary?.identity?.user?.email) === authorization.email, 'fresh_shary_email_mismatch');
  assertion(shary?.identity?.user?.disabled !== true, 'fresh_shary_auth_disabled');
  assertion(shary?.canonicalTenant?.exists === false, 'fresh_shary_canonical_tenant_unexpected');
  assertion(shary?.canonicalTenant?.path === `businesses/${authorization.uid}/state/main`, 'fresh_shary_canonical_path_mismatch');
  const exactHitPaths = new Set((shary?.exactFirestoreHits || []).map((entry) => entry.path));
  for (const pathValue of [
    `accountAccess/${authorization.uid}`,
    'adminAuditLogs/ddp2uf6WoHNh1AcscXdj',
    'adminBackups/iPNGKV3QHLNww0Tkq4uJ'
  ]) assertion(exactHitPaths.has(pathValue), `fresh_shary_historical_path_missing:${pathValue}`);
  const actor = freshAudit?.subjects?.smith;
  assertion(actor?.identity?.confirmed === true, 'fresh_actor_identity_unconfirmed');
  assertion(actor?.identity?.user?.uid === authorization.actor.uid, 'fresh_actor_uid_mismatch');
  assertion(normalizeEmail(actor?.identity?.user?.email) === authorization.actor.authEmail, 'fresh_actor_email_mismatch');
  assertion(stableHash((freshAudit.tenants || []).map((tenant) => ({
    path: tenant.path,
    hash: tenant.hash,
    counts: tenant.counts,
    businessNames: tenant.businessNames || [],
    classification: tenant.classification || null,
    protected: true,
    writeAllowed: false
  }))) === authorization.expectedTenantManifestHash, 'fresh_tenant_manifest_mismatch');
  if (!allowAppliedArtifacts) {
    assertion(freshAudit.firestore?.inventoryHash === authorization.sourceInventoryHash, 'fresh_inventory_mismatch');
    assertion(shary.accountAccess?.hash === authorization.expectedAccountHash, 'fresh_account_hash_mismatch');
  }
  return { valid: true };
}

export function validateAdcPrincipal(identity = {}) {
  const authorization = SHARY_V17_AUTHORIZATION;
  assertion(normalizeEmail(identity.email) === authorization.actor.administrativeEmail, 'adc_principal_email_mismatch');
  assertion(identity.emailVerified === true, 'adc_principal_email_unverified');
  assertion(identity.projectId === authorization.projectId, 'adc_project_mismatch');
  return { valid: true, email: normalizeEmail(identity.email), projectId: identity.projectId };
}

export function snapshotRecord(snapshot) {
  const data = snapshot.exists ? snapshot.data() || {} : null;
  return {
    path: snapshot.ref.path,
    exists: snapshot.exists,
    hash: snapshot.exists ? firestoreHash(data) : stableHash(null),
    data,
    createTime: snapshot.createTime?.toDate?.().toISOString?.() || null,
    updateTime: snapshot.updateTime?.toDate?.().toISOString?.() || null
  };
}

export function backupPayloadCore({ plan, freshAudit, actor, authSnapshot, targetSnapshots, relatedSnapshots, tenantManifest }) {
  return {
    formatVersion: 17,
    action: 'provision_shary_pro_lifetime',
    projectId: SHARY_V17_AUTHORIZATION.projectId,
    subject: 'shary',
    uid: SHARY_V17_AUTHORIZATION.uid,
    email: SHARY_V17_AUTHORIZATION.email,
    organizationId: SHARY_V17_AUTHORIZATION.organizationId,
    planHash: plan.planHash,
    sourceAuditHash: plan.auditReportHash,
    freshAuditHash: freshAudit.reportHash,
    sourceInventoryHash: SHARY_V17_AUTHORIZATION.sourceInventoryHash,
    actor,
    authBefore: authSnapshot,
    targetsBefore: targetSnapshots,
    relatedBefore: relatedSnapshots,
    tenantIntegrityBefore: tenantManifest,
    rollbackManifest: targetSnapshots.map((entry) => ({
      path: entry.path,
      strategy: entry.exists ? 'RESTORE_FULL_DOCUMENT_WITH_AFTER_HASH_PRECONDITION' : 'DELETE_JOB_CREATED_DOCUMENT_WITH_AFTER_HASH_PRECONDITION',
      beforeHash: entry.hash
    }))
  };
}

export function backupPayloadHash(payloadCore) {
  return firestoreHash(payloadCore);
}

export function verifyBackupDocument(document) {
  assertion(document?.backupId === SHARY_V17_AUTHORIZATION.backupId, 'backup_id_mismatch');
  assertion(document?.uid === SHARY_V17_AUTHORIZATION.uid, 'backup_uid_mismatch');
  assertion(document?.planHash === SHARY_V17_AUTHORIZATION.approvedPlanHash, 'backup_plan_hash_mismatch');
  assertion(document?.payloadHash === backupPayloadHash(document.payload), 'backup_payload_hash_mismatch');
  return { valid: true, payloadHash: document.payloadHash };
}

export function reconstructApprovedInventoryHash(inventory, backupDocument = null) {
  if (!backupDocument) return stableHash(inventory || []);
  verifyBackupDocument(backupDocument);
  const mutablePaths = new Set([...SHARY_V17_TARGET_PATHS, ...SHARY_V17_ARTIFACT_PATHS]);
  const restored = (inventory || []).filter((entry) => !mutablePaths.has(entry.path));
  for (const entry of backupDocument.payload.targetsBefore || []) {
    if (!entry.exists) continue;
    restored.push({
      path: entry.path,
      hash: entry.hash,
      createTime: entry.createTime,
      updateTime: entry.updateTime
    });
  }
  restored.sort((left, right) => left.path.localeCompare(right.path));
  return stableHash(restored);
}

export function documentMatchesDesired(document, desired) {
  if (!document || !desired) return false;
  return Object.entries(desired).every(([key, value]) => {
    if (value === 'SERVER_TIMESTAMP') return document[key] != null;
    return stableHash(document[key]) === stableHash(value);
  });
}

export function sharyWriteDiff(plan, currentByPath, claimsSnapshot) {
  const { actionMap } = validateApprovedSharyPlan(plan);
  const rows = SHARY_V17_TARGET_PATHS.map((pathValue) => {
    const action = actionMap.get(pathValue);
    const current = currentByPath[pathValue];
    return {
      path: pathValue,
      operation: action.operation,
      beforeExists: current?.exists === true,
      beforeHash: current?.hash || stableHash(null),
      expectedBeforeHash: action.beforeHash || stableHash(null),
      desiredHash: stableHash(action.desired),
      desired: action.desired,
      willPreserveUnspecifiedFields: action.operation === 'MERGE_WITH_HASH_PRECONDITION'
    };
  });
  const claimsAction = actionMap.get(`auth/${SHARY_V17_AUTHORIZATION.uid}/customClaims`);
  rows.push({
    path: `auth/${SHARY_V17_AUTHORIZATION.uid}/customClaims`,
    operation: 'MERGE_CUSTOM_CLAIMS',
    beforeExists: true,
    beforeHash: claimsSnapshot.hash,
    expectedBeforeHash: SHARY_V17_AUTHORIZATION.expectedClaimsHash,
    desiredHash: stableHash({ ...(claimsSnapshot.data || {}), ...claimsAction.desired }),
    desired: claimsAction.desired,
    willPreserveUnspecifiedFields: true
  });
  return rows;
}
