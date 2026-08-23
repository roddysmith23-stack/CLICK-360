import { stableHash } from './click360-data-core.mjs';

export const REQUIRED_PROJECT_ID = 'click-360';
export const AUTHORIZED_ADMIN_EMAILS = Object.freeze(['roddysmithceo@gmail.com']);
// Mirrors PLAN_CATALOG[code].limits.{businesses,workerSeatsMax} in
// v16-domain.js, projected into the legacy {businesses,workers} shape (see
// that file's planLimits()). Duplicated here (not imported) because
// v16-domain.js is a browser IIFE, not a Node ESM module -- keep these two
// in sync by hand whenever PLAN_CATALOG limits change.
export const PLAN_LIMITS = Object.freeze({
  base: Object.freeze({ businesses: 1, workers: 5 }),
  pro: Object.freeze({ businesses: 5, workers: 10 }),
  business: Object.freeze({ businesses: 10, workers: 25 }),
  enterprise: Object.freeze({ businesses: 25, workers: 9999 }),
  founder_legacy: Object.freeze({ businesses: 10, workers: 25 })
});

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}
export function plainFirestoreValue(value) {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(plainFirestoreValue);
  if (value instanceof Date) return { __dateMs: value.getTime() };
  if (Number.isFinite(value.seconds) && Number.isFinite(value.nanoseconds)) {
    return { __timestampSeconds: Number(value.seconds), __timestampNanoseconds: Number(value.nanoseconds) };
  }
  if (typeof value.toMillis === 'function') return { __timestampMs: Number(value.toMillis()) };
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plainFirestoreValue(item)]));
}

export function firestoreHash(value) {
  return stableHash(plainFirestoreValue(value));
}

export function assertAdminScope({ projectId, actorEmail, authUser, expectedUid, expectedEmail, businessId }) {
  const reasons = [];
  const actor = normalizeEmail(actorEmail);
  const email = normalizeEmail(expectedEmail);
  if (projectId !== REQUIRED_PROJECT_ID) reasons.push('wrong_project');
  if (!AUTHORIZED_ADMIN_EMAILS.includes(actor)) reasons.push('unauthorized_actor');
  if (!authUser?.uid) reasons.push('auth_user_missing');
  if (authUser?.disabled) reasons.push('auth_user_disabled');
  if (!expectedUid || authUser?.uid !== expectedUid) reasons.push('uid_mismatch');
  if (!email || normalizeEmail(authUser?.email) !== email) reasons.push('email_mismatch');
  if (authUser?.uid === 'demo-click360' || businessId === 'demo-click360') reasons.push('demo_tenant_forbidden');
  return { allowed: reasons.length === 0, reasons, actorEmail: actor, uid: authUser?.uid || null, email };
}

export function stateIdentitySummary(document, uid) {
  const tenantKey = `owner:${uid}:business:${uid}`;
  const data = document?.payload?.data || null;
  const valid = !!document
    && document.schemaVersion === 10
    && document.ownerUid === uid
    && document.ownerId === uid
    && document.businessId === uid
    && document.tenantKey === tenantKey
    && document.payload?.schemaVersion === 10
    && document.payload?.identity?.ownerUid === uid
    && document.payload?.identity?.ownerId === uid
    && document.payload?.identity?.businessId === uid
    && document.payload?.identity?.tenantKey === tenantKey;
  return {
    exists: !!document,
    valid,
    schemaVersion: document?.schemaVersion || null,
    revision: Number(document?.revision || 0),
    tenantKey: document?.tenantKey || null,
    stateHash: document ? firestoreHash(document) : null,
    counts: {
      businesses: Array.isArray(data?.businesses) ? data.businesses.length : 0,
      products: Array.isArray(data?.products) ? data.products.length : 0,
      sales: Array.isArray(data?.sales) ? data.sales.length : 0,
      movements: Array.isArray(data?.movements) ? data.movements.length : 0,
      invoices: Array.isArray(data?.invoices) ? data.invoices.length : 0,
      reports: Array.isArray(data?.dailyReports) ? data.dailyReports.length : 0,
      workers: Array.isArray(data?.settings?.workers) ? data.settings.workers.length : 0,
      templates: Array.isArray(data?.settings?.labelTemplates) ? data.settings.labelTemplates.length : 0
    }
  };
}

