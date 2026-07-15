(function (root) {
  'use strict';

  const STATES = Object.freeze({
    LOADING: 'loading',
    UNAUTHENTICATED: 'unauthenticated',
    AUTHENTICATED_RESOLVING: 'authenticated_resolving',
    INVALID_INVITATION: 'invalid_invitation',
    RECOVERABLE_ERROR: 'recoverable_error',
    AUTHENTICATED_NO_ACCESS: 'authenticated_no_access',
    IDENTITY_RECONCILIATION_REQUIRED: 'identity_reconciliation_required',
    PENDING: 'pending',
    BLOCKED: 'blocked',
    LEGACY_MIGRATION_REQUIRED: 'legacy_migration_required',
    ONLINE_ONLY_SAFE: 'online_only_safe',
    FOUNDER: 'founder',
    PAID_BASE: 'paid_base',
    PAID_PRO: 'paid_pro',
    LIFETIME: 'lifetime',
    TRIAL_ACTIVE: 'trial_active',
    TRIAL_EXPIRED: 'trial_expired',
    MEMBER: 'member',
    READY: 'ready'
  });

  const PUBLIC_STATES = new Set([
    STATES.UNAUTHENTICATED,
    STATES.INVALID_INVITATION,
    STATES.RECOVERABLE_ERROR,
    STATES.AUTHENTICATED_NO_ACCESS
  ]);

  function gatePolicy(state, authenticated = false) {
    const normalized = Object.values(STATES).includes(state) ? state : STATES.RECOVERABLE_ERROR;
    const showPublicActions = PUBLIC_STATES.has(normalized);
    return Object.freeze({
      state: normalized,
      showPublicActions,
      showLogin: showPublicActions,
      showRetry: [STATES.INVALID_INVITATION, STATES.RECOVERABLE_ERROR, STATES.IDENTITY_RECONCILIATION_REQUIRED].includes(normalized),
      showChangeAccount: authenticated && normalized !== STATES.AUTHENTICATED_RESOLVING,
      showRefreshAssets: authenticated && [STATES.BLOCKED, STATES.RECOVERABLE_ERROR].includes(normalized)
    });
  }

  function stateForAccess(access = {}, onlineOnlySafe = false) {
    if (onlineOnlySafe) return STATES.ONLINE_ONLY_SAFE;
    const byMode = {
      founder: STATES.FOUNDER,
      paid_base: STATES.PAID_BASE,
      paid_pro: STATES.PAID_PRO,
      lifetime: STATES.LIFETIME,
      trial_active: STATES.TRIAL_ACTIVE,
      trial_expired: STATES.TRIAL_EXPIRED,
      subscription_expired: STATES.TRIAL_EXPIRED,
      member: STATES.MEMBER
    };
    return byMode[access.mode] || STATES.READY;
  }

  function invitationIntentValid(stored, current, nowMs = Date.now()) {
    const fresh = Number(stored?.createdAtMs || 0) > Number(nowMs) - 30 * 60 * 1000;
    return fresh
      && current?.flow === 'invite'
      && !!current.ownerId
      && !!current.inviteToken
      && !!current.inviteSession
      && stored?.ownerId === current.ownerId
      && stored?.sessionId === current.inviteSession
      && Number(stored?.tokenLength) === String(current.inviteToken).length;
  }

  const RESOLUTION_ORDER = Object.freeze([
    'firebase_auth_uid',
    'account_access',
    'entitlement',
    'tenant_state',
    'legacy_guard',
    'approved_user_compatibility',
    'explicit_invitation'
  ]);

  root.CLICK360_ACCESS_FLOW = Object.freeze({ STATES, RESOLUTION_ORDER, gatePolicy, stateForAccess, invitationIntentValid });
})(typeof window !== 'undefined' ? window : globalThis);
