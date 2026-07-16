import crypto from 'node:crypto';
import { stableHash } from './click360-data-core.mjs';

export const V17_MODEL_VERSION = 17;
export const REQUIRED_PROJECT_ID = 'click-360';

export const PLATFORM_ROLES = Object.freeze(['platform_founder', 'platform_admin', 'support_admin', 'customer']);
export const ORGANIZATION_ROLES = Object.freeze(['owner', 'co_owner', 'admin', 'manager', 'worker']);
export const BILLING_STATUSES = Object.freeze(['internal', 'lifetime', 'subscription', 'trial']);
export const CUSTOMER_TIERS = Object.freeze(['platform_founder', 'founding_customer', 'standard_customer']);
export const CRITICAL_ACTION_POLICY = Object.freeze({
  reauthenticationRequired: true,
  explicitConfirmationRequired: true,
  reasonRequired: true,
  verifiedBackupRequired: true,
  auditRequired: true,
  founderAdminRequiresSuperAdmin: true
});

export const PLAN_CATALOG = Object.freeze({
  founder_unlimited: Object.freeze({
    planId: 'founder_unlimited',
    name: 'Founders Unlimited',
    featureSet: 'all',
    organizationLimit: null,
    workerLimit: null,
    includesFutureFeatures: true,
    platformAdministration: true,
    transferable: false,
    billingModes: Object.freeze(['internal']),
    capabilities: Object.freeze(['*']),
    active: true,
    version: V17_MODEL_VERSION
  }),
  pro: Object.freeze({
    planId: 'pro',
    name: 'CLICK 360 Pro',
    featureSet: 'pro',
    organizationLimit: 1,
    workerLimit: 5,
    includesFutureFeatures: 'pro_only',
    platformAdministration: false,
    prioritySupport: true,
    freeMigration: true,
    priorityRecovery: true,
    transferable: false,
    billingModes: Object.freeze(['lifetime', 'subscription']),
    capabilities: Object.freeze([
      'inventory', 'sales', 'cash', 'reports', 'customers', 'supplier_invoices', 'layaways',
      'reminders', 'qr_labels', 'pwa', 'multidevice_sync', 'priority_support', 'priority_recovery'
    ]),
    exclusions: Object.freeze(['platform_control_center', 'cross_tenant_access', 'unlimited_organizations', 'white_label', 'unlimited_enterprise_api']),
    active: true,
    version: V17_MODEL_VERSION
  }),
  base: Object.freeze({
    planId: 'base',
    name: 'CLICK 360 Base',
    featureSet: 'base',
    organizationLimit: 1,
    workerLimit: 2,
    includesFutureFeatures: 'base_only',
    platformAdministration: false,
    transferable: false,
    billingModes: Object.freeze(['subscription', 'trial']),
    capabilities: Object.freeze(['inventory', 'sales', 'cash', 'basic_reports', 'pwa', 'multidevice_sync']),
    exclusions: Object.freeze(['platform_control_center', 'cross_tenant_access', 'priority_support']),
    active: true,
    version: V17_MODEL_VERSION
  })
});

