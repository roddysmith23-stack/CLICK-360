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

  // Both timestamps come from Firestore. Device time is never used to decide
  // whether a trial can write data.
  function evaluateAccountAccess(data = {}, serverNowMs = 0, trialDays = 7) {
    const status = String(data.status || '').toLowerCase();
    const rawPlan = String(data.planCode || data.plan || 'normal').toLowerCase();
    const plan = ['normal', 'base', 'paid_base'].includes(rawPlan) ? 'base'
      : ['pro', 'paid_pro'].includes(rawPlan) ? 'pro' : rawPlan;
    const startedAtMs = Number(data.trialStartedAtMs || 0);
    const now = Number(serverNowMs || 0);
    const trialEndsAtMs = startedAtMs ? startedAtMs + Number(trialDays || 7) * 24 * 60 * 60 * 1000 : 0;
    if (status === 'trial' || status === 'trial_active') {
      const readOnly = !now || !trialEndsAtMs || now >= trialEndsAtMs;
      return { allowed: true, readOnly, mode: readOnly ? 'trial_expired' : 'trial_active', plan: 'base', trialEndsAtMs };
    }
    if (status === 'expired' || status === 'trial_expired') return { allowed: true, readOnly: true, mode: 'trial_expired', plan: 'base', trialEndsAtMs };
    if (status === 'founder' || plan === 'founder') return { allowed: true, readOnly: false, mode: 'founder', plan: 'founder', trialEndsAtMs };
    if (status === 'lifetime' || plan === 'lifetime') return { allowed: true, readOnly: false, mode: 'lifetime', plan: 'base', trialEndsAtMs };
    if (['active', 'paid_base', 'paid_pro'].includes(status) && ['base', 'pro'].includes(plan)) {
      const activePlan = status === 'paid_pro' ? 'pro' : status === 'paid_base' ? 'base' : plan;
      return { allowed: true, readOnly: false, mode: `paid_${activePlan}`, plan: activePlan, trialEndsAtMs };
    }
    return { allowed: false, readOnly: true, mode: status || 'pending', plan, trialEndsAtMs };
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
