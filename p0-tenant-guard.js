(function(root) {
  'use strict';

  const MODES = Object.freeze({
    RESOLVING: 'resolving',
    READY: 'ready',
    LEGACY_MIGRATION_REQUIRED: 'legacy_migration_required',
    MIGRATING: 'migrating',
    BLOCKED: 'blocked'
  });

  function sameTenant(a, b) {
    return !!a && !!b
      && a.authUid === b.authUid
      && a.ownerId === b.ownerId
      && a.businessId === b.businessId
      && a.tenantKey === b.tenantKey;
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

  const api = { MODES, sameTenant, createSyncGate, guardedWrite };
  root.CLICK360_P0_TENANT_GUARD = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