export const V17_SUBJECTS = Object.freeze({
  smith: Object.freeze({
    label: 'Sr. Smith',
    requiredEmail: 'roddysmithceo@gmail.com',
    confirmedUid: null,
    candidateTerms: Object.freeze(['roddysmith', 'rod smith', 'roddysmith23']),
    legacySearchTerms: Object.freeze(['roddysmithceo@gmail.com', 'roddysmith23@hotmail.com', 'rod smith', 'roddysmith']),
    desired: Object.freeze({
      platformRole: 'platform_founder', adminLevel: 'super_admin', organizationRole: null,
      plan: 'founder_unlimited', planCode: 'founder_unlimited', billingStatus: 'internal',
      lifetime: true, customerTier: 'platform_founder', status: 'active', expiresAt: null,
      source: 'platform_founder_bootstrap', entitlementVersion: V17_MODEL_VERSION
    })
  }),
  debby: Object.freeze({
    label: 'Debby',
    requiredEmail: null,
    confirmedUid: null,
    candidateTerms: Object.freeze(['debby', 'debby a', 'debbya']),
    legacySearchTerms: Object.freeze(['debby', 'debbya']),
    desired: Object.freeze({
      platformRole: 'platform_founder', adminLevel: 'founder_admin', organizationRole: 'co_owner',
      plan: 'founder_unlimited', planCode: 'founder_unlimited', billingStatus: 'internal',
      lifetime: true, customerTier: 'platform_founder', status: 'active', expiresAt: null,
      source: 'platform_founder_bootstrap', entitlementVersion: V17_MODEL_VERSION
    })
  }),
  shary: Object.freeze({
    label: 'Shary',
    requiredEmail: 'shary10mmvv@gmail.com',
    confirmedUid: '3UTjgHd1QNSvqlcXNKQ6tL79X7u2',
    candidateTerms: Object.freeze([]),
    legacySearchTerms: Object.freeze(['shary10mmvv@gmail.com', 'shary']),
    desired: Object.freeze({
      platformRole: 'customer', adminLevel: null, organizationRole: 'owner',
      plan: 'pro', planCode: 'pro_lifetime', billingStatus: 'lifetime',
      lifetime: true, customerTier: 'founding_customer', status: 'active', expiresAt: null,
      source: 'founding_customer_upgrade', entitlementVersion: V17_MODEL_VERSION
    })
  }),
  lia: Object.freeze({
    label: 'Lía',
    requiredEmail: 'liavero_zambrano@hotmail.com',
    confirmedUid: null,
    candidateTerms: Object.freeze([]),
    legacySearchTerms: Object.freeze(['liavero_zambrano@hotmail.com', 'lia vero', 'lía vero', 'zambrano']),
    desired: Object.freeze({
      platformRole: 'customer', adminLevel: null, organizationRole: 'owner',
      plan: 'pro', planCode: 'pro_lifetime', billingStatus: 'lifetime',
      lifetime: true, customerTier: 'founding_customer', status: 'active', expiresAt: null,
      source: 'founding_customer_purchase', entitlementVersion: V17_MODEL_VERSION
    })
  })
});

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function canonicalPlanDocuments() {
  return Object.values(PLAN_CATALOG).map((plan) => ({ path: `plans/${plan.planId}`, data: { ...plan } }));
}

function searchableIdentity(user) {
  return `${normalizeEmail(user?.email)} ${String(user?.displayName || '').trim().toLowerCase()}`;
}

export function resolveAuthIdentity(subject, authUsers = []) {
  const requiredEmail = normalizeEmail(subject?.requiredEmail);
  const confirmedUid = String(subject?.confirmedUid || '');
  const byUid = confirmedUid ? authUsers.filter((user) => user.uid === confirmedUid) : [];
  const byEmail = requiredEmail ? authUsers.filter((user) => normalizeEmail(user.email) === requiredEmail) : [];
  const fuzzy = (subject?.candidateTerms || []).length
    ? authUsers.filter((user) => subject.candidateTerms.some((term) => searchableIdentity(user).includes(String(term).toLowerCase())))
    : [];
  const candidates = [...new Map([...byUid, ...byEmail, ...fuzzy].map((user) => [user.uid, user])).values()];

  if (confirmedUid) {
    if (byUid.length !== 1) return { status: 'UID_NOT_FOUND', confirmed: false, candidates };
    const user = byUid[0];
    if (requiredEmail && normalizeEmail(user.email) !== requiredEmail) {
      return { status: 'UID_EMAIL_CONFLICT', confirmed: false, candidates, conflict: { uidEmail: normalizeEmail(user.email), requiredEmail } };
    }
    if (user.disabled === true) return { status: 'AUTH_DISABLED', confirmed: false, candidates };
    return { status: 'CONFIRMED', confirmed: true, user, candidates };
  }

  if (requiredEmail && byEmail.length === 1) {
    if (byEmail[0].disabled === true) return { status: 'AUTH_DISABLED', confirmed: false, candidates };
    return { status: 'CONFIRMED_BY_EMAIL', confirmed: true, user: byEmail[0], candidates };
  }
  if (requiredEmail && byEmail.length > 1) return { status: 'DUPLICATE_AUTH_EMAIL', confirmed: false, candidates };
  if (requiredEmail && byEmail.length === 0 && candidates.length === 0) return { status: 'AUTH_NOT_CREATED', confirmed: false, candidates };
  if (requiredEmail && byEmail.length === 0 && candidates.length === 1) return { status: 'CANDIDATE_REQUIRES_CONFIRMATION', confirmed: false, candidates };
  if (!requiredEmail && candidates.length === 1) return { status: 'CANDIDATE_REQUIRES_CONFIRMATION', confirmed: false, candidates };
  if (candidates.length > 0) return { status: 'AMBIGUOUS_CANDIDATES', confirmed: false, candidates };
  return { status: 'IDENTITY_NOT_FOUND', confirmed: false, candidates: [] };
}

