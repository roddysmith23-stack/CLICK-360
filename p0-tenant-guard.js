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
    const businessIds = new Set(data.businesses.map((business) => business?.id).filter(Boolean));
    if (businessIds.size === 0 || businessIds.size !== data.businesses.length) return false;
    return !data.activeBusinessId || businessIds.has(data.activeBusinessId);
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
    createSyncGate,
    guardedWrite
  };
  root.CLICK360_P0_TENANT_GUARD = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
