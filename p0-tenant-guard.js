(function(root) {
  'use strict';

  const MODES = Object.freeze({
    RESOLVING: 'resolving',
    READY: 'ready',
    LEGACY_MIGRATION_REQUIRED: 'legacy_migration_required',
    MIGRATING: 'migrating',
    BLOCKED: 'blocked'
  });
  const SCHEMA_VERSION = 10;
  const MAX_CLOUD_PAYLOAD_BYTES = 850000;
  const REQUIRED_STATE_ARRAYS = Object.freeze([
    'businesses', 'products', 'sales', 'movements', 'invoices', 'dailyReports'
  ]);

  function sameTenant(a, b) {
    return !!a && !!b
      && a.authUid === b.authUid
      && a.ownerId === b.ownerId
      && a.businessId === b.businessId
      && a.tenantKey === b.tenantKey;
  }

  function expectedIdentity(context) {
    if (!context?.ownerId || !context?.businessId || !context?.tenantKey) return null;
    return {
      ownerUid: context.ownerUid || context.ownerId,
      ownerId: context.ownerId,
      businessId: context.businessId,
      tenantKey: context.tenantKey,
      schemaVersion: SCHEMA_VERSION
    };
  }

  function sameTenantIdentity(identity, context) {
    const expected = expectedIdentity(context);
    return !!identity && !!expected
      && identity.ownerUid === expected.ownerUid
      && identity.ownerId === expected.ownerId
      && identity.businessId === expected.businessId
      && identity.tenantKey === expected.tenantKey
      && Number(identity.schemaVersion) === SCHEMA_VERSION;
  }

  function utf8Bytes(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).byteLength;
    if (typeof Buffer !== 'undefined') return Buffer.byteLength(text, 'utf8');
    return text.length;
  }

  function safeImageSrc(value) {
    const src = String(value || '').trim();
    if (!src) return '';
    if (/^https:\/\/[^\s"'<>]+$/i.test(src)) return src;
    if (/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(src)) return src;
    return '';
  }

  function validBusinessPayload(payload, context) {
    const data = payload?.data;
    if (!sameTenantIdentity(payload?.identity, context) || !data || typeof data !== 'object') return false;
    if (!REQUIRED_STATE_ARRAYS.every((key) => Array.isArray(data[key]))) return false;
    if (!Array.isArray(data.deletedProducts || []) || !Array.isArray(data.auditLogs || [])) return false;
    if (!data.settings || !Array.isArray(data.settings.workers || []) || !Array.isArray(data.settings.labelTemplates || [])) return false;
    if (data.settings.customers != null && !Array.isArray(data.settings.customers)) return false;
    if (data.settings.reminders != null && !Array.isArray(data.settings.reminders)) return false;
    if (data.layaways != null && !Array.isArray(data.layaways)) return false;
    if (data.cashSessions != null && !Array.isArray(data.cashSessions)) return false;
    if (data.tables != null && !Array.isArray(data.tables)) return false;
    if (data.tableOrders != null && !Array.isArray(data.tableOrders)) return false;
    if (data.labelPrintHistory != null && !Array.isArray(data.labelPrintHistory)) return false;
    if (data.settings.labelProfiles != null && !Array.isArray(data.settings.labelProfiles)) return false;
    if (data.finance != null) {
      if (!data.finance || typeof data.finance !== 'object' || Array.isArray(data.finance)) return false;
      if (!['payments','loans','envelopes','goals'].every((key) => Array.isArray(data.finance[key] || []))) return false;
    }
    if (data.notifications != null && !Array.isArray(data.notifications)) return false;
    if (data.legalAcceptances != null && !Array.isArray(data.legalAcceptances)) return false;
    const businessIds = new Set(data.businesses.map((business) => business?.id).filter(Boolean));
    if (businessIds.size === 0 || businessIds.size !== data.businesses.length) return false;
    return !data.activeBusinessId || businessIds.has(data.activeBusinessId);
  }

  function markerIdentityMatches(value, context) {
    if (!context || !value || typeof value !== 'object') return false;
    const candidates = [value.context, value.identity, value.tenant, value];
    return candidates.some((candidate) => candidate
      && candidate.authUid === context.authUid
      && candidate.ownerId === context.ownerId
      && candidate.businessId === context.businessId
      && candidate.tenantKey === context.tenantKey);
  }

  function parseMarker(value) {
    try { return JSON.parse(value); } catch { return null; }
  }

  // Standalone timestamp coercion for this module -- deliberately duplicated
  // from v16-domain.js's timestampMs() rather than imported, because this
  // whole function exists precisely for the case where v16-domain.js is NOT
  // yet available (see accessStateFromData() in firebase-service.js). It
  // must have zero dependency on that module.
  function normalizeAccessEpochMs(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return 0;
    if (number < 100_000_000_000) return Math.round(number * 1000);
    if (number > 100_000_000_000_000) return Math.round(number / 1000);
    return Math.round(number);
  }

  function accessTimestampMs(value) {
    if (typeof value?.toMillis === 'function') return normalizeAccessEpochMs(value.toMillis());
    if (Number.isFinite(Number(value?.seconds))) {
      return normalizeAccessEpochMs(Number(value.seconds) * 1000 + Number(value?.nanoseconds || 0) / 1_000_000);
    }
    if (Number.isFinite(Number(value))) return normalizeAccessEpochMs(value);
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function normalizeAccessPlan(value) {
    const plan = String(value || '').trim().toLowerCase();
    if (['normal', 'base', 'basic', 'paid_base'].includes(plan)) return 'base';
    if (['pro', 'paid_pro', 'pro_lifetime'].includes(plan)) return 'pro';
    if (['business', 'paid_business'].includes(plan)) return 'business';
    if (['enterprise', 'paid_enterprise'].includes(plan)) return 'enterprise';
    if (plan === 'founder_legacy') return 'founder_legacy';
    if (['founder', 'founder_unlimited'].includes(plan)) return 'founder';
    if (plan === 'lifetime') return 'lifetime';
    return 'base';
  }

  // Both timestamps come from Firestore. Device time is never used to decide
  // whether a trial can write data.
  //
  // This function is the fallback entitlement evaluator used only when
  // v16-domain.js's evaluateEntitlement() has not yet registered on
  // window.CLICK360_V16_DOMAIN (see accessStateFromData() in
  // firebase-service.js). It MUST produce the same allowed/readOnly
  // commercial decision as evaluateEntitlement() for every status that
  // function currently recognizes -- see qa/entitlement-evaluator-parity.mjs,
  // a permanent regression test asserting exactly that. A prior version of
  // this function had no branch for 'founder_legacy' at all (silently
  // falling through to allowed:false for a real, valid, permanent-access
  // customer -- the proven root cause of the 2026-08-25/26
  // AUTH_ACCOUNT_ACCESS_REJECTED incident), read the wrong trial-start field
  // name (trialStartedAtMs instead of the real trialStartedAt Timestamp,
  // always treating trial users as expired), never applied the
  // subscription-expiry check to paid statuses, and did not recognize
  // paid_business/paid_enterprise or member at all.
  function evaluateAccountAccess(data = {}, serverNowMs = 0, trialDays = 7) {
    const status = String(data.status || '').toLowerCase();
    const rawPlan = String(data.planCode || data.plan || '').trim().toLowerCase();
    const plan = normalizeAccessPlan(data.planCode || data.plan);
    const billingStatus = String(data.billingStatus || '').toLowerCase();
    // trialStartedAt is the real field (a Firestore Timestamp, see
    // resolveAccountAccess()'s new-tenant creation in firebase-service.js).
    // trialStartedAtMs is kept as a legacy/back-compat fallback only.
    const startedAtMs = accessTimestampMs(data.trialStartedAt) || Number(data.trialStartedAtMs || 0);
    const now = accessTimestampMs(serverNowMs || data.lastSeenAt || data.serverNow);
    const trialEndsAtMs = startedAtMs ? startedAtMs + Number(trialDays || 7) * 24 * 60 * 60 * 1000 : 0;
    const expiresAtMs = accessTimestampMs(data.expiresAt);
    if (status === 'active' && rawPlan === 'pro_lifetime') {
      const activeLifetime = data.lifetime === true && billingStatus === 'lifetime';
      return activeLifetime
        ? { allowed: true, readOnly: false, mode: 'lifetime', plan: 'pro', trialEndsAtMs }
        : { allowed: false, readOnly: true, mode: 'pending_activation', plan: 'pro', trialEndsAtMs };
    }
    if (status === 'trial' || status === 'trial_active') {
      const readOnly = !now || !trialEndsAtMs || now >= trialEndsAtMs;
      return { allowed: true, readOnly, mode: readOnly ? 'trial_expired' : 'trial_active', plan: 'base', trialEndsAtMs };
    }
    if (status === 'expired' || status === 'trial_expired') return { allowed: true, readOnly: true, mode: 'trial_expired', plan: 'base', trialEndsAtMs };
    if (status === 'founder' || plan === 'founder') return { allowed: true, readOnly: false, mode: 'founder', plan: 'founder', trialEndsAtMs };
    // Real commercial tier for historical customers (SHARY, Lia): permanent,
    // never expires, no billing -- mirrors v16-domain.js's evaluateEntitlement()
    // exactly. Must never depend on expiresAt/clock/grace/trial state.
    if (status === 'founder_legacy' || plan === 'founder_legacy') return { allowed: true, readOnly: false, mode: 'founder_legacy', plan: 'founder_legacy', trialEndsAtMs };
    if (status === 'lifetime' || plan === 'lifetime') return { allowed: true, readOnly: false, mode: 'lifetime', plan: 'base', trialEndsAtMs };
    if (['active', 'paid_base', 'paid_pro', 'paid_business', 'paid_enterprise'].includes(status) && ['base', 'pro', 'business', 'enterprise'].includes(plan)) {
      const statusPlanMap = { paid_base: 'base', paid_pro: 'pro', paid_business: 'business', paid_enterprise: 'enterprise' };
      const activePlan = statusPlanMap[status] || plan;
      const readOnly = !!expiresAtMs && !!now && now >= expiresAtMs;
      return { allowed: true, readOnly, mode: readOnly ? 'subscription_expired' : `paid_${activePlan}`, plan: activePlan, trialEndsAtMs };
    }
    if (status === 'member') return { allowed: true, readOnly: false, mode: 'member', plan, trialEndsAtMs };
    return { allowed: false, readOnly: true, mode: status || 'pending_activation', plan, trialEndsAtMs };
  }

  // Old CLICK 360 builds used several marker shapes. Only remove a marker when
  // it is the exact active tenant key or its serialized identity is complete.
  // Ambiguous global legacy keys are intentionally preserved and never unlock a
  // tenant by themselves.
  function reconcileLegacyMarkers(storage, context) {
    if (!storage || !context?.authUid || !context?.tenantKey) return [];
    const removable = new Set([
      `CLICK360_TENANT:${context.tenantKey}:LEGACY_MIGRATION_REQUIRED`,
      `CLICK360_TENANT:${context.tenantKey}:CORRUPT`
    ]);
    const namespacedPrefixes = [
      `CLICK360:V10:QUARANTINE:${context.authUid}:${context.tenantKey}:`,
      `CLICK360:V16:QUARANTINE:${context.authUid}:${context.tenantKey}:`
    ];
    const oldPrefixes = ['CLICK360_QUARANTINED:', 'CLICK360_QUARANTINE:', 'CLICK360_LEGACY_QUARANTINED:'];
    const keys = [];
    for (let index = 0; index < Number(storage.length || 0); index += 1) {
      const key = storage.key(index);
      if (key) keys.push(key);
    }
    keys.forEach((key) => {
      if (namespacedPrefixes.some((prefix) => key.startsWith(prefix))) {
        removable.add(key);
        return;
      }
      if (!oldPrefixes.some((prefix) => key.startsWith(prefix))) return;
      const value = storage.getItem(key);
      if (markerIdentityMatches(parseMarker(value), context)) removable.add(key);
    });
    const removed = [];
    removable.forEach((key) => {
      if (storage.getItem(key) == null) return;
      storage.removeItem(key);
      removed.push(key);
    });
    return removed;
  }

  function createSyncGate() {
    let context = null;
    let mode = MODES.RESOLVING;
    let legacy = null;

    return {
      begin(nextContext) {
        context = nextContext || null;
        mode = MODES.RESOLVING;
        legacy = null;
      },
      requireLegacy(nextContext, metadata) {
        if (!sameTenant(context, nextContext)) return false;
        mode = MODES.LEGACY_MIGRATION_REQUIRED;
        legacy = metadata || null;
        return true;
      },
      startMigration(nextContext) {
        if (!sameTenant(context, nextContext) || mode !== MODES.LEGACY_MIGRATION_REQUIRED) return false;
        mode = MODES.MIGRATING;
        return true;
      },
      allow(nextContext) {
        if (!sameTenant(context, nextContext)) return false;
        mode = MODES.READY;
        legacy = null;
        return true;
      },
      block() {
        mode = MODES.BLOCKED;
      },
      reset() {
        context = null;
        mode = MODES.RESOLVING;
        legacy = null;
      },
      canWrite(nextContext) {
        return mode === MODES.READY && sameTenant(context, nextContext);
      },
      canUnlock(nextContext) {
        return mode === MODES.READY && sameTenant(context, nextContext);
      },
      snapshot() {
        return { mode, context, legacy };
      }
    };
  }

  async function guardedWrite(gate, context, write) {
    if (!gate || !gate.canWrite(context)) return false;
    await write();
    return true;
  }

  const api = {
    MODES,
    SCHEMA_VERSION,
    MAX_CLOUD_PAYLOAD_BYTES,
    sameTenant,
    expectedIdentity,
    sameTenantIdentity,
    utf8Bytes,
    safeImageSrc,
    validBusinessPayload,
    evaluateAccountAccess,
    markerIdentityMatches,
    reconcileLegacyMarkers,
    createSyncGate,
    guardedWrite
  };
  root.CLICK360_P0_TENANT_GUARD = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