export function validateDesiredAccess(desired) {
  const errors = [];
  if (!PLATFORM_ROLES.includes(desired?.platformRole)) errors.push('invalid_platform_role');
  if (desired?.organizationRole != null && !ORGANIZATION_ROLES.includes(desired.organizationRole)) errors.push('invalid_organization_role');
  if (!PLAN_CATALOG[desired?.plan]) errors.push('invalid_plan');
  if (!BILLING_STATUSES.includes(desired?.billingStatus)) errors.push('invalid_billing_status');
  if (!CUSTOMER_TIERS.includes(desired?.customerTier)) errors.push('invalid_customer_tier');
  if (desired?.lifetime !== true) errors.push('permanent_access_requires_lifetime_true');
  if (desired?.expiresAt != null) errors.push('permanent_access_requires_null_expiry');
  if (desired?.platformRole === 'platform_founder') {
    if (desired.plan !== 'founder_unlimited') errors.push('founder_plan_mismatch');
    if (desired.billingStatus !== 'internal') errors.push('founder_billing_mismatch');
    if (desired.customerTier !== 'platform_founder') errors.push('founder_tier_mismatch');
  }
  if (desired?.customerTier === 'founding_customer') {
    if (desired.platformRole !== 'customer') errors.push('founding_customer_platform_role_mismatch');
    if (desired.plan !== 'pro' || desired.planCode !== 'pro_lifetime') errors.push('founding_customer_plan_mismatch');
    if (desired.billingStatus !== 'lifetime') errors.push('founding_customer_billing_mismatch');
    if (desired.adminLevel != null) errors.push('founding_customer_cannot_have_platform_admin');
  }
  const plan = PLAN_CATALOG[desired?.plan];
  if (plan && !plan.billingModes.includes(desired.billingStatus)) errors.push('billing_not_allowed_by_plan');
  return { valid: errors.length === 0, errors };
}

export function activationCodeHash(rawCode) {
  const code = String(rawCode || '');
  if (code.length < 32) throw new Error('Activation code entropy is insufficient.');
  return crypto.createHash('sha256').update(`click360:v17:activation:${code}`).digest('hex');
}

export function generateActivationCode() {
  const rawCode = crypto.randomBytes(32).toString('base64url');
  return { rawCode, codeHash: activationCodeHash(rawCode) };
}

export function activationCodeDecision({ record, email, uid, nowMs = Date.now() }) {
  if (!record) return { allowed: false, reason: 'code_not_found' };
  if (record.status === 'used' || record.usedAt) return { allowed: false, reason: 'code_used' };
  if (record.status !== 'pending') return { allowed: false, reason: 'code_not_pending' };
  if (normalizeEmail(record.email) !== normalizeEmail(email)) return { allowed: false, reason: 'email_mismatch' };
  const expiresAtMs = Number(record.expiresAtMs || record.expiresAt?.toMillis?.() || 0);
  if (!expiresAtMs || expiresAtMs <= nowMs) return { allowed: false, reason: 'code_expired' };
  if (record.boundUid && record.boundUid !== uid) return { allowed: false, reason: 'uid_mismatch' };
  return { allowed: true, reason: 'ready' };
}