export function activationConfirmation(uid, plan, period) {
  return `ACTIVATE:${uid}:${String(plan || '').toUpperCase()}:${String(period || '').toUpperCase()}`;
}

export function suspendConfirmation(uid) {
  return `SUSPEND:${uid}`;
}

function baseAccountFields(existing, authUser) {
  return {
    uid: authUser.uid,
    businessId: authUser.uid,
    email: normalizeEmail(authUser.email),
    name: String(existing.name || authUser.displayName || '').slice(0, 120),
    photoURL: String(existing.photoURL || authUser.photoURL || '').slice(0, 100000)
  };
}

export function activationFields({ existing = {}, authUser, actorEmail, plan = 'base', period = 'historical', businessType = '', addOnsRequested = [] }) {
  const normalizedPlan = String(plan || '').toLowerCase();
  const normalizedPeriod = String(period || '').toLowerCase();
  if (!['base', 'pro', 'business', 'enterprise', 'founder_legacy'].includes(normalizedPlan)) {
    throw new Error('Plan must be base, pro, business, enterprise, or founder_legacy.');
  }
  // Business type only presets the customer's own UX (see app.js onboarding
  // form); it never grants or restricts rights -- the plan alone does that.
  // Recorded here purely as a sales/onboarding record for AIIA.
  const normalizedBusinessType = String(businessType || '').trim().slice(0, 40);
  const normalizedAddOns = Array.isArray(addOnsRequested) ? addOnsRequested.map((item) => String(item).trim()).filter(Boolean).slice(0, 20) : [];
  const onboardingProfile = (normalizedBusinessType || normalizedAddOns.length)
    ? { businessType: normalizedBusinessType || null, addOnsRequested: normalizedAddOns, recordedAt: new Date().toISOString(), recordedBy: normalizeEmail(actorEmail) }
    : (existing.onboardingProfile || null);
  // founder_legacy: permanent historical functional license (SHARY, Lia) --
  // no billing period, never expires. See v16-domain.js evaluateEntitlement()
  // and firestore.rules' matching founder_legacy branch, both keyed on
  // status=="founder_legacy" && plan=="founder_legacy".
  if (normalizedPlan === 'founder_legacy') {
    if (normalizedPeriod !== 'historical') throw new Error('founder_legacy has no billing period; use --period historical.');
    const limits = PLAN_LIMITS.founder_legacy;
    return {
      ...baseAccountFields(existing, authUser),
      status: 'founder_legacy',
      plan: 'founder_legacy',
      planCode: 'founder_legacy',
      lifetime: false,
      activationPeriod: 'historical',
      source: 'founder_legacy_grant',
      entitlementVersion: 16,
      revision: Math.max(0, Number(existing.revision || 0)) + 1,
      businessLimit: limits.businesses,
      workerLimit: limits.workers,
      activatedBy: normalizeEmail(actorEmail),
      onboardingProfile
    };
  }
  if (!['historical', 'month', 'quarter', 'semester', 'year', 'lifetime'].includes(normalizedPeriod)) throw new Error('Invalid activation period.');
  if (normalizedPlan !== 'base' && normalizedPeriod === 'lifetime') throw new Error('Lifetime billing is only available on the Basic plan.');
  const limits = PLAN_LIMITS[normalizedPlan];
  const lifetime = normalizedPeriod === 'lifetime';
  return {
    ...baseAccountFields(existing, authUser),
    status: lifetime ? 'lifetime' : `paid_${normalizedPlan}`,
    plan: normalizedPlan,
    planCode: normalizedPlan,
    lifetime,
    activationPeriod: normalizedPeriod,
    source: normalizedPeriod === 'historical' ? 'historical_buyer_recovery' : 'admin_activation',
    entitlementVersion: 16,
    revision: Math.max(0, Number(existing.revision || 0)) + 1,
    businessLimit: limits.businesses,
    workerLimit: limits.workers,
    activatedBy: normalizeEmail(actorEmail),
    onboardingProfile
  };
}