export function legacyAccessDecision(data = {}) {
  const status = String(data.status || '').toLowerCase();
  const plan = String(data.planCode || data.plan || '').toLowerCase();
  const lifetime = data.lifetime === true || ['lifetime', 'pro_lifetime', 'founder_unlimited'].includes(String(data.billingStatus || '').toLowerCase());
  if (['paid_base', 'paid_pro', 'active', 'lifetime'].includes(status) || lifetime) {
    return { allowed: true, mode: lifetime ? 'lifetime' : 'paid', plan, trialFieldsIgnored: data.trialDays != null || data.trialStartedAt != null };
  }
  if (status === 'trial') return { allowed: true, mode: 'trial', plan: plan || 'base', trialFieldsIgnored: false };
  if (['suspended', 'blocked', 'revoked'].includes(status)) return { allowed: false, mode: status, plan, trialFieldsIgnored: true };
  return { allowed: false, mode: 'unresolved', plan, trialFieldsIgnored: true };
}

export function evaluateEntitlement(entitlement = {}, nowMs = Date.now()) {
  const errors = [];
  if (!PLATFORM_ROLES.includes(entitlement.platformRole)) errors.push('invalid_platform_role');
  if (!PLAN_CATALOG[entitlement.plan]) errors.push('invalid_plan');
  if (!BILLING_STATUSES.includes(entitlement.billingStatus)) errors.push('invalid_billing_status');
  if (!CUSTOMER_TIERS.includes(entitlement.customerTier)) errors.push('invalid_customer_tier');
  const plan = PLAN_CATALOG[entitlement.plan];
  if (plan && !plan.billingModes.includes(entitlement.billingStatus)) errors.push('billing_not_allowed_by_plan');
  if (entitlement.lifetime === true) {
    if (entitlement.expiresAt != null) errors.push('lifetime_must_not_expire');
    return { allowed: errors.length === 0 && entitlement.status === 'active', mode: 'lifetime', errors, expiresAtMs: null };
  }
  const expiresAtMs = Number(entitlement.expiresAtMs || entitlement.expiresAt?.toMillis?.() || entitlement.expiresAt || 0);
  if (!expiresAtMs) errors.push('expiry_required');
  const expired = !expiresAtMs || expiresAtMs <= nowMs;
  return {
    allowed: errors.length === 0 && !expired && ['active', 'trial'].includes(entitlement.status),
    mode: entitlement.billingStatus === 'trial' ? 'trial' : 'subscription',
    errors,
    expired,
    expiresAtMs: expiresAtMs || null
  };
}

export function bootstrapSession({ authUser, entitlement, organization, membership, subscription }) {
  const blockers = [];
  if (!authUser?.uid || authUser.disabled === true) blockers.push('auth_invalid');
  if (!entitlement || entitlement.uid !== authUser?.uid) blockers.push('entitlement_missing_or_mismatched');
  const accessDecision = entitlement ? evaluateEntitlement(entitlement) : { allowed: false, errors: [] };
  if (entitlement && !accessDecision.allowed) blockers.push(...(accessDecision.errors.length ? accessDecision.errors : ['inactive_or_expired']).map((error) => `entitlement:${error}`));
  const platformOnly = entitlement?.platformRole === 'platform_founder' && !organization && !membership && !subscription;
  if (!platformOnly) {
    if (!organization?.organizationId || organization.status !== 'active') blockers.push('organization_missing_or_inactive');
    if (!membership || membership.uid !== authUser?.uid || membership.organizationId !== organization?.organizationId || membership.status !== 'active') {
      blockers.push('membership_missing_or_mismatched');
    }
    if (!subscription || subscription.organizationId !== organization?.organizationId || subscription.status !== 'active') {
      blockers.push('subscription_missing_or_mismatched');
    }
  }
  return {
    status: blockers.length ? 'REPAIR_REQUIRED' : 'READY',
    ready: blockers.length === 0,
    blockers,
    uid: authUser?.uid || null,
    organizationId: organization?.organizationId || null,
    platformRole: entitlement?.platformRole || null,
    organizationRole: membership?.organizationRole || null,
    plan: entitlement?.plan || null,
    billingStatus: entitlement?.billingStatus || null
  };
}

export function provisionOrganization(input) {
  return { mode: 'PLAN_ONLY', ...buildProvisioningDryRun(input) };
}

export function repairAccount({ session, provisioningPlan }) {
  const missing = session?.blockers || ['session_not_evaluated'];
  return {
    mode: 'PLAN_ONLY',
    decision: missing.length ? 'REPAIR_PREVIEW' : 'NOOP',
    missing,
    actions: provisioningPlan?.actions || [],
    planHash: provisioningPlan?.planHash || null
  };
}

export function approveAccount({ actor, preview, reason, backupVerified = false, reauthenticated = false, superAdminConfirmed = false }) {
  const blockers = [];
  if (!actor?.uid || !['super_admin', 'founder_admin'].includes(actor.adminLevel)) blockers.push('admin_not_authorized');
  if (!preview?.planHash) blockers.push('preview_required');
  if (!String(reason || '').trim()) blockers.push('reason_required');
  if (!backupVerified) blockers.push('verified_backup_required');
  if (!reauthenticated) blockers.push('reauthentication_required');
  if (actor?.adminLevel === 'founder_admin' && preview?.critical === true && !superAdminConfirmed) blockers.push('super_admin_confirmation_required');
  return { allowed: blockers.length === 0, blockers, planHash: preview?.planHash || null };
}

export function redeemActivationCode({ record, rawCode, email, uid, nowMs = Date.now() }) {
  let suppliedHash;
  try { suppliedHash = activationCodeHash(rawCode); } catch { return { allowed: false, reason: 'invalid_code_format' }; }
  if (!record?.codeHash || suppliedHash !== record.codeHash) return { allowed: false, reason: 'code_hash_mismatch' };
  const decision = activationCodeDecision({ record, email, uid, nowMs });
  if (!decision.allowed) return decision;
  return {
    allowed: true,
    reason: 'ready',
    mode: 'PLAN_ONLY',
    updates: {
      activationCode: { status: 'used', boundUid: uid, usedAt: 'SERVER_TIMESTAMP' },
      activationRequest: { status: 'identity_verified', uid, verifiedAt: 'SERVER_TIMESTAMP' }
    }
  };
}

export function refreshAccessClaims({ entitlement }) {
  if (!entitlement?.uid) return { allowed: false, reason: 'entitlement_missing', claims: null };
  const validation = validateDesiredAccess(entitlement);
  if (!validation.valid) return { allowed: false, reason: 'entitlement_invalid', errors: validation.errors, claims: null };
  const platformAdmin = entitlement.platformRole === 'platform_founder' || ['super_admin', 'founder_admin'].includes(entitlement.adminLevel);
  return {
    allowed: true,
    reason: 'ready',
    claims: {
      platformRole: entitlement.platformRole,
      adminLevel: entitlement.adminLevel || null,
      customerTier: entitlement.customerTier,
      entitlementVersion: V17_MODEL_VERSION,
      platformAdmin
    }
  };
}

export function plannedOrganizationDocument({ organizationId, uid, legacyBusinessId = null, label = '' }) {
  if (!organizationId || !uid) throw new Error('organizationId and uid are required.');
  return {
    organizationId,
    ownerUid: uid,
    name: String(label || '').slice(0, 120),
    status: 'active',
    legacyBusinessId: legacyBusinessId || null,
    modelVersion: V17_MODEL_VERSION
  };
}

function operationFor(currentDocument, desiredDocument) {
  if (!currentDocument) return 'CREATE_IF_ABSENT';
  return stableHash(currentDocument) === stableHash(desiredDocument) ? 'NOOP' : 'MERGE_WITH_HASH_PRECONDITION';
}

function currentAccessMatchesDesired(current = {}, desired = {}, organizationId = null) {
  return current.exists === true
    && current.status === desired.status
    && current.plan === desired.plan
    && current.planCode === desired.planCode
    && current.billingStatus === desired.billingStatus
    && current.lifetime === desired.lifetime
    && current.customerTier === desired.customerTier
    && current.expiresAt == null
    && Number(current.entitlementVersion || 0) === V17_MODEL_VERSION
    && (!organizationId || current.primaryOrganizationId === organizationId);
}

export function buildPlanCatalogDryRun(currentPlans = {}) {
  const actions = canonicalPlanDocuments().map((plan) => ({
    path: plan.path,
    operation: operationFor(currentPlans[plan.data.planId], plan.data),
    desired: plan.data
  }));
  return { actions, planHash: stableHash(actions) };
}

export function buildProvisioningDryRun({ subjectKey, resolution, current = {}, organizationId = null, includePlanCatalog = false }) {
  const subject = V17_SUBJECTS[subjectKey];
  if (!subject) throw new Error(`Unknown V17 subject: ${subjectKey}`);
  const desiredValidation = validateDesiredAccess(subject.desired);
  if (!desiredValidation.valid) throw new Error(`Invalid desired access: ${desiredValidation.errors.join(', ')}`);

  const blockers = [];
  if (!resolution?.confirmed) blockers.push(`identity:${resolution?.status || 'unresolved'}`);
  const uid = resolution?.user?.uid || null;
  const organizationMode = subjectKey === 'smith'
    ? 'PLATFORM_ONLY'
    : subjectKey === 'debby'
      ? 'JOIN_AUTHORIZED_ORGANIZATION'
      : 'PROVISION_OWNED_ORGANIZATION';
  if (resolution?.confirmed && organizationMode !== 'PLATFORM_ONLY' && !organizationId) {
    blockers.push(organizationMode === 'JOIN_AUTHORIZED_ORGANIZATION'
      ? 'authorized_organization_required'
      : 'organization_id_required');
  }
  if (resolution?.confirmed && organizationMode === 'JOIN_AUTHORIZED_ORGANIZATION' && !current.organization) {
    blockers.push('authorized_organization_must_exist');
  }

  if (subjectKey === 'lia' && resolution?.status === 'AUTH_NOT_CREATED') {
    return {
      subjectKey,
      organizationMode,
      identityStatus: resolution.status,
      decision: 'PENDING_ACTIVATION_ONLY',
      blockers: ['auth_identity_required_before_provisioning'],
      actions: [
        { path: 'activationRequests/{requestId}', operation: 'CREATE_IF_ABSENT', precondition: 'normalized_email_has_no_open_request' },
        { path: 'activationCodes/{codeHash}', operation: 'CREATE_IF_ABSENT', precondition: 'sha256_hash_only_single_use_expiring' }
      ],
      forbidden: ['create_auth_password', 'invent_uid', 'store_plaintext_code', 'create_organization_before_auth']
    };
  }

  const desired = subject.desired;
  const organization = uid && organizationId && organizationMode === 'PROVISION_OWNED_ORGANIZATION'
    ? plannedOrganizationDocument({ organizationId, uid, legacyBusinessId: current.legacyBusinessId || uid, label: current.organizationName || subject.label })
    : current.organization || null;
  const selectedPlan = PLAN_CATALOG[desired.plan];
  const entitlement = uid ? {
    uid,
    ...desired,
    primaryOrganizationId: organizationId || null,
    organizationLimit: selectedPlan.organizationLimit,
    workerLimit: selectedPlan.workerLimit,
    modelVersion: V17_MODEL_VERSION
  } : null;
  const user = uid ? {
    uid,
    email: normalizeEmail(resolution.user.email),
    displayName: String(resolution.user.displayName || current.user?.displayName || '').slice(0, 120),
    photoURL: String(resolution.user.photoURL || current.user?.photoURL || '').slice(0, 100000),
    platformRole: desired.platformRole,
    adminLevel: desired.adminLevel,
    status: desired.status,
    modelVersion: V17_MODEL_VERSION
  } : null;
  const membership = uid && organizationId ? {
    uid, organizationId, organizationRole: desired.organizationRole || 'owner', status: 'active', modelVersion: V17_MODEL_VERSION
  } : null;
  const subscription = organizationId && organizationMode === 'PROVISION_OWNED_ORGANIZATION' ? {
    organizationId, plan: desired.plan, planCode: desired.planCode, billingStatus: desired.billingStatus,
    lifetime: desired.lifetime, expiresAt: null, customerTier: desired.customerTier, status: desired.status,
    workerLimit: selectedPlan.workerLimit, modelVersion: V17_MODEL_VERSION
  } : null;

  const actions = [];
  if (includePlanCatalog) actions.push(...buildPlanCatalogDryRun(current.plans || {}).actions);
  if (uid) {
    actions.push({ path: `users/${uid}`, operation: operationFor(current.user, user), desired: user });
    actions.push({ path: `entitlements/${uid}`, operation: operationFor(current.entitlement, entitlement), desired: entitlement });
  }
  if (organization && organizationMode === 'PROVISION_OWNED_ORGANIZATION') {
    actions.push({ path: `organizations/${organizationId}`, operation: operationFor(current.organization, organization), desired: organization });
  }
  if (organization && membership) {
    actions.push({ path: `organizations/${organizationId}/members/${uid}`, operation: operationFor(current.membership, membership), desired: membership });
    actions.push({ path: `userOrganizations/${uid}/organizations/${organizationId}`, operation: operationFor(current.userOrganization, membership), desired: membership });
  }
  if (subscription) {
    actions.push({ path: `subscriptions/${organizationId}`, operation: operationFor(current.subscription, subscription), desired: subscription });
  }
  if (uid) {
    const compatibilityBusinessId = current.accountAccess?.businessId || current.legacyBusinessId || uid;
    const accessAlreadyCurrent = currentAccessMatchesDesired(current.accountAccess, desired, organizationId);
    const accountAccess = {
      ...desired,
      uid,
      email: normalizeEmail(resolution.user.email),
      businessId: compatibilityBusinessId,
      ownerId: uid,
      tenantKey: `owner:${uid}:business:${compatibilityBusinessId}`,
      primaryOrganizationId: organizationId || null,
      businessLimit: selectedPlan.organizationLimit,
      workerLimit: selectedPlan.workerLimit,
      revision: Math.max(0, Number(current.accountAccess?.revision || 0)) + (accessAlreadyCurrent ? 0 : 1),
      updatedAt: 'SERVER_TIMESTAMP'
    };
    actions.push({
      path: `accountAccess/${uid}`,
      operation: accessAlreadyCurrent ? 'NOOP' : current.accountAccess?.exists ? 'MERGE_WITH_HASH_PRECONDITION' : 'CREATE_IF_ABSENT',
      desired: accountAccess,
      beforeHash: current.accountAccess?.hash || stableHash(null)
    });
    actions.push({ path: `auth/${uid}/customClaims`, operation: 'REFRESH_AFTER_TRANSACTION', desired: {
      platformRole: desired.platformRole,
      adminLevel: desired.adminLevel,
      customerTier: desired.customerTier,
      entitlementVersion: V17_MODEL_VERSION,
      platformAdmin: desired.platformRole === 'platform_founder'
    } });
  }

  return {
    subjectKey,
    organizationMode,
    identityStatus: resolution?.status || 'unresolved',
    uid,
    organizationId,
    decision: blockers.length ? 'BLOCKED' : 'READY_FOR_APPROVAL',
    blockers,
    desired,
    backupsRequired: uid ? [
      `accountAccess/${uid}`,
      `approvedUsers/${uid}`,
      `businesses/${uid}/state/main`,
      `users/${uid}`,
      `entitlements/${uid}`,
      ...(organizationId ? [
        `organizations/${organizationId}`,
        `organizations/${organizationId}/members/${uid}`,
        `userOrganizations/${uid}/organizations/${organizationId}`,
        `subscriptions/${organizationId}`
      ] : [])
    ] : [],
    actions,
    planHash: stableHash({ subjectKey, uid, organizationId, desired, actions })
  };
}
