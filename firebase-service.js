(function () {
  if (!window.firebase || !window.CLICK360_FIREBASE_CONFIG) {
    console.error("CLICK360 Firebase no está cargado.");
    return;
  }

  if (!firebase.apps.length) firebase.initializeApp(window.CLICK360_FIREBASE_CONFIG);

  if (!window.CLICK360_P0_TENANT_GUARD) {
    console.error("CLICK360 P0 tenant guard no está cargado.");
    return;
  }

  const APP_ASSET_VERSION = 'commercial-1-0-5-r38-mvp-candidate';
	  const FIRESTORE_SCHEMA_VERSION = '16.2.0';
  // r37.2.1 (LIVE CLIENT RECOVERY -- real SHARY incident): this used to also
  // delete every stale click360- cache here, unconditionally, on every page
  // script execution -- gated only by a string baked into whichever version
  // of THIS file happened to be currently running, not by any proof this
  // device's service worker had actually finished activating the
  // corresponding new cache. That is the same destroy-before-confirming
  // shape as the other two incidents: if this script executed before the
  // new worker actually won activation, it could delete a cache an old,
  // still-controlling worker still depended on. service-worker.js's own
  // 'activate' handler already does this exact cleanup at the only
  // genuinely safe point in the lifecycle (it only fires once the new
  // worker has actually taken over), so the duplicate here was redundant
  // as well as risky -- removed rather than gated.

	  const auth = firebase.auth();
	  const db = firebase.firestore();
	  db.enablePersistence({ synchronizeTabs: true }).catch(err => {
	    console.warn("Persistencia offline de Firestore no disponible:", err.message);
	  });

  window.click360Auth = auth;
  window.click360Db = db;
  let BUSINESS_ID = null;
  let STATE_DOC = null;
  let ACTIVE_CONTEXT = null;
  let MODULAR_GATEWAY = null;
  let MODULAR_BASELINE = null;
  let MODULAR_MODE = false;
  let AUTH_EPOCH = 0;
	  const tenantGuard = window.CLICK360_P0_TENANT_GUARD.createSyncGate();

  let AUTH_APPROVED = false;
  // r37.2.5 (P0, real SHARY incident): set true only around the exact
  // CAS-dependent window of a same-entity conflict-retry (see
  // window.click360SetCriticalWriteGuard below) -- NOT a generic "any modal
  // is open" flag, which was tried first and broke unrelated flows
  // (qa/r37-2-2-empty-device-cloud-recovery-e2e.mjs) that rightly expect
  // background convergence to keep working while some other modal happens
  // to be open.
  let CRITICAL_WRITE_GUARD_ACTIVE = false;
  let PULL_COMPLETE = false;
  let IS_RESTORING_REMOTE = false;
  let INITIAL_TENANT_SEED_REQUIRED = false;
  const TENANT_MATERIAL_EVIDENCE = new Set();
  let REMOTE_UNSUBSCRIBE = null;
  let USER_STATUS_UNSUBSCRIBE = null;
		  let ACCESS_UNSUBSCRIBE = null;
		  let ACCESS_READ_ONLY = false;
		  let ACCESS_EXPIRY_TIMER = null;
			  let LOCAL_WRITE_PENDING_UNTIL = 0;
			  let LAST_REMOTE_REVISION = 0;
			  const PENDING_REMOTE_SYNC_GRACE_MS = 8000;
			  const PENDING_REMOTE_SYNC_TTL_MS = 2 * 60 * 1000;
			  const SYNC_CONFLICT_TTL_MS = 10 * 60 * 1000;
			  const UNKNOWN_LOCK_AGE_MS = Number.MAX_SAFE_INTEGER;
			  const NON_MATERIAL_SYNC_SOURCES = new Set([
			    'business_switch',
			    'non_blocking_local_change',
			    'table_layout_change',
			    'restaurant_layout_change',
			    'restaurant_table_layout',
			    'cloud_confirmed',
			    'remote_applied',
			    'indexeddb_recovery_already_synced',
			    'stale_sync_guard',
			    'manual_local_recovery'
			  ]);
			  const PUSH_SCHEDULERS = new Map();
			  let SYNC_CONFLICT_PENDING = false;
			  let ONLINE_ONLY_SAFE = false;

			  const rawSetItem = (key, value) => window.localStorage.setItem(key, value);
	  const PROFILE_CACHE_PREFIX = "CLICK360:V16:PROFILE:";
	  const PROFILE_PENDING_PREFIX = 'CLICK360:V16:PROFILE_PENDING:';
	  const LEGACY_PROFILE_CACHE_PREFIX = "CLICK360_USER_PROFILE_";
	  const LEGACY_PROFILE_PENDING_PREFIX = 'CLICK360_PROFILE_PENDING:';
	  const LEGACY_STATE_LS_KEY = 'click360_mvp_qa_final_state_v1';
	  const DEVICE_ID_PREFIX = "CLICK360:V16:DEVICE:";
	  const APPROVED_IDENTITY_PREFIX = "CLICK360:V16:APPROVED:";
	  const LEGACY_APPROVED_IDENTITY_PREFIX = "CLICK360_APPROVED_IDENTITY:";
	  const ACCOUNT_ACCESS_COLLECTION = 'accountAccess';
	  const ACCOUNT_ACCESS_CACHE_PREFIX = 'CLICK360:V16:ACCOUNT_ACCESS:';
		  const TRIAL_DAYS = 7;
			  const PUBLIC_INTENT_KEY = 'CLICK360:V16_2:PUBLIC_INTENT';
			  const EXPLICIT_INVITATION_KEY = 'CLICK360:V16_2:EXPLICIT_INVITATION';
		  const AUTH_REDIRECT_PENDING_KEY = 'CLICK360:V16_2:AUTH_REDIRECT_PENDING';
			  const PUBLIC_INTENTS = new Set(['login', 'trial', 'register', 'invite']);
			  let PUBLIC_AUTH_INTENT = null;
			  let AUTH_REQUEST_IN_FLIGHT = false;
			  let APPROVED_LOOKUP_STATUS = 'unresolved';
		  let AUTH_PERSISTENCE_READY = true;
		  let AUTH_REDIRECT_RESULT_STATUS = 'not_checked';
		  let AUTH_REDIRECT_RESULT_ERROR = '';
			  const ACCESS_UI_STATES = window.CLICK360_ACCESS_FLOW?.STATES || Object.freeze({
			    LOADING: 'loading',
			    UNAUTHENTICATED: 'unauthenticated',
			    AUTHENTICATED_RESOLVING: 'authenticated_resolving',
			    INVALID_INVITATION: 'invalid_invitation',
			    RECOVERABLE_ERROR: 'recoverable_error',
			    AUTHENTICATED_NO_ACCESS: 'authenticated_no_access',
			    PENDING: 'pending',
			    BLOCKED: 'blocked',
			    ONLINE_ONLY_SAFE: 'online_only_safe',
			    READY: 'ready'
			  });
			  const ACCESS_UI_STATE_VALUES = new Set(Object.values(ACCESS_UI_STATES));
			  let ACCESS_UI_STATE = ACCESS_UI_STATES.LOADING;
		  const SCHEMA_VERSION = 10;
	  const OFFLINE_APPROVAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;
	  const MAX_CLOUD_PAYLOAD_BYTES = window.CLICK360_P0_TENANT_GUARD.MAX_CLOUD_PAYLOAD_BYTES;
	  function tenantKeyFor(ownerId, businessId) {
	    return `owner:${ownerId}:business:${businessId}`;
	  }
	  function tenantStorageKey(suffix) {
	    return ACTIVE_CONTEXT ? `CLICK360_TENANT:${ACTIVE_CONTEXT.tenantKey}:${suffix}` : '';
	  }
	  function tenantStorageKeyFor(context, suffix) {
	    return context?.tenantKey ? `CLICK360_TENANT:${context.tenantKey}:${suffix}` : '';
	  }
		  function approvedIdentityStorageKey(uid) {
	    return uid ? `${APPROVED_IDENTITY_PREFIX}${uid}` : '';
	  }
	  function safeStorageGet(key) {
	    if (!key) return null;
	    try { return localStorage.getItem(key); } catch { return null; }
	  }
		  function safeStorageRemove(key) {
	    if (!key) return false;
	    try { localStorage.removeItem(key); return true; } catch { return false; }
	  }
	  function legacyMigrationMarkerKey() {
	    return tenantStorageKey('LEGACY_MIGRATION_REQUIRED');
	  }
	  function accountAccessRef(uid = auth.currentUser?.uid) {
	    return uid ? db.collection(ACCOUNT_ACCESS_COLLECTION).doc(uid) : null;
	  }
	  function accountAccessCacheKey(uid) {
	    return uid ? `${ACCOUNT_ACCESS_CACHE_PREFIX}${uid}` : '';
	  }
	  function memberRef(ownerId, uid) {
	    return ownerId && uid ? db.collection('businesses').doc(ownerId).collection('members').doc(uid) : null;
	  }
	  function invitationRef(ownerId, inviteHash) {
	    return ownerId && inviteHash ? db.collection('businesses').doc(ownerId).collection('invitations').doc(inviteHash) : null;
	  }
	  function invitationSecretRef(ownerId, inviteHash) {
	    return ownerId && inviteHash ? db.collection('businesses').doc(ownerId).collection('ownerInviteSecrets').doc(inviteHash) : null;
	  }
	  function defaultWorkerPermissions(role = 'worker') {
	    const cashier = role === 'cashier';
	    const inventory = role === 'inventory';
	    const legacy = {
	      inventory: { view: !cashier, create: !cashier, edit: !cashier, delete: role === 'worker', export: false, manage: false },
	      sales: { view: !inventory, create: !inventory, edit: role === 'worker', delete: false, approve: false, export: false, manage: false },
	      cash: { view: !inventory, create: !inventory, edit: !inventory, delete: false, approve: false, export: false, manage: false },
	      customers: { view: role === 'worker', create: role === 'worker', edit: role === 'worker', delete: false, export: false, manage: false },
	      reports: { view: role === 'worker', create: false, edit: false, delete: false, export: false, manage: false },
	      reminders: { view: role === 'worker', create: role === 'worker', edit: role === 'worker', delete: false, manage: false },
	      settings: { view: false, edit: false, manage: false },
	      suppliers: { view: role === 'worker', create: false, edit: false, delete: false, manage: false },
	      workers: { view: false, create: false, edit: false, delete: false, manage: false }
	    };
	    const modular = window.CLICK360_WORKER_DATA_BOUNDARY?.normalizePermissionMap?.(role) || {};
	    return {
	      ...legacy,
	      ...modular,
	      sales: { ...(modular.sales || {}), ...legacy.sales },
	      settings: { ...(modular.settings || {}), ...legacy.settings }
	    };
	  }
	  function resolveEffectiveReadOnly(accessState = {}) {
	    if (typeof window.click360ResolveReadOnly === 'function') return window.click360ResolveReadOnly(accessState);
	    const mode = String(accessState.mode || '').toLowerCase();
	    const status = String(accessState.status || '').toLowerCase();
	    const plan = String(accessState.plan || '').toLowerCase();
	    const planCode = String(accessState.planCode || '').toLowerCase();
	    const billingStatus = String(accessState.billingStatus || '').toLowerCase();
	    const platformRole = String(accessState.platformRole || '').toLowerCase();
	    const customerTier = String(accessState.customerTier || '').toLowerCase();
	    if (['suspended', 'blocked', 'disabled'].includes(status) || ['blocked', 'suspended'].includes(mode)) return true;
	    if (platformRole === 'platform_founder' || customerTier === 'platform_founder') return false;
	    if (plan === 'founder_unlimited' || planCode === 'founder_unlimited') return false;
	    if (mode === 'founder' || mode === 'lifetime' || mode === 'member') return false;
	    if (accessState.lifetime === true && billingStatus === 'lifetime') return false;
	    if (planCode === 'pro_lifetime' && billingStatus === 'lifetime' && accessState.lifetime === true) return false;
	    if (mode === 'trial_active') return false;
	    if (mode === 'paid_base' || mode === 'paid_pro') return accessState.readOnly === true;
	    return accessState.readOnly === true;
	  }
	  function isEffectiveReadOnly() {
	    const access = typeof window.click360GetEffectiveAccess === 'function'
	      ? window.click360GetEffectiveAccess()
	      : window.click360AccessState;
	    return resolveEffectiveReadOnly(access || {});
	  }
	  function accessDoesNotExpire(state = window.click360AccessState || {}) {
	    const mode = String(state.mode || '').toLowerCase();
	    const plan = String(state.plan || '').toLowerCase();
	    return ['founder', 'lifetime', 'member'].includes(mode)
	      || ['founder', 'founder_unlimited', 'lifetime'].includes(plan);
	  }
			  function writeGateStatus() {
			    if (!AUTH_APPROVED) return { allowed: false, reason: 'auth_not_ready' };
			    if (isEffectiveReadOnly()) return { allowed: false, reason: 'read_only' };
			    if (legacyMigrationRequired()) return { allowed: false, reason: 'legacy_migration_required' };
			    if (MODULAR_MODE) {
			      if (!tenantGuard.canWrite(ACTIVE_CONTEXT)) return { allowed:false, reason:'tenant_guard_not_ready' };
			      // r37 (Section 41-49 offline audit): this used to hard-block ALL
			      // modular/worker writes while offline, unlike legacy/owner mode
			      // (which only blocks when ONLINE_ONLY_SAFE -- local storage itself
			      // is unavailable). pushModularState() already no-ops safely offline
			      // (sets status 'offline', never throws) and the local write below
			      // persists to the SAME localStorage/IndexedDB path legacy mode
			      // uses, so there is no structural reason a worker with local
			      // storage available couldn't sell/close-cash/print while offline --
			      // only the deferred remote push needs connectivity. Matching
			      // legacy mode's own standard here (see the online-reconnect fix
			      // right below, which flushes this queued write once reconnected).
			      if (ONLINE_ONLY_SAFE && !navigator.onLine) return { allowed:false, reason:'offline_online_only' };
			      return { allowed:true, reason: navigator.onLine ? 'modular_server_confirmed_boundary' : 'modular_offline_local_queued' };
			    }
			    const syncState = getSyncState({ cleanup: true, reason: 'write_gate' });
			    if (syncState.status === 'real_conflict') return { allowed: false, reason: 'sync_conflict', syncState };
			    const pendingGate = pendingRemoteSyncGateStatus(syncState);
			    if (!pendingGate.allowed) return pendingGate;
			    if (!tenantGuard.canWrite(ACTIVE_CONTEXT)) return { allowed: false, reason: 'tenant_guard_not_ready' };
			    if (ONLINE_ONLY_SAFE && !navigator.onLine) return { allowed: false, reason: 'offline_online_only' };
			    return { allowed: true, reason: 'ok', syncState };
			  }
	  function publishAccessState(next = {}) {
	    const source = next.source || 'approvedUsers';
      const previous = window.click360AccessState?.source === source ? window.click360AccessState : {};
      const anchor = source === 'accountAccess'
        ? (window.CLICK360_V16_DOMAIN?.reanchorTrustedClock?.(previous, next.serverNowMs, Date.now())
          || { serverNowMs: Number(next.serverNowMs || 0), validatedAtClientMs: Date.now() })
        : { serverNowMs: Number(next.serverNowMs || 0), validatedAtClientMs: Number(next.validatedAtClientMs || Date.now()) };
	    const state = Object.freeze({
	      mode: next.mode || 'founder',
	      plan: next.plan || 'founder',
	      readOnly: resolveEffectiveReadOnly(next),
	      trialEndsAtMs: Number(next.trialEndsAtMs || 0),
		      expiresAtMs: Number(next.expiresAtMs || 0),
		      serverNowMs: Number(anchor.serverNowMs || 0),
		      validatedAtClientMs: Number(anchor.validatedAtClientMs || Date.now()),
		      source
	    });
	    ACCESS_READ_ONLY = state.readOnly;
	    window.click360AccessState = state;
	    window.dispatchEvent(new CustomEvent('click360-access-changed', { detail: state }));
	    return state;
	  }
	  function clearAccessExpiryTimer() {
	    if (ACCESS_EXPIRY_TIMER) clearTimeout(ACCESS_EXPIRY_TIMER);
	    ACCESS_EXPIRY_TIMER = null;
	  }
	  function enterEntitlementReadOnly(state = window.click360AccessState || {}) {
	    const mode = String(state.mode || '').startsWith('trial') ? 'trial_expired' : 'subscription_expired';
	    const next = publishAccessState({ ...state, mode, readOnly: true });
	    if (window.click360User) window.click360User.access = next;
	    setSyncStatus('read_only', 'Tu acceso termino. Tus datos permanecen disponibles en modo lectura.');
	    window.click360Route?.(window.location.hash.replace('#', '') || 'home');
	    return next;
	  }
		  async function refreshAccountEntitlement(user, expectedEpoch = AUTH_EPOCH) {
	    if (!isCurrentAuthEpoch(user, expectedEpoch) || window.click360AccessState?.source !== 'accountAccess') return false;
	    if (!navigator.onLine) {
	      if (accessDoesNotExpire()) return true;
	      enterEntitlementReadOnly();
	      return false;
	    }
	    try {
	      const ref = accountAccessRef(user.uid);
	      await ref.update({ lastSeenAt: firebase.firestore.FieldValue.serverTimestamp() });
	      const snap = await ref.get({ source: 'server' });
	      if (!isCurrentAuthEpoch(user, expectedEpoch) || !snap.exists) return false;
	      const data = snap.data() || {};
	      if (!accountAccessIdentityValid(user, data)) return false;
	      cacheAccountAccess(user, data);
	      const next = accessStateFromData(data);
	      if (!next.allowed) {
	        enterEntitlementReadOnly(next);
	        return false;
	      }
	      const published = publishAccessState(next);
	      if (window.click360User) window.click360User.access = published;
	      if (published.readOnly) setSyncStatus('read_only', 'Tu acceso termino. Tus datos permanecen disponibles en modo lectura.');
	      scheduleAccessExpiry(user, published, expectedEpoch);
	      window.click360Route?.(window.location.hash.replace('#', '') || 'home');
	      return !published.readOnly;
	    } catch (error) {
	      console.warn('No se pudo revalidar el acceso con tiempo de servidor:', error.message);
	      if (accessDoesNotExpire()) {
	        setSyncStatus('pending', 'No se pudo revalidar la actividad ahora; tu acceso permanente sigue activo.');
	        return true;
	      }
	      enterEntitlementReadOnly();
	      return false;
	    }
	  }
	  function scheduleAccessExpiry(user, state = window.click360AccessState || {}, expectedEpoch = AUTH_EPOCH) {
	    clearAccessExpiryTimer();
	    if (!user || state.source !== 'accountAccess' || state.readOnly) return;
	    const expiresAtMs = Number(state.expiresAtMs || (state.mode === 'trial_active' ? state.trialEndsAtMs : 0));
	    const serverNowMs = Number(state.serverNowMs || 0);
	    if (!expiresAtMs || !serverNowMs) return;
	    const delay = Math.max(0, expiresAtMs - serverNowMs) + 1000;
	    // Long subscriptions are revalidated in bounded intervals; the final
	    // transition always uses a fresh Firestore server timestamp.
	    ACCESS_EXPIRY_TIMER = setTimeout(
	      () => refreshAccountEntitlement(user, expectedEpoch),
	      Math.min(Math.max(delay, 1000), 2147000000)
	    );
	  }
			  window.click360WriteGate = writeGateStatus;
			  window.click360CanMutate = () => writeGateStatus().allowed;
		  window.addEventListener('click360-storage-mode', (event) => {
		    ONLINE_ONLY_SAFE = event.detail?.mode === 'online_only_safe' || event.detail?.mode === 'unavailable';
		    if (ONLINE_ONLY_SAFE && auth.currentUser) {
		      recordTelemetryOnce(`cache-failure:${AUTH_EPOCH}:${ACTIVE_CONTEXT?.tenantKey || auth.currentUser.uid}`, 'cache_failure', { mode: event.detail?.mode || 'unavailable' });
		    }
		    if (ONLINE_ONLY_SAFE && AUTH_APPROVED && navigator.onLine) {
		      setSyncStatus('online_only_safe', 'Tus datos estan seguros en la nube. Este dispositivo no pudo activar el modo sin conexion.');
		      recordTelemetryOnce(`online-only:${AUTH_EPOCH}:${ACTIVE_CONTEXT?.tenantKey}`, 'online_only', { mode: 'online_only_safe' });
		    }
		  });
	  function tenantCorruptMarkerKey() {
	    return tenantStorageKey('CORRUPT');
	  }
		  function syncConflictMarkerKey() {
		    return tenantStorageKey('SYNC_CONFLICT');
		  }
		  function reliabilityDiagnosticsKey() {
		    return tenantStorageKey('RELIABILITY_LAST_RECOVERY');
		  }
	  function activeIdentity() {
	    return ACTIVE_CONTEXT ? {
	      ownerUid: ACTIVE_CONTEXT.ownerUid,
	      ownerId: ACTIVE_CONTEXT.ownerId,
	      businessId: ACTIVE_CONTEXT.businessId,
	      tenantKey: ACTIVE_CONTEXT.tenantKey,
	      schemaVersion: SCHEMA_VERSION
	    } : null;
	  }
	  function sameTenant(identity) {
	    return window.CLICK360_P0_TENANT_GUARD.sameTenantIdentity(identity, ACTIVE_CONTEXT);
	  }
	  function safeStorageSet(key, value) {
	    if (!key) return false;
	    try { rawSetItem(key, value); return true; } catch (error) {
	      console.warn('No se pudo guardar metadato local:', error.message);
	      return false;
	    }
	  }
	  function isCurrentAuthEpoch(user, expectedEpoch = AUTH_EPOCH) {
	    return expectedEpoch === AUTH_EPOCH && !!user && auth.currentUser?.uid === user.uid;
	  }
	  function isActiveSyncScope(context, stateDoc, expectedEpoch, user = auth.currentUser) {
	    return isCurrentAuthEpoch(user, expectedEpoch)
	      && !!context
	      && !!stateDoc
	      && ACTIVE_CONTEXT === context
	      && STATE_DOC === stateDoc
	      && window.CLICK360_P0_TENANT_GUARD.sameTenant(context, ACTIVE_CONTEXT)
	      && activeIdentityIsValid(user);
	  }
		  function hashFingerprint(value = '') {
		    const text = String(value || '');
		    if (!text) return '';
		    let hash = 2166136261;
		    for (let index = 0; index < text.length; index += 1) {
		      hash ^= text.charCodeAt(index);
		      hash = Math.imul(hash, 16777619);
		    }
		    return `h_${(hash >>> 0).toString(16).padStart(8, '0')}`;
		  }
		  function readSyncConflictMarker() {
		    const raw = safeStorageGet(syncConflictMarkerKey());
		    if (!raw) return null;
		    if (raw === '1') {
		      return {
		        present: true,
		        legacy: true,
		        source: 'legacy_marker',
		        reason: 'legacy_marker',
		        createdAtMs: 0,
		        ageMs: UNKNOWN_LOCK_AGE_MS
		      };
		    }
		    const parsed = safeJsonParse(raw);
		    if (!parsed || typeof parsed !== 'object') {
		      return {
		        present: true,
		        legacy: true,
		        source: 'unreadable_marker',
		        reason: 'unreadable_marker',
		        createdAtMs: 0,
		        ageMs: UNKNOWN_LOCK_AGE_MS
		      };
		    }
		    const createdAtMs = Number(parsed.createdAtMs || 0);
		    return {
		      present: true,
		      legacy: false,
		      source: String(parsed.source || parsed.reason || 'sync_conflict').slice(0, 80),
		      reason: String(parsed.reason || 'sync_conflict').slice(0, 80),
		      createdAtMs,
		      ageMs: createdAtMs > 0 ? Math.max(0, Date.now() - createdAtMs) : UNKNOWN_LOCK_AGE_MS,
		      remoteRevision: Number(parsed.remoteRevision || 0),
		      baseRevision: Number(parsed.baseRevision || 0),
		      localRevision: Number(parsed.localRevision || 0),
		      localUpdatedAtMs: Number(parsed.localUpdatedAtMs || 0),
		      localHash: String(parsed.localHash || '').slice(0, 24),
		      localMaterialHash: String(parsed.localMaterialHash || '').slice(0, 24)
		    };
		  }
		  function markSyncConflict(details = {}) {
		    const hashes = currentPayloadHashes();
		    const marker = {
		      schemaVersion: 2,
		      createdAtMs: Date.now(),
		      reason: String(details.reason || 'sync_conflict').slice(0, 80),
		      source: String(details.source || details.reason || 'sync_conflict').slice(0, 80),
		      remoteRevision: Number(details.remoteRevision || 0),
		      baseRevision: Number(details.baseRevision || details.localRevision || LAST_REMOTE_REVISION || 0),
		      localRevision: Number(details.localRevision || LAST_REMOTE_REVISION || 0),
		      localUpdatedAtMs: Number(details.localUpdatedAtMs || localPayloadUpdatedAtMs() || 0),
		      localHash: hashFingerprint(hashes.payloadHash),
		      localMaterialHash: hashFingerprint(hashes.materialHash)
		    };
		    SYNC_CONFLICT_PENDING = true;
		    safeStorageSet(syncConflictMarkerKey(), JSON.stringify(marker));
		    quarantineIncident('same_tenant_conflict', details);
		  }
		  function clearSyncConflict() {
		    SYNC_CONFLICT_PENDING = false;
		    try { localStorage.removeItem(syncConflictMarkerKey()); } catch {}
		  }
	  function activeIdentityIsValid(user = auth.currentUser) {
	    return !!user && !!ACTIVE_CONTEXT && !!window.click360User
	      && user.uid === ACTIVE_CONTEXT.authUid
	      && window.click360User.uid === ACTIVE_CONTEXT.authUid
	      && window.click360User.ownerId === ACTIVE_CONTEXT.ownerId
	      && BUSINESS_ID === ACTIVE_CONTEXT.businessId
	      && (MODULAR_MODE ? !!MODULAR_GATEWAY : !!STATE_DOC);
	  }
	  function legacyMigrationRequired() {
	    return tenantGuard.snapshot().mode === window.CLICK360_P0_TENANT_GUARD.MODES.LEGACY_MIGRATION_REQUIRED;
	  }
	  function verifiedOfflineTenantCache() {
	    if (!ACTIVE_CONTEXT || safeStorageGet(legacyMigrationMarkerKey()) || safeStorageGet(tenantCorruptMarkerKey())) return false;
	    const status = window.click360GetTenantCacheStatus?.(ACTIVE_CONTEXT);
	    return status?.valid === true;
	  }
	  const SESSION_DEVICE_ID = `session_${window.crypto?.randomUUID?.() || `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`}`;
		  function getDeviceId(context = ACTIVE_CONTEXT) {
	    if (!context?.authUid || !context?.tenantKey) return SESSION_DEVICE_ID;
	    const key = `${DEVICE_ID_PREFIX}${context.authUid}:${context.tenantKey}`;
	    let id = safeStorageGet(key);
	    if (!id) {
	      id = `device_${window.crypto?.randomUUID?.() || `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`}`;
	      safeStorageSet(key, id);
	    }
		    return id;
		  }
		  function publishAccessUiState(state, details = {}) {
		    ACCESS_UI_STATE = ACCESS_UI_STATE_VALUES.has(state) ? state : ACCESS_UI_STATES.RECOVERABLE_ERROR;
		    const value = Object.freeze({ state: ACCESS_UI_STATE, ...details });
		    window.click360AccessUiState = value;
		    window.dispatchEvent(new CustomEvent('click360-access-ui-state', { detail: value }));
		    return value;
		  }
		  window.CLICK360_ACCESS_UI_STATES = ACCESS_UI_STATES;
		  window.click360GetAccessUiState = () => ({ ...(window.click360AccessUiState || { state: ACCESS_UI_STATE }) });
			  function currentInvitationParams() {
			    const params = new URLSearchParams(location.search);
			    return {
			      flow: params.get('flow') || '',
			      ownerId: params.get('ownerId') || '',
			      inviteHash: params.get('inviteHash') || '',
			      inviteToken: params.get('inviteToken') || params.get('token') || '',
			      inviteSession: params.get('inviteSession') || ''
			    };
			  }
			  function readExplicitInvitationIntent() {
			    try {
			      const stored = safeJsonParse(sessionStorage.getItem(EXPLICIT_INVITATION_KEY));
			      const current = currentInvitationParams();
			      return window.CLICK360_ACCESS_FLOW?.invitationIntentValid
			        ? window.CLICK360_ACCESS_FLOW.invitationIntentValid(stored, current)
			        : Number(stored?.createdAtMs || 0) > Date.now() - 30 * 60 * 1000
			          && current.flow === 'invite' && !!current.ownerId && !!current.inviteToken && !!current.inviteSession
			          && stored.ownerId === current.ownerId && stored.sessionId === current.inviteSession
			          && Number(stored.tokenLength) === current.inviteToken.length;
			    } catch { return false; }
			  }
			  function markExplicitInvitationIntent(ownerId, inviteToken) {
			    try {
			      const sessionId = window.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
			      sessionStorage.setItem(EXPLICIT_INVITATION_KEY, JSON.stringify({
			        ownerId,
			        tokenLength: String(inviteToken || '').length,
			        sessionId,
			        createdAtMs: Date.now()
			      }));
			      return sessionId;
			    } catch { return ''; }
			  }
			  function clearInvitationIntent({ cleanUrl = false } = {}) {
			    try { sessionStorage.removeItem(EXPLICIT_INVITATION_KEY); } catch {}
			    if (!cleanUrl) return;
			    const clean = new URL(location.href);
			    ['flow', 'invite', 'ownerId', 'inviteHash', 'inviteToken', 'token', 'inviteSession'].forEach((key) => clean.searchParams.delete(key));
			    history.replaceState({}, '', `${clean.pathname}${clean.search}${clean.hash}`);
			  }
			  // r37.2.1 (LIVE CLIENT RECOVERY -- worker invite): the real invite
			  // link the app generates (app.js ~8315 / click360GetInviteLink below)
			  // carries `?invite=true&ownerId=...&inviteHash=...&inviteToken=...`.
			  // Every function above this one, though, only recognizes
			  // `flow=invite` + a pre-existing `inviteSession` in sessionStorage --
			  // which a brand-new browser (a family member opening the WhatsApp
			  // link on their OWN device, zero prior storage) can never have. The
			  // real invite validation (hash match, ownerId/tenant match, Google
			  // email match, status/expiry) already happens correctly and
			  // fail-closed inside acceptInvitationFromUrl() once an intent is
			  // marked -- this function's ONLY job is to recognize the real
			  // external URL shape on a fresh browser and locally bootstrap the
			  // SAME intent-marking + URL-normalization a returning/manual invite
			  // acceptance already relies on. It never embeds a fixed
			  // inviteSession in the shareable link -- that stays generated
			  // fresh, per device, exactly as designed.
			  function bootstrapInvitationFromExternalUrl() {
			    try {
			      const params = new URLSearchParams(location.search);
			      const declaresInvite = params.get('invite') === 'true' || params.get('flow') === 'invite';
			      if (!declaresInvite) return false;
			      // Already bootstrapped (a reload, or the manual "Tengo una
			      // invitación" form already marked it) -- do not regenerate.
			      if (params.get('flow') === 'invite' && params.get('inviteSession') && readExplicitInvitationIntent()) return true;
			      const ownerId = String(params.get('ownerId') || '').trim();
			      const inviteToken = String(params.get('inviteToken') || params.get('token') || '').trim();
			      const inviteHash = String(params.get('inviteHash') || '').trim();
			      const HEX64 = /^[0-9a-f]{64}$/;
			      // (a) validate basic shape before touching anything -- a
			      // malformed/garbage URL must fall through to the normal public
			      // gate, never throw and break boot().
			      if (!ownerId || ownerId.length > 128 || !HEX64.test(inviteToken) || !HEX64.test(inviteHash)) return false;
			      const sessionId = markExplicitInvitationIntent(ownerId, inviteToken); // (c)+(d)
			      if (!sessionId) return false;
			      params.set('flow', 'invite');
			      params.set('inviteSession', sessionId);
			      params.delete('invite');
			      history.replaceState({}, '', `${location.pathname}?${params.toString()}${location.hash}`);
			      setPublicAuthIntent('invite');
			      return true;
			    } catch (error) {
			      console.warn('No se pudo preparar la invitación:', error.message);
			      return false;
			    }
			  }
			  function readPublicAuthIntent() {
			    const fromUrl = new URLSearchParams(location.search).get('flow');
			    if (fromUrl === 'invite') return readExplicitInvitationIntent() ? 'invite' : 'login';
			    if (PUBLIC_INTENTS.has(fromUrl)) return fromUrl;
			    if (PUBLIC_INTENTS.has(PUBLIC_AUTH_INTENT)) return PUBLIC_AUTH_INTENT;
			    try {
			      const stored = sessionStorage.getItem(PUBLIC_INTENT_KEY);
			      return PUBLIC_INTENTS.has(stored) && stored !== 'invite' ? stored : 'login';
			    } catch { return 'login'; }
			  }
		  function setPublicAuthIntent(intent) {
		    PUBLIC_AUTH_INTENT = PUBLIC_INTENTS.has(intent) ? intent : 'login';
		    try { sessionStorage.setItem(PUBLIC_INTENT_KEY, PUBLIC_AUTH_INTENT); } catch {}
		    return PUBLIC_AUTH_INTENT;
		  }
			  function clearPublicAuthIntent() {
			    PUBLIC_AUTH_INTENT = null;
			    try { sessionStorage.removeItem(PUBLIC_INTENT_KEY); } catch {}
			  }
		  function setAuthRedirectPending(intent = 'login') {
		    try {
		      sessionStorage.setItem(AUTH_REDIRECT_PENDING_KEY, JSON.stringify({
		        intent: PUBLIC_INTENTS.has(intent) ? intent : 'login',
		        createdAtMs: Date.now(),
		        appVersion: APP_ASSET_VERSION,
		        authDomain: window.CLICK360_FIREBASE_CONFIG?.authDomain || ''
		      }));
		    } catch {}
		  }
		  function readAuthRedirectPending() {
		    try {
		      const pending = safeJsonParse(sessionStorage.getItem(AUTH_REDIRECT_PENDING_KEY));
		      if (!pending || !Number.isFinite(Number(pending.createdAtMs))) return null;
		      if (Date.now() - Number(pending.createdAtMs) > 10 * 60 * 1000) {
		        sessionStorage.removeItem(AUTH_REDIRECT_PENDING_KEY);
		        return null;
		      }
		      return pending;
		    } catch { return null; }
		  }
		  function clearAuthRedirectPending() {
		    try { sessionStorage.removeItem(AUTH_REDIRECT_PENDING_KEY); } catch {}
		  }
		  function loginErrorCode(code, fallback = 'UNKNOWN_LOGIN_GATE_FAILURE') {
		    const raw = String(code || fallback).toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 80);
		    return raw || fallback;
		  }
		  function loginGateConsole(code, details = {}) {
		    const safeCode = loginErrorCode(code);
		    const payload = {
		      code: safeCode,
		      authDomain: window.CLICK360_FIREBASE_CONFIG?.authDomain || '',
		      appVersion: APP_ASSET_VERSION,
		      uiState: ACCESS_UI_STATE,
		      hasAuthUser: !!auth.currentUser,
		      online: navigator.onLine,
		      redirectResult: AUTH_REDIRECT_RESULT_STATUS,
		      persistenceReady: AUTH_PERSISTENCE_READY,
		      accountStatus: details.accountStatus || '',
		      approvedStatus: APPROVED_LOOKUP_STATUS || '',
		      firestoreCode: details.firestoreCode || '',
		      route: location.pathname + location.search + location.hash
		    };
		    window.click360LastLoginGateError = Object.freeze(payload);
		    console.warn('[CLICK360_LOGIN_GATE]', payload);
		    recordTelemetryOnce(`login-gate:${AUTH_EPOCH}:${safeCode}:${payload.accountStatus}:${payload.approvedStatus}`, 'login', {
		      mode: 'gate_failure',
		      errorCode: safeCode
		    });
		    return safeCode;
		  }
		  function loginGateMessage(message, code, state = ACCESS_UI_STATES.RECOVERABLE_ERROR, details = {}) {
		    const safeCode = loginGateConsole(code, details);
		    showGate(`${escapeHtml(message)}<br><small>Código: ${safeCode}</small>`, state, { reason: safeCode, errorCode: safeCode });
		    return safeCode;
		  }
			  window.click360GetPublicAuthDiagnostics = () => {
			    const params = currentInvitationParams();
			    return {
			      intent: readPublicAuthIntent(),
			      invitationParametersPresent: params.flow === 'invite' || !!params.ownerId || !!params.inviteHash || !!params.inviteToken,
			      explicitInvitationIntent: readExplicitInvitationIntent(),
		      authRedirectPending: readAuthRedirectPending(),
		      redirectResultStatus: AUTH_REDIRECT_RESULT_STATUS,
		      redirectResultError: AUTH_REDIRECT_RESULT_ERROR,
		      authDomain: window.CLICK360_FIREBASE_CONFIG?.authDomain || '',
		      lastLoginGateError: window.click360LastLoginGateError || null
			    };
			  };
		  const TELEMETRY_EVENTS = new Set([
		    'login', 'bootstrap', 'cache_failure', 'online_only', 'sync', 'plan_request',
		    'invitation', 'cash_open', 'cash_close', 'template_save_failure',
		    // Phase 3.2 Workers rollout: failed invitations, failed worker login,
		    // permission denials, stock errors, cross-tenant denials, and seat
		    // exhaustion, so the pilot can be observed without reading raw logs.
		    'worker_invite_failed', 'worker_login_failed', 'worker_permission_denied',
		    'worker_stock_error', 'worker_cross_tenant_denied', 'worker_seat_exhausted', 'seat_request'
		  ]);
		  const TELEMETRY_ONCE = new Set();
		  async function recordTelemetry(eventType, details = {}, contextOverride = null) {
		    const user = auth.currentUser;
		    const context = contextOverride || ACTIVE_CONTEXT;
		    if (!user || !TELEMETRY_EVENTS.has(eventType)) return false;
		    const businessId = context?.businessId || user.uid;
		    const ownerId = context?.ownerId || businessId;
		    const tenantKey = context?.tenantKey || tenantKeyFor(user.uid, user.uid);
		    if (businessId === 'demo-click360' || tenantKey.includes('demo-click360')) return false;
		    const eventRef = db.collection('telemetryEvents').doc();
		    const hash = window.CLICK360_V16_DOMAIN?.sha256;
		    const [uidHash, deviceHash] = typeof hash === 'function'
		      ? await Promise.all([hash(user.uid), hash(getDeviceId(context))])
		      : ['', ''];
		    await eventRef.set({
		      eventId: eventRef.id,
		      eventType,
		      uidHash: String(uidHash || '').slice(0, 16),
		      ownerId,
		      businessId,
		      tenantKey,
		      // firestore.rules gates telemetryEvents on the internal V16.x contract version
		      // (16.0.0/16.2.0), not the commercial release number — sending '1.0.5' here always
		      // hit permission-denied and silently dropped every telemetry write.
		      appVersion: '16.2.0',
		      requestId: String(details.requestId || window.crypto?.randomUUID?.() || eventRef.id).slice(0, 64),
		      mode: String(details.mode || window.click360AccessState?.mode || syncStatus.status || '').slice(0, 40),
		      errorCode: String(details.errorCode || '').replace(/[^a-z0-9_./-]/gi, '').slice(0, 80),
		      deviceIdHash: String(deviceHash || '').slice(0, 16),
		      createdAt: firebase.firestore.FieldValue.serverTimestamp()
		    });
		    return true;
		  }
		  function recordTelemetryOnce(key, eventType, details = {}) {
		    if (TELEMETRY_ONCE.has(key)) return;
		    TELEMETRY_ONCE.add(key);
		    recordTelemetry(eventType, details).catch((error) => console.warn('Telemetria no disponible:', error.code || error.message));
		  }
		  window.click360RecordTelemetry = (eventType, details = {}) => recordTelemetry(eventType, details);
	  let syncStatus = {
	    status: navigator.onLine ? "checking" : "offline",
	    message: "",
	    businessId: null,
	    updatedAt: new Date().toISOString()
	  };
	  function setSyncStatus(status, message = "", extra = {}) {
	    syncStatus = {
	      ...syncStatus,
	      ...extra,
	      status,
	      message,
	      businessId: BUSINESS_ID,
	      deviceId: getDeviceId(),
	      updatedAt: new Date().toISOString()
	    };
	    window.click360SyncStatus = syncStatus;
	    window.dispatchEvent(new CustomEvent("click360-sync-status", { detail: syncStatus }));
	  }
	  window.click360GetSyncStatus = () => ({ ...syncStatus });
	  window.click360OnSyncStatus = (fn) => {
	    if (typeof fn !== "function") return () => {};
	    const handler = (event) => fn(event.detail);
	    window.addEventListener("click360-sync-status", handler);
	    fn({ ...syncStatus });
	    return () => window.removeEventListener("click360-sync-status", handler);
	  };
		  window.addEventListener("offline", () => setSyncStatus("offline", ONLINE_ONLY_SAFE ? "Sin conexión. Este dispositivo está en modo solo en línea; la edición queda pausada." : "Sin conexión. Los cambios quedan en este dispositivo."));
	  window.addEventListener("online", () => {
	    setSyncStatus("pending", "Conexión recuperada. Sincronizando cambios pendientes.");
	    // r37: this used to only flush legacy-mode's pending write (checking
	    // STATE_DOC, calling pushLocalToFirestore directly) -- a modular/worker
	    // session that wrote locally while offline (see the writeGateStatus()
	    // fix above) had no reconnect trigger at all and stayed stuck as
	    // "pending" until an unrelated event (e.g. tab visibility change)
	    // happened to fire pushModularState().
	    if (MODULAR_MODE) {
	      if (AUTH_APPROVED && PULL_COMPLETE && MODULAR_GATEWAY) pushModularState("online_reconnect").catch(() => {});
	    } else if (AUTH_APPROVED && PULL_COMPLETE && STATE_DOC) pushLocalToFirestore("online_reconnect").catch(() => {});
	  });

  const initUrlParams = new URLSearchParams(location.search);

  if (initUrlParams.get("resetC360") === "1") {
    // P0: never erase tenant data from a URL parameter. The old reset flag now
    // only removes itself from the address bar.
    history.replaceState({}, "", location.pathname + `?v=${APP_ASSET_VERSION}`);
  }

  function setAppBlocked(blocked) {
    const app = document.getElementById("app");
    if (!app) return;
    app.style.pointerEvents = blocked ? "none" : "auto";
    app.style.userSelect = blocked ? "none" : "auto";
    app.style.filter = blocked ? "blur(4px)" : "none";
    app.style.opacity = blocked ? "0.15" : "1";
    if(blocked) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "auto";
    }
  }

	  function safeJsonParse(value) {
	    try { return JSON.parse(value); } catch (e) { return null; }
	  }
	  function escapeHtml(value) {
	    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
	  }

  function getCachedProfile(uid) {
    if (!uid) return null;
    const cached = safeJsonParse(safeStorageGet(PROFILE_CACHE_PREFIX + uid))
      || safeJsonParse(safeStorageGet(LEGACY_PROFILE_CACHE_PREFIX + uid));
    if (cached?.uid === uid) {
	    safeStorageSet(PROFILE_CACHE_PREFIX + uid, JSON.stringify(cached));
	    try { localStorage.removeItem(LEGACY_PROFILE_CACHE_PREFIX + uid); } catch {}
	  }
    return cached?.uid === uid ? cached : null;
  }

	  function profileUpdatedAtMs(value) {
	    if (typeof value?.toMillis === 'function') return value.toMillis();
	    if (Number.isFinite(Number(value?.seconds))) return Number(value.seconds) * 1000;
	    const parsed = Date.parse(String(value || ''));
	    return Number.isFinite(parsed) ? parsed : 0;
	  }
	  function protectCurrentProfile(user, remoteData = {}) {
	    const cached = getCachedProfile(user?.uid);
	    if (!window.click360User) return;
	    const pending = safeJsonParse(safeStorageGet(`${PROFILE_PENDING_PREFIX}${user.uid}`))
	      || safeJsonParse(safeStorageGet(`${LEGACY_PROFILE_PENDING_PREFIX}${user.uid}`));
	    const remoteProfileUpdatedAt = remoteData.profileUpdatedAt || remoteData.updatedAt;
	    const localWins = cached?.uid === user.uid && pending?.uid === user.uid
        && profileUpdatedAtMs(pending.updatedAt || cached.updatedAt) >= profileUpdatedAtMs(remoteProfileUpdatedAt);
	    if (localWins) {
	      if (cached.name) window.click360User.name = cached.name;
	      if (cached.photoURL) window.click360User.photoURL = cached.photoURL;
	      return;
	    }
	    safeStorageSet(PROFILE_CACHE_PREFIX + user.uid, JSON.stringify({
	      uid: user.uid,
	      name: window.click360User.name || '',
	      photoURL: window.CLICK360_P0_TENANT_GUARD.safeImageSrc(window.click360User.photoURL),
	      email: window.click360User.email || '',
	      updatedAt: remoteProfileUpdatedAt?.toDate?.().toISOString?.() || remoteProfileUpdatedAt || new Date().toISOString()
	    }));
	  }
	  function cacheApprovedIdentity(user, data) {
	    if (!user || !isExplicitlyActive(data)) return;
	    const safe = {
	      uid: user.uid,
	      email: user.email || data.email || "",
	      role: data.role,
	      name: data.name || user.displayName || "",
	      photoURL: data.photoURL || user.photoURL || "",
	      status: data.status || "active",
	      approved: data.approved === true,
	      ownerId: data.ownerId || user.uid,
	      isOwner: data.role === 'owner',
	      businessLimit: Number(data.businessLimit || 2),
	      workerLimit: Number(data.workerLimit || 2),
	      permissions: data.permissions && typeof data.permissions === 'object' ? data.permissions : undefined,
	      invitationHash: data.invitationHash || '',
	      businessUnitId: data.businessUnitId || '',
	      cachedAtMs: Date.now()
	    };
	    safeStorageSet(approvedIdentityStorageKey(user.uid), JSON.stringify(safe));
	  }
	  function getCachedApprovedIdentity(user) {
	    if (!user) return null;
	    const currentKey = approvedIdentityStorageKey(user.uid);
	    const legacyKey = `${LEGACY_APPROVED_IDENTITY_PREFIX}${user.uid}`;
	    const cached = safeJsonParse(safeStorageGet(currentKey) || safeStorageGet(legacyKey));
	    if (!cached || cached.uid !== user.uid || cached.status !== 'active' || cached.approved !== true) return null;
	    if (cached.email && user.email && cached.email.toLowerCase() !== user.email.toLowerCase()) return null;
	    if (!Number.isFinite(Number(cached.cachedAtMs)) || Date.now() - Number(cached.cachedAtMs) > OFFLINE_APPROVAL_MAX_AGE_MS) return null;
	    if (!safeStorageGet(currentKey)) safeStorageSet(currentKey, JSON.stringify(cached));
	    return cached;
	  }
	  async function applyWorkerBoundaryIdentity(user, data, source = "remote", expectedEpoch = AUTH_EPOCH) {
	    const boundary = window.CLICK360_WORKER_DATA_BOUNDARY;
	    const projectId = window.CLICK360_FIREBASE_CONFIG?.projectId || '';
	    const ownerId = String(data.ownerId || '');
	    // Phase 3.2 gradual rollout: staging/demo stay always-enabled; in
	    // production a tenant is enabled only by an explicit, admin-managed
	    // featureFlags/workers doc (never client-writable). This read only
	    // happens when the project-level gate alone doesn't already allow it,
	    // so staging behavior and cost are unchanged.
	    let workersFlag = null;
	    if (!boundary?.enabledForProject?.(projectId) && ownerId) {
	      try {
	        const flagSnapshot = await db.collection('businesses').doc(ownerId).collection('featureFlags').doc('workers').get({ source:'server' });
	        workersFlag = flagSnapshot.exists ? flagSnapshot.data() : null;
	      } catch (_error) {
	        workersFlag = null;
	      }
	    }
	    if (!boundary?.workersEnabledForTenant?.(projectId, workersFlag)) {
	      setPendingUser(user, data, 'worker_module_upgrade');
	      return false;
	    }
	    const businessUnitId = String(data.businessUnitId || data.activeBusinessId || '');
	    if (!ownerId || !businessUnitId || ownerId === user.uid || ownerId === 'demo-click360') {
	      setPendingUser(user, data, 'worker_boundary_not_assigned');
	      return false;
	    }
	    const rawRole = String(data.role || 'worker');
	    const role = boundary.normalizedRole(rawRole);
	    const permissions = data.permissions && typeof data.permissions === 'object'
	      ? data.permissions : defaultWorkerPermissions(data.role);
	    let gateway;
	    let modularState;
	    try {
	      gateway = boundary.createFirestoreGateway({
	        db, firebase, user, ownerUid:ownerId, businessId:businessUnitId,
	        role, permissions, projectId
	      });
	      modularState = await gateway.pull();
	    } catch (error) {
	      console.warn('Frontera modular de trabajador no disponible:', error.code || error.message);
	      const telemetryContext = {
	        ownerId, businessId:businessUnitId,
	        tenantKey:boundary.identity(ownerId, businessUnitId).tenantKey
	      };
	      const isMembershipMismatch = /membres/i.test(error?.message || '');
	      recordTelemetry(isMembershipMismatch ? 'worker_cross_tenant_denied' : 'worker_login_failed', {
	        errorCode:error?.code || 'worker_boundary_not_ready'
	      }, telemetryContext).catch(() => {});
	      setPendingUser(user, data, 'worker_boundary_not_ready');
	      return false;
	    }
	    if (!isCurrentAuthEpoch(user, expectedEpoch)) return false;
	    window.click360User = {
	      uid:user.uid,
	      email:user.email || data.email || '',
	      role:rawRole,
	      name:data.name || user.displayName || (user.email ? user.email.split('@')[0] : 'Trabajador'),
	      photoURL:data.photoURL || user.photoURL || '',
	      status:'active',
	      approved:true,
	      businessLimit:1,
	      workerLimit:0,
	      ownerId,
	      businessUnitId,
	      isOwner:false,
	      permissions,
	      invitationHash:data.invitationHash || '',
	      source,
	      access:publishAccessState({ mode:'member', plan:'base', readOnly:false, source:'approvedUsers' })
	    };
	    ACTIVE_CONTEXT = Object.freeze({
	      authUid:user.uid,
	      ownerUid:ownerId,
	      ownerId,
	      businessId:businessUnitId,
	      tenantKey:boundary.identity(ownerId, businessUnitId).tenantKey,
	      schemaVersion:10,
	      dataBoundaryVersion:boundary.SCHEMA_VERSION,
	      mode:'modular'
	    });
	    BUSINESS_ID = businessUnitId;
	    STATE_DOC = null;
	    MODULAR_GATEWAY = gateway;
	    MODULAR_BASELINE = JSON.parse(JSON.stringify(modularState));
	    MODULAR_MODE = true;
	    tenantGuard.begin(ACTIVE_CONTEXT);
	    window.click360SetTenantContext(ACTIVE_CONTEXT, { deferLocalLoad:true });
	    modularState.identity = {
	      ownerUid:ownerId, ownerId, businessId:businessUnitId,
	      tenantKey:ACTIVE_CONTEXT.tenantKey, schemaVersion:10
	    };
	    window.click360ApplyTenantState(modularState, ACTIVE_CONTEXT);
	    tenantGuard.allow(ACTIVE_CONTEXT);
	    PULL_COMPLETE = true;
	    INITIAL_TENANT_SEED_REQUIRED = false;
	    cacheApprovedIdentity(user, window.click360User);
	    return true;
	  }

	  async function applyApprovedIdentity(user, data, source = "remote", expectedEpoch = AUTH_EPOCH) {
	    if (!isCurrentAuthEpoch(user, expectedEpoch)) return false;
	    const ownerId = data.ownerId || user.uid;
	    const allowedRoles = ['owner', 'worker', 'seller', 'cashier', 'inventory', 'supervisor', 'admin'];
	    const role = allowedRoles.includes(data.role)
	      ? data.role
	      : ((data.isOwner === true || ownerId === user.uid) ? 'owner' : null);
	    if (!role || (role === 'owner' && ownerId !== user.uid) || (role !== 'owner' && ownerId === user.uid)) return false;
	    if (role !== 'owner') {
	      return applyWorkerBoundaryIdentity(user, data, source, expectedEpoch);
	    }
	    // CLICK 360 stores one protected snapshot at the owner's canonical root.
	    // A different approvedUsers.businessId would not be authorized by the
	    // deployed contract, so reject it instead of opening an unsyncable tenant.
	    if (data.businessId && data.businessId !== ownerId) return false;
	    const businessId = ownerId;
	    window.click360User = {
	      uid: user.uid,
	      email: user.email || data.email,
	      role,
	      name: data.name || user.displayName || (user.email ? user.email.split('@')[0] : "Usuario"),
	      photoURL: data.photoURL || user.photoURL || '',
	      status: data.status || "active",
	      approved: data.approved === true,
	      businessLimit: Number(data.businessLimit || 2),
	      workerLimit: Number(data.workerLimit || 2),
	      ownerId,
	      isOwner: role === 'owner',
	      permissions: data.permissions && typeof data.permissions === 'object' ? data.permissions : defaultWorkerPermissions(role),
	      invitationHash: data.invitationHash || '',
	      source
	    };
	    protectCurrentProfile(user, data);
	    ACTIVE_CONTEXT = Object.freeze({
	      authUid: user.uid,
	      ownerUid: ownerId,
	      ownerId,
	      businessId,
	      tenantKey: tenantKeyFor(ownerId, businessId),
	      schemaVersion: SCHEMA_VERSION
	    });
	    tenantGuard.begin(ACTIVE_CONTEXT);
	    BUSINESS_ID = businessId;
	    STATE_DOC = db.collection("businesses").doc(BUSINESS_ID).collection("state").doc("main");
	    LAST_REMOTE_REVISION = Number(safeStorageGet(tenantStorageKey("REMOTE_REVISION")) || 0);
		    SYNC_CONFLICT_PENDING = !!readSyncConflictMarker();
	    if (typeof window.click360SetTenantContext !== "function") {
	      throw new Error("La interfaz segura todavía no está lista.");
	    }
	    // The remote V10 document is authoritative. Do not hydrate a local cache
	    // before it has been read and its identity validated.
	    window.click360SetTenantContext(ACTIVE_CONTEXT, { deferLocalLoad: true });
		    window.click360User.access = publishAccessState({
		      mode: role === 'owner' ? 'founder' : 'member',
		      plan: role === 'owner' ? 'founder' : 'base',
		      source: source === 'offline_cache' ? 'approved_offline' : 'approvedUsers'
		    });
	    cacheApprovedIdentity(user, window.click360User);
	    return true;
	  }

			  function snapshotString(obj) {
			    try { return JSON.stringify(obj || {}); } catch (e) { return "{}"; }
			  }

			  const OPTIONAL_EMPTY_ARRAY_KEYS = new Set([
			    'restaurantPayments', 'restaurantPrintHistory', 'restaurantEvents', 'restaurantRecipes',
			    'vehicles', 'routes', 'loadSheets', 'routeSales', 'collections', 'returns',
			    'routeSettlements', 'routeExpenses', 'routeCustomers', 'events', 'printHistory'
			  ]);
			  function withoutNonMaterialSyncFields(value, key = '', path = []) {
			    if (Array.isArray(value)) {
			      const items = value.map((item) => withoutNonMaterialSyncFields(item, '', [...path, key, '[]']));
			      if (!items.length && OPTIONAL_EMPTY_ARRAY_KEYS.has(key)) return undefined;
			      return items;
			    }
			    if (!value || typeof value !== 'object') return value;
			    const output = {};
			    Object.keys(value).sort().forEach((itemKey) => {
			      if (['activeBusinessId', 'updatedAt', 'updatedAtMs'].includes(itemKey)) return;
			      if (itemKey === 'layout' && path.includes('tables')) return;
			      const nextValue = withoutNonMaterialSyncFields(value[itemKey], itemKey, [...path, key].filter(Boolean));
			      if (nextValue === undefined) return;
			      output[itemKey] = nextValue;
			    });
			    if (key === 'logistics' && Object.keys(output).length === 0) return undefined;
			    return output;
			  }

			  function materialPayloadHash(payload) {
			    const clone = withoutNonMaterialSyncFields(safeJsonParse(snapshotString(payload)) || {});
			    return snapshotString(clone);
			  }

		  function currentPayloadHashes() {
		    const payload = buildBusinessPayload();
		    if (!payload) return { payload: null, payloadHash: '', materialHash: '' };
		    return {
		      payload,
		      payloadHash: snapshotString(payload),
		      materialHash: materialPayloadHash(payload)
		    };
		  }

		  function rememberAppliedRemotePayload(context, payload, revision, metadata = {}) {
		    rememberTenantMaterialEvidence(context, payload);
		    const payloadHash = snapshotString(payload);
		    const materialHash = materialPayloadHash(payload);
		    safeStorageSet(tenantStorageKeyFor(context, 'LAST_APPLIED_REMOTE_HASH'), payloadHash);
		    safeStorageSet(tenantStorageKeyFor(context, 'LAST_APPLIED_REMOTE_MATERIAL_HASH'), materialHash);
		    if (Number(revision || 0) > 0) safeStorageSet(tenantStorageKeyFor(context, 'REMOTE_REVISION'), String(revision));
		    window.click360MarkTenantCacheSynced?.({
		      revision: Number(revision || LAST_REMOTE_REVISION || 0),
		      payloadHash,
		      materialHash,
		      operationId: String(metadata.operationId || metadata.reason || '')
		    }).catch?.(() => {});
		    return { payloadHash, materialHash };
		  }

			  function localPendingSyncMeta() {
			    const localCache = window.click360GetTenantCacheStatus?.(ACTIVE_CONTEXT) || null;
			    const indexedMeta = window.click360GetIndexedTenantCacheMeta?.() || null;
			    if (localCache?.pendingRemoteSync === true) return localCache;
			    if (indexedMeta?.pendingRemoteSync === true) return indexedMeta;
			    return null;
			  }

			  function lockAgeMs(meta = null) {
			    const createdAtMs = Number(meta?.pendingCreatedAtMs || meta?.savedAtMs || meta?.updatedAtMs || meta?.createdAtMs || 0);
			    if (!createdAtMs) return UNKNOWN_LOCK_AGE_MS;
			    return Math.max(0, Date.now() - createdAtMs);
			  }

			  function activeSchedulerKey(context = ACTIVE_CONTEXT) {
			    return context ? `${AUTH_EPOCH}:${context.authUid}:${context.tenantKey}` : '';
			  }

		  function materialMatchesLastApplied(hashes = currentPayloadHashes()) {
		    if (!hashes.payload) return false;
		    const lastFull = safeStorageGet(tenantStorageKey('LAST_APPLIED_REMOTE_HASH'));
		    const lastMaterial = safeStorageGet(tenantStorageKey('LAST_APPLIED_REMOTE_MATERIAL_HASH'));
			    return (!!lastFull && hashes.payloadHash === lastFull)
			      || (!!lastMaterial && hashes.materialHash === lastMaterial);
			  }

			  function lastAppliedMaterialAvailable() {
			    return !!safeStorageGet(tenantStorageKey('LAST_APPLIED_REMOTE_HASH'))
			      || !!safeStorageGet(tenantStorageKey('LAST_APPLIED_REMOTE_MATERIAL_HASH'));
			  }

			  function accessIsFounderOrLifetime() {
			    const state = typeof window.click360GetEffectiveAccess === 'function'
			      ? window.click360GetEffectiveAccess()
			      : (window.click360AccessState || {});
			    const mode = String(state?.mode || '').toLowerCase();
			    const plan = String(state?.plan || '').toLowerCase();
			    const planCode = String(state?.planCode || '').toLowerCase();
			    const billingStatus = String(state?.billingStatus || '').toLowerCase();
			    const platformRole = String(state?.platformRole || '').toLowerCase();
			    const customerTier = String(state?.customerTier || '').toLowerCase();
			    return ['founder', 'lifetime', 'member'].includes(mode)
			      || ['founder', 'founder_unlimited', 'lifetime'].includes(plan)
			      || platformRole === 'platform_founder'
			      || customerTier === 'platform_founder'
			      || (state?.lifetime === true && billingStatus === 'lifetime')
			      || (planCode === 'pro_lifetime' && billingStatus === 'lifetime' && state?.lifetime === true);
			  }

			  function shouldTreatAsNonMaterial(source = '') {
			    return NON_MATERIAL_SYNC_SOURCES.has(String(source || '').toLowerCase());
			  }

			  function getSyncState({ cleanup = false, reason = 'sync_state', force = false } = {}) {
			    const now = Date.now();
			    const hashes = currentPayloadHashes();
			    const pendingMeta = localPendingSyncMeta();
			    const conflictMarker = readSyncConflictMarker();
			    SYNC_CONFLICT_PENDING = !!conflictMarker;
			    const pendingWindowActive = now < LOCAL_WRITE_PENDING_UNTIL;
			    const schedulerActive = PUSH_SCHEDULERS.has(activeSchedulerKey());
			    const pendingAgeMs = pendingMeta ? lockAgeMs(pendingMeta) : 0;
			    const conflictAgeMs = conflictMarker ? Number(conflictMarker.ageMs || UNKNOWN_LOCK_AGE_MS) : 0;
			    const materialEquivalent = materialMatchesLastApplied(hashes);
			    const hasRemoteBaseline = lastAppliedMaterialAvailable();
			    const pendingSource = String(pendingMeta?.source || '').toLowerCase();
			    const conflictSource = String(conflictMarker?.source || '').toLowerCase();
			    const nonMaterialSource = shouldTreatAsNonMaterial(pendingSource) || shouldTreatAsNonMaterial(conflictSource);
			    const stalePendingByTtl = pendingMeta && pendingAgeMs > PENDING_REMOTE_SYNC_TTL_MS && !schedulerActive && !pendingWindowActive;
			    const staleConflictByTtl = conflictMarker && conflictAgeMs > SYNC_CONFLICT_TTL_MS && !schedulerActive && !pendingWindowActive;
			    const legacyConflictWithoutBaseline = conflictMarker?.legacy === true && !hasRemoteBaseline && accessIsFounderOrLifetime();
			    const revisionConflict = conflictMarker && Number(conflictMarker.remoteRevision || 0) > 0
			      && Number(conflictMarker.baseRevision || conflictMarker.localRevision || 0) > 0
			      && Number(conflictMarker.remoteRevision || 0) !== Number(conflictMarker.baseRevision || conflictMarker.localRevision || 0);
			    const hasDirtyFields = !!hashes.payload && !materialEquivalent && hasRemoteBaseline && !nonMaterialSource;
			    const staleLock = force
			      || materialEquivalent
			      || nonMaterialSource
			      || legacyConflictWithoutBaseline
			      || ((stalePendingByTtl || staleConflictByTtl) && !hasDirtyFields && accessIsFounderOrLifetime());
			    const lastMaterial = safeStorageGet(tenantStorageKey('LAST_APPLIED_REMOTE_MATERIAL_HASH'));
			    const base = {
			      status: 'clean',
			      blocking: false,
			      reason,
			      activeBusinessId: String(hashes.payload?.data?.activeBusinessId || ''),
			      hasDirtyFields,
			      // r37: localHash/remoteHash here are diagnostic DISPLAY fields only
			      // (the real clean/dirty decision above uses materialEquivalent/
			      // hasDirtyFields, computed from materialMatchesLastApplied(hashes),
			      // never these two). They previously paired a FULL-payload hash
			      // (payloadHash, which changes on every write since it includes
			      // volatile fields like updatedAt/updatedAtMs) against a
			      // MATERIAL-only hash of the last applied remote snapshot -- an
			      // apples-to-oranges comparison that made a "clean" report look
			      // alarming (localHash != remoteHash on nearly every real report,
			      // even when genuinely clean) to whoever reads the diagnostic
			      // message. Both sides now use the material hash so the two
			      // values are directly comparable and a real material difference
			      // is what actually shows up as a mismatch.
			      localHash: hashFingerprint(hashes.materialHash),
			      remoteHash: hashFingerprint(lastMaterial || safeStorageGet(tenantStorageKey('LAST_APPLIED_REMOTE_HASH'))),
			      lastUpdatedAt: new Date(now).toISOString(),
			      displayMode: window.matchMedia?.('(display-mode: standalone)')?.matches === true || navigator.standalone === true ? 'standalone' : 'browser',
			      pendingAgeMs: pendingMeta ? pendingAgeMs : 0,
			      conflictAgeMs: conflictMarker ? conflictAgeMs : 0,
			      lockAgeMs: Math.max(pendingMeta ? pendingAgeMs : 0, conflictMarker ? conflictAgeMs : 0),
			      materialEquivalent,
			      schedulerActive,
			      pendingWindowActive,
			      pendingSource,
			      conflictSource,
			      legacyConflict: conflictMarker?.legacy === true,
			      cleanedPending: false,
			      cleanedConflict: false
			    };
			    let next = base;
			    if (!ACTIVE_CONTEXT) {
			      next = { ...base, status: 'clean', reason: 'no_active_context' };
			    } else if (!navigator.onLine && (pendingMeta || conflictMarker)) {
			      next = { ...base, status: 'offline', blocking: false, reason: 'offline_local_state' };
			    } else if (conflictMarker) {
			      if (staleLock && (nonMaterialSource || materialEquivalent || !revisionConflict)) {
			        next = { ...base, status: 'stale_lock', blocking: false, reason: conflictMarker.legacy ? 'legacy_conflict_marker' : 'stale_conflict_lock' };
			      } else if (revisionConflict || hasDirtyFields) {
			        next = { ...base, status: 'real_conflict', blocking: true, reason: 'remote_revision_conflict' };
			      } else {
			        next = { ...base, status: 'stale_lock', blocking: false, reason: 'conflict_without_material_dirty_fields' };
			      }
			    } else if (pendingMeta) {
			      if (staleLock) {
			        next = { ...base, status: 'stale_lock', blocking: false, reason: 'stale_pending_lock' };
			      } else if (hasDirtyFields || !hasRemoteBaseline) {
			        next = { ...base, status: 'pending_write', blocking: true, reason: 'pending_local_write' };
			      } else {
			        next = { ...base, status: 'loading', blocking: false, reason: 'sync_loading' };
			      }
			    } else if (pendingWindowActive && schedulerActive) {
			      next = { ...base, status: hasDirtyFields ? 'pending_write' : 'loading', blocking: hasDirtyFields, reason: hasDirtyFields ? 'pending_write_window' : 'sync_loading_window' };
			    }
			    if (cleanup && next.status === 'stale_lock') {
			      let cleanedPending = false;
			      let cleanedConflict = false;
			      if (conflictMarker) {
			        clearSyncConflict();
			        cleanedConflict = true;
			      }
			      if (pendingMeta || pendingWindowActive || force) {
			        LOCAL_WRITE_PENDING_UNTIL = 0;
			        clearLocalPendingSyncMetadata(reason, hashes);
			        cleanedPending = true;
			      }
			      next = { ...next, cleanedPending, cleanedConflict, blocking: false };
			      safeStorageSet(reliabilityDiagnosticsKey(), JSON.stringify({
			        recoveredAtMs: Date.now(),
			        reason: next.reason,
			        status: next.status,
			        pendingAgeMs: next.pendingAgeMs,
			        conflictAgeMs: next.conflictAgeMs,
			        localHash: next.localHash,
			        remoteHash: next.remoteHash
			      }));
			      setSyncStatus('synced', 'Estado local recuperado; datos listos para continuar.', { reason: next.reason, syncState: next.status });
			    }
			    return next;
			  }

		  function clearLocalPendingSyncMetadata(reason, hashes = currentPayloadHashes()) {
		    if (!hashes.payload) return false;
		    safeStorageSet(tenantStorageKey('LAST_APPLIED_REMOTE_MATERIAL_HASH'), hashes.materialHash);
		    window.click360MarkTenantCacheSynced?.({
		      revision: LAST_REMOTE_REVISION || 0,
		      payloadHash: hashes.payloadHash,
		      materialHash: hashes.materialHash,
		      operationId: reason
		    }).catch?.(() => {});
		    return true;
		  }

			  function maybeClearStaleSyncGuard({ reason = 'stale_sync_guard', force = false } = {}) {
			    const syncState = getSyncState({ cleanup: true, reason, force });
			    return {
			      clearedPending: syncState.cleanedPending === true,
			      clearedConflict: syncState.cleanedConflict === true,
			      equivalent: syncState.materialEquivalent === true,
			      syncState
			    };
			  }

			  function pendingRemoteSyncGateStatus(syncState = getSyncState({ cleanup: true, reason: 'pending_remote_sync_gate' })) {
			    if (!navigator.onLine) return { allowed: true, reason: 'offline' };
			    const pendingMeta = localPendingSyncMeta();
			    if (!pendingMeta && syncState.status !== 'pending_write') return { allowed: true, reason: syncState.status === 'stale_lock' ? 'stale_pending_cleared' : 'ok', syncState };
			    if (syncState.status === 'stale_lock' && !syncState.blocking) return { allowed: true, reason: 'stale_pending_cleared', syncState };
			    if (syncState.status !== 'pending_write') return { allowed: true, reason: 'ok', syncState };
			    const schedulerKey = activeSchedulerKey();
			    if (!PUSH_SCHEDULERS.has(schedulerKey) && Date.now() >= LOCAL_WRITE_PENDING_UNTIL) {
			      LOCAL_WRITE_PENDING_UNTIL = Date.now() + PENDING_REMOTE_SYNC_GRACE_MS;
			      pushLocalToFirestore('pending_gate_recovery').catch(() => {});
			      setSyncStatus('syncing', 'Sincronizando cambios...', { reason: 'pending_gate_recovery' });
			    }
			    return { allowed: false, reason: 'pending_remote_sync', pendingSinceMs: Number(pendingMeta?.pendingCreatedAtMs || pendingMeta?.savedAtMs || 0), syncState };
			  }

			  window.click360ClearStaleSyncGuard = (details = {}) => maybeClearStaleSyncGuard(details);
			  window.click360GetSyncState = (details = {}) => getSyncState({ cleanup: details.cleanup === true, reason: details.reason || 'diagnostic' });

		  function buildBusinessPayload() {
	    if (!activeIdentityIsValid() || typeof window.click360GetTenantState !== "function") return null;
	    const state = window.click360GetTenantState();
	    if (!state || !sameTenant(state.identity)) return null;
	    const settings = state.settings || {};
      const userProfiles = settings.userProfiles && typeof settings.userProfiles === 'object' && !Array.isArray(settings.userProfiles)
        ? { ...settings.userProfiles } : {};
      const canonicalProfile = getCachedProfile(auth.currentUser?.uid);
      const stateProfile = userProfiles[auth.currentUser?.uid];
      if (canonicalProfile?.uid === auth.currentUser?.uid && stateProfile?.pendingSync !== true) {
        userProfiles[canonicalProfile.uid] = canonicalProfile;
      }
	    const payload = {
	      schemaVersion: SCHEMA_VERSION,
	      identity: activeIdentity(),
	      data: {
	        businesses: Array.isArray(state.businesses) ? state.businesses : [],
	        activeBusinessId: state.activeBusinessId || null,
	        products: Array.isArray(state.products) ? state.products : [],
	        sales: Array.isArray(state.sales) ? state.sales : [],
	        movements: Array.isArray(state.movements) ? state.movements : [],
	        dailyReports: Array.isArray(state.dailyReports) ? state.dailyReports : [],
	        invoices: Array.isArray(state.invoices) ? state.invoices : [],
	        deletedProducts: Array.isArray(state.deletedProducts) ? state.deletedProducts : [],
	        auditLogs: Array.isArray(state.auditLogs) ? state.auditLogs : [],
	        layaways: Array.isArray(state.layaways) ? state.layaways : [],
	        cashSessions: Array.isArray(state.cashSessions) ? state.cashSessions : [],
	        tables: Array.isArray(state.tables) ? state.tables : [],
	        tableOrders: Array.isArray(state.tableOrders) ? state.tableOrders : [],
	        restaurantPayments: Array.isArray(state.restaurantPayments) ? state.restaurantPayments : [],
	        restaurantPrintHistory: Array.isArray(state.restaurantPrintHistory) ? state.restaurantPrintHistory : [],
	        restaurantEvents: Array.isArray(state.restaurantEvents) ? state.restaurantEvents : [],
	        restaurantRecipes: Array.isArray(state.restaurantRecipes) ? state.restaurantRecipes : [],
	        logistics: state.logistics && typeof state.logistics === 'object' && !Array.isArray(state.logistics) ? {
	          vehicles: Array.isArray(state.logistics.vehicles) ? state.logistics.vehicles : [],
	          routes: Array.isArray(state.logistics.routes) ? state.logistics.routes : [],
	          loadSheets: Array.isArray(state.logistics.loadSheets) ? state.logistics.loadSheets : [],
	          routeSales: Array.isArray(state.logistics.routeSales) ? state.logistics.routeSales : [],
	          collections: Array.isArray(state.logistics.collections) ? state.logistics.collections : [],
	          returns: Array.isArray(state.logistics.returns) ? state.logistics.returns : [],
	          routeSettlements: Array.isArray(state.logistics.routeSettlements) ? state.logistics.routeSettlements : [],
	          routeExpenses: Array.isArray(state.logistics.routeExpenses) ? state.logistics.routeExpenses : [],
	          routeCustomers: Array.isArray(state.logistics.routeCustomers) ? state.logistics.routeCustomers : [],
	          events: Array.isArray(state.logistics.events) ? state.logistics.events : [],
	          printHistory: Array.isArray(state.logistics.printHistory) ? state.logistics.printHistory : []
	        } : { vehicles: [], routes: [], loadSheets: [], routeSales: [], collections: [], returns: [], routeSettlements: [], routeExpenses: [], routeCustomers: [], events: [], printHistory: [] },
	        labelPrintHistory: Array.isArray(state.labelPrintHistory) ? state.labelPrintHistory : [],
	        finance: state.finance && typeof state.finance === 'object' && !Array.isArray(state.finance) ? {
	          payments: Array.isArray(state.finance.payments) ? state.finance.payments : [],
	          loans: Array.isArray(state.finance.loans) ? state.finance.loans : [],
	          envelopes: Array.isArray(state.finance.envelopes) ? state.finance.envelopes : [],
	          goals: Array.isArray(state.finance.goals) ? state.finance.goals : []
	        } : { payments: [], loans: [], envelopes: [], goals: [] },
	        notifications: Array.isArray(state.notifications) ? state.notifications : [],
	        legalAcceptances: Array.isArray(state.legalAcceptances) ? state.legalAcceptances : [],
	        settings: {
	          labelTemplates: Array.isArray(settings.labelTemplates) ? settings.labelTemplates : [],
	          labelProfiles: Array.isArray(settings.labelProfiles) ? settings.labelProfiles : [],
	          workers: Array.isArray(settings.workers) ? settings.workers : [],
	          userProfiles,
	          customers: Array.isArray(settings.customers) ? settings.customers : [],
	          reminders: Array.isArray(settings.reminders) ? settings.reminders : [],
	          onboarding: settings.onboarding && typeof settings.onboarding === 'object' ? settings.onboarding : {},
	          activationRequests: Array.isArray(settings.activationRequests) ? settings.activationRequests : [],
	          policies: settings.policies && typeof settings.policies === 'object' ? settings.policies : {},
	          legal: settings.legal && typeof settings.legal === 'object' ? settings.legal : {},
              legacyDataBusinessId: String(settings.legacyDataBusinessId || ''),
	          appVersion: '1.0.5'
	        },
	        updatedAtMs: Number(state.updatedAtMs || Date.now()),
	        updatedAt: state.updatedAt || new Date().toISOString()
	      }
	    };
	    return window.CLICK360_P0_TENANT_GUARD.validBusinessPayload(payload, ACTIVE_CONTEXT) ? payload : null;
	  }

	  function localPayloadUpdatedAtMs() {
	    return Number(buildBusinessPayload()?.data?.updatedAtMs || 0);
	  }

	  function quarantineIncident(kind, details = {}) {
	    const scope = ACTIVE_CONTEXT ? `${ACTIVE_CONTEXT.authUid}:${ACTIVE_CONTEXT.tenantKey}` : 'unauthenticated';
	    const key = `CLICK360:V16:QUARANTINE:${scope}:${Date.now()}:${kind}`;
	    try {
	      safeStorageSet(key, JSON.stringify({ kind, createdAt: new Date().toISOString(), context: ACTIVE_CONTEXT, ...details }));
	      const prefix = `CLICK360:V16:QUARANTINE:${scope}:`;
	      const keys = [];
	      for (let index = 0; index < localStorage.length; index += 1) {
	        const itemKey = localStorage.key(index);
	        if (itemKey?.startsWith(prefix)) keys.push(itemKey);
	      }
	      keys.sort();
	      keys.slice(0, Math.max(0, keys.length - 25)).forEach((itemKey) => localStorage.removeItem(itemKey));
	    } catch (error) {
	      console.warn("No se pudo guardar cuarentena:", error.message);
	    }
	  }

	  function quarantineLegacyLocalState() {
	    const raw = safeStorageGet(LEGACY_STATE_LS_KEY);
	    const marker = ACTIVE_CONTEXT ? `CLICK360:V16:QUARANTINE:${ACTIVE_CONTEXT.authUid}:${ACTIVE_CONTEXT.tenantKey}:legacy-local-seen` : '';
	    if (!raw || safeStorageGet(marker)) return;
	    const legacy = safeJsonParse(raw) || {};
	    const candidates = Array.isArray(legacy.businesses)
	      ? legacy.businesses.map(b => ({ id: b.id || null, name: b.name || null })) : [];
	    quarantineIncident("legacy_local_state", {
	      detectedUid: auth.currentUser?.uid || null,
	      detectedEmail: auth.currentUser?.email || null,
	      businessCandidates: candidates,
	      remoteMatches: [],
	      ambiguous: true,
	      legacyStateBytes: window.CLICK360_P0_TENANT_GUARD.utf8Bytes(raw)
	    });
	    safeStorageSet(marker, JSON.stringify({ context: ACTIVE_CONTEXT, detectedUid: auth.currentUser?.uid || null }));
	  }

	  function remoteMatchesContext(remote, context) {
	    return !!remote && remote.schemaVersion === SCHEMA_VERSION
	      && remote.ownerId === context?.ownerId
	      && remote.businessId === context?.businessId
	      && remote.ownerUid === context?.ownerUid
	      && remote.tenantKey === context?.tenantKey
	      && window.CLICK360_P0_TENANT_GUARD.validBusinessPayload(remote.payload, context);
	  }
	  function reconcileLocalStateWithRemoteV10(remote, context = ACTIVE_CONTEXT) {
	    if (!remoteMatchesContext(remote, context)) return { reconciled: false, removed: [] };
	    let removed = [];
	    try { removed = window.CLICK360_P0_TENANT_GUARD.reconcileLegacyMarkers(localStorage, context); }
	    catch (error) { console.warn('No se pudo limpiar metadata local; el remoto V10 sigue siendo valido:', error.message); }
	    // These two keys are exact namespaced metadata for the active tenant.
	    // They may only be removed after the authoritative remote V10 identity is valid.
	    [legacyMigrationMarkerKey(), tenantCorruptMarkerKey()].filter(Boolean).forEach((key) => {
	      if (safeStorageGet(key) != null && !removed.includes(key)) {
	        safeStorageRemove(key);
	        removed.push(key);
	      }
	    });
	    return { reconciled: true, removed };
	  }
	  window.reconcileLocalStateWithRemoteV10 = async function() {
	    const context = ACTIVE_CONTEXT;
	    const stateDoc = STATE_DOC;
	    const user = auth.currentUser;
	    if (!isActiveSyncScope(context, stateDoc, AUTH_EPOCH, user)) return { reconciled: false, removed: [] };
	    const snap = await stateDoc.get({ source: 'server' });
	    if (!snap.exists) return { reconciled: false, removed: [] };
	    return reconcileLocalStateWithRemoteV10(snap.data() || {}, context);
	  };
	  function applyRemotePayload(payload) {
	    if (!payload || !sameTenant(payload.identity) || typeof window.click360ApplyTenantState !== "function") {
	      throw new Error("Snapshot remoto pertenece a otro tenant o es inválido.");
	    }
	    const current = window.click360GetTenantState?.() || {};
	    const incoming = payload.data || {};
	    const incomingProfiles = incoming.settings?.userProfiles && typeof incoming.settings.userProfiles === 'object'
	      ? incoming.settings.userProfiles : {};
	    const currentProfiles = current.settings?.userProfiles && typeof current.settings.userProfiles === 'object'
	      ? current.settings.userProfiles : {};
	    const mergedProfiles = { ...incomingProfiles };
      const currentUid = auth.currentUser?.uid || '';
      const pendingProfile = safeJsonParse(safeStorageGet(`${PROFILE_PENDING_PREFIX}${currentUid}`))
        || safeJsonParse(safeStorageGet(`${LEGACY_PROFILE_PENDING_PREFIX}${currentUid}`));
      const localPendingProfile = currentProfiles[currentUid];
      const remoteCurrentProfile = mergedProfiles[currentUid];
      if ((pendingProfile?.uid === currentUid || localPendingProfile?.pendingSync === true) && localPendingProfile
        && profileUpdatedAtMs(localPendingProfile.updatedAt) >= profileUpdatedAtMs(remoteCurrentProfile?.updatedAt)) {
        mergedProfiles[currentUid] = localPendingProfile;
      }
	    const nextState = {
	      ...incoming,
	      identity: activeIdentity(),
	      settings: { ...(incoming.settings || {}), userProfiles: mergedProfiles }
	    };
	    IS_RESTORING_REMOTE = true;
	    try {
	      window.click360ApplyTenantState(nextState, ACTIVE_CONTEXT);
	    } finally {
	      IS_RESTORING_REMOTE = false;
	    }
	  }

	  function buildV10StateDocument(payload, reason, extra = {}) {
	    const user = auth.currentUser;
	    const revision = Math.max(Date.now(), Number(LAST_REMOTE_REVISION || 0) + 1);
	    return {
	      schemaVersion: SCHEMA_VERSION,
	      ownerUid: ACTIVE_CONTEXT.ownerUid,
	      ownerId: ACTIVE_CONTEXT.ownerId,
	      businessId: ACTIVE_CONTEXT.businessId,
	      tenantKey: ACTIVE_CONTEXT.tenantKey,
	      revision,
	      baseRevision: LAST_REMOTE_REVISION || 0,
	      deviceId: getDeviceId(),
	      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
	      updatedAtMs: revision,
	      updatedBy: user?.uid || null,
	      updatedByEmail: user?.email || null,
	      reason,
	      payload,
	      ...extra
	    };
	  }

	  function legacyMigrationMessage() {
	    return 'Detectamos datos de una versión anterior. Están protegidos y la operación queda bloqueada hasta que un administrador complete una migración verificada.';
	  }

		  function showLegacyMigrationGate() {
		    showGate(legacyMigrationMessage(), ACCESS_UI_STATES.BLOCKED, { reason: 'legacy_migration_required' });
	    setAppBlocked(true);
	  }

	  // Legacy data is migrated only by scripts/migrate-legacy-v9-to-v10.mjs with
	  // administrative credentials. A public browser must never rewrite it.
	  window.click360MigrateLegacyRemote = async function() {
	    throw new Error('La migración legacy es administrativa. Este tenant permanece protegido hasta completar el proceso verificado.');
	  };

  function isExplicitlyActive(data) {
    return !!data && (
      (data.status === 'active' && data.approved === true)
      || (!Object.prototype.hasOwnProperty.call(data, 'status') && data.approved === true)
    );
  }

  function setPendingUser(user, data = {}, status = 'pending') {
    window.click360User = {
      uid: user.uid,
      email: user.email || data.email || '',
      role: data.role || 'worker',
      name: data.name || user.displayName || (user.email ? user.email.split('@')[0] : 'Usuario'),
      photoURL: data.photoURL || user.photoURL || '',
      status,
      businessLimit: Number(data.businessLimit || 2),
      ownerId: data.ownerId || user.uid,
      isOwner: data.isOwner === true || data.role === 'owner',
      hasApprovedRecord: Object.keys(data || {}).length > 0
    };
  }

			  async function acceptInvitationFromUrl(user, expectedEpoch = AUTH_EPOCH) {
			    const currentParams = new URLSearchParams(location.search);
			    const inviteToken = currentParams.get('inviteToken') || currentParams.get('token') || '';
			    const ownerId = currentParams.get('ownerId') || '';
			    const explicit = readExplicitInvitationIntent();
		    if (!explicit || currentParams.get('flow') !== 'invite' || !inviteToken || !ownerId || !isCurrentAuthEpoch(user, expectedEpoch)) {
		      return { attempted: false, accepted: false };
		    }
	    const computedHash = await window.CLICK360_V16_DOMAIN?.sha256(inviteToken);
		    const suppliedHash = currentParams.get('inviteHash') || computedHash;
	    if (!computedHash || suppliedHash !== computedHash) throw new Error('La invitacion no es valida.');
	    const invite = invitationRef(ownerId, computedHash);
		    const member = memberRef(ownerId, user.uid);
		    const approved = db.collection('approvedUsers').doc(user.uid);
		    const normalizedEmail = String(user.email || '').trim().toLowerCase();
		    const trustedNowMs = await trustedAuthServerNowMs(user);
		    try {
	    await db.runTransaction(async (transaction) => {
	      const snapshot = await transaction.get(invite);
	      if (!snapshot.exists) throw new Error('La invitacion no existe o fue eliminada.');
	      const data = snapshot.data() || {};
	      if (data.ownerId !== ownerId || data.businessId !== ownerId || data.tenantKey !== tenantKeyFor(ownerId, ownerId) || data.inviteHash !== computedHash) throw new Error('La invitacion pertenece a otro negocio.');
	      if (String(data.email || '').toLowerCase() !== normalizedEmail) throw new Error('La invitacion fue emitida para otra cuenta de Google.');
	      if (data.status === 'accepted' && data.acceptedBy === user.uid) return;
	      if (data.status !== 'pending') throw new Error('La invitacion ya fue utilizada, revocada o expiro.');
		      const createdAtMs = data.createdAt?.toMillis?.() || 0;
		      if (!createdAtMs || (trustedNowMs && trustedNowMs >= createdAtMs + Number(data.expiresAfterDays || 7) * 24 * 60 * 60 * 1000)) throw new Error('La invitacion expiro. Solicita una nueva.');
	      const role = ['worker', 'seller', 'cashier', 'inventory', 'supervisor', 'admin'].includes(data.role) ? data.role : 'worker';
	      const permissions = data.permissions && typeof data.permissions === 'object' ? data.permissions : defaultWorkerPermissions(role);
	      const memberData = {
	        uid: user.uid,
	        email: normalizedEmail,
	        name: data.name || user.displayName || normalizedEmail.split('@')[0],
	        role,
	        permissions,
	        status: 'active',
	        ownerId,
	        businessId: ownerId,
	        tenantKey: tenantKeyFor(ownerId, ownerId),
	        invitationHash: computedHash,
	        businessUnitId: String(data.businessUnitId || ''),
	        acceptedAt: firebase.firestore.FieldValue.serverTimestamp(),
	        lastAccessAt: firebase.firestore.FieldValue.serverTimestamp()
	      };
	      // P0 commercial rule: this business includes at most 2 active workers
	      // (excluding the owner) unless additional paid seats were purchased.
	      // The entitlement doc is NOT read here on purpose: a first-time acceptor
	      // is neither the owner nor an active member yet, so firestore.rules'
	      // read rule for entitlement/seats would reject that read immediately
	      // (reads are checked against currently-committed state, before this
	      // transaction's writes exist). FieldValue.increment(1) needs no prior
	      // read; the write-time rule (seatConsumedForSelf) independently
	      // re-verifies capacity and the real member-activation transition at
	      // commit, when the full transaction IS visible to the rules engine.
	      const boundary = window.CLICK360_WORKER_DATA_BOUNDARY;
	      let seatRef = null;
	      if (data.businessUnitId) {
	        const boundaryIdentity = boundary?.identity?.(ownerId, data.businessUnitId);
	        if (!boundaryIdentity) throw new Error('La invitación no tiene una frontera modular válida.');
	        seatRef = db.collection('businesses').doc(ownerId).collection('businessUnits')
	          .doc(data.businessUnitId).collection('entitlement').doc('seats');
	      }
	      transaction.set(member, memberData);
	      if (data.businessUnitId) {
	        const boundaryIdentity = boundary.identity(ownerId, data.businessUnitId);
	        const unitMember = db.collection('businesses').doc(ownerId).collection('businessUnits')
	          .doc(data.businessUnitId).collection('members').doc(user.uid);
	        transaction.set(unitMember, {
	          id:user.uid,
	          uid:user.uid,
	          email:normalizedEmail,
	          name:memberData.name,
	          role,
	          permissions,
	          status:'active',
	          ...boundaryIdentity,
	          module:'members',
	          recordVersion:1,
	          createdBy:user.uid,
	          updatedBy:user.uid,
	          createdAt:firebase.firestore.FieldValue.serverTimestamp(),
	          updatedAt:firebase.firestore.FieldValue.serverTimestamp()
	        });
	        transaction.update(seatRef, {
	          activeMembers:firebase.firestore.FieldValue.increment(1),
	          lastActionUid:user.uid,
	          updatedBy:user.uid,
	          updatedAt:firebase.firestore.FieldValue.serverTimestamp()
	        });
	      }
	      transaction.set(approved, {
	        uid: user.uid,
	        email: normalizedEmail,
	        name: memberData.name,
	        photoURL: user.photoURL || '',
	        role,
	        permissions,
	        ownerId,
	        businessId: ownerId,
	        tenantKey: tenantKeyFor(ownerId, ownerId),
	        invitationHash: computedHash,
	        businessUnitId: String(data.businessUnitId || ''),
	        status: 'active',
	        approved: true,
	        isOwner: false,
	        businessLimit: 1,
	        workerLimit: 0,
	        approvedFromInvitation: true,
	        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
	        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
	      });
	      transaction.update(invite, { status: 'accepted', acceptedBy: user.uid, acceptedAt: firebase.firestore.FieldValue.serverTimestamp(), consumed: true });
	    });
	    } catch (transactionError) {
	      const acceptTelemetryContext = { ownerId, businessId:ownerId, tenantKey:tenantKeyFor(ownerId, ownerId) };
	      if (transactionError?.code === 'permission-denied') {
	        recordTelemetry('worker_seat_exhausted', { errorCode:'permission-denied' }, acceptTelemetryContext).catch(() => {});
	        throw new Error('No hay cupos de trabajador disponibles para este negocio. Pide al dueño que compre un cupo adicional o libere uno.');
	      }
	      recordTelemetry('worker_login_failed', { errorCode:String(transactionError?.code || 'accept_failed').slice(0, 80) }, acceptTelemetryContext).catch(() => {});
	      throw transactionError;
	    }
		    clearInvitationIntent({ cleanUrl: true });
		    clearPublicAuthIntent();
			    recordTelemetryOnce(`invite-accept:${ownerId}:${computedHash}:${user.uid}`, 'invitation', { mode: 'accepted' });
			    return { attempted: true, accepted: true, ownerId, inviteHash: computedHash };
		  }

	  async function isApprovedUser(user, expectedEpoch = AUTH_EPOCH) {
	    if (!isCurrentAuthEpoch(user, expectedEpoch)) return false;
	    APPROVED_LOOKUP_STATUS = 'checking';
	    try {
      const doc = await db.collection('approvedUsers').doc(user.uid).get();
      if (!isCurrentAuthEpoch(user, expectedEpoch)) return false;
      let data = doc.exists ? (doc.data() || {}) : null;

	      if (data?.status === 'blocked' || data?.status === 'revoked') {
	        APPROVED_LOOKUP_STATUS = 'record_found';
	        setPendingUser(user, data, data.status);
        return false;
      }

      if (!data && user.email) {
	        const emailDoc = await db.collection('approvedUsersByEmail').doc(user.email.toLowerCase()).get();
        if (!isCurrentAuthEpoch(user, expectedEpoch)) return false;
        const invite = emailDoc?.exists ? (emailDoc.data() || {}) : null;
        if (invite?.status === 'active' && invite.approved === true) {
          data = {
            uid: user.uid,
            email: user.email,
            role: invite.role || 'worker',
            ownerId: invite.ownerId || user.uid,
            name: invite.name || user.displayName || (user.email ? user.email.split('@')[0] : 'Trabajador'),
            status: 'active',
            approved: true,
            businessLimit: Number(invite.businessLimit || 2),
            photoURL: user.photoURL || '',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            approvedFromEmail: true
          };
	          await db.collection('approvedUsers').doc(user.uid).set(data, { merge: true });
	          if (!isCurrentAuthEpoch(user, expectedEpoch)) return false;
	        } else if (invite) {
	          data = { ...invite, email: user.email, historicalEmailRecord: true };
	        }
	      }

	      if (isExplicitlyActive(data)) {
	        APPROVED_LOOKUP_STATUS = 'record_found';
        if (data.businessId && data.businessId !== (data.ownerId || user.uid)) {
          setPendingUser(user, data, 'tenant_configuration_invalid');
          return false;
        }
        return await applyApprovedIdentity(user, data, 'approvedUsers', expectedEpoch);
	      }

	      APPROVED_LOOKUP_STATUS = data ? 'record_found' : 'not_found';
	      setPendingUser(user, data || {}, data?.status || 'pending');
      return false;
    } catch (error) {
      if (!isCurrentAuthEpoch(user, expectedEpoch)) return false;
	      const cached = getCachedApprovedIdentity(user);
	      if (cached && (!navigator.onLine || error.code === 'unavailable')) {
	        APPROVED_LOOKUP_STATUS = 'offline_cache';
	        const applied = await applyApprovedIdentity(user, cached, 'offline_cache', expectedEpoch);
        if (applied) setSyncStatus('offline', 'Trabajando sin internet con la última aprobación guardada.');
        return applied;
	      }
	      APPROVED_LOOKUP_STATUS = 'recoverable_error';
	      console.warn('No se pudo verificar la aprobación:', error.message);
      return false;
    }
  }

  function serverTimestampMs(value) {
    if (typeof value?.toMillis === 'function') return value.toMillis();
    if (Number.isFinite(Number(value?.seconds))) return Number(value.seconds) * 1000;
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

	  function accessStateFromData(data = {}, trustedServerNowMs = 0) {
    const serverNowMs = Number(trustedServerNowMs) || serverTimestampMs(data.lastSeenAt);
    const evaluator = window.CLICK360_V16_DOMAIN?.evaluateEntitlement;
    const evaluated = evaluator
      ? evaluator(data, serverNowMs)
      : window.CLICK360_P0_TENANT_GUARD.evaluateAccountAccess({
          status: data.status,
          plan: data.plan,
	          planCode: data.planCode,
	          lifetime: data.lifetime === true,
	          billingStatus: data.billingStatus,
	          trialStartedAtMs: serverTimestampMs(data.trialStartedAt)
        }, serverNowMs, TRIAL_DAYS);
	    return { ...evaluated, serverNowMs, source: 'accountAccess', revision: Number(data.revision || 0) };
	  }

	  function accountAccessIdentityValid(user, data = {}) {
	    if (!user?.uid || !data || data.uid !== user.uid || data.businessId !== user.uid) return false;
	    if (data.ownerId && data.ownerId !== user.uid) return false;
	    if (data.tenantKey && data.tenantKey !== tenantKeyFor(user.uid, user.uid)) return false;
	    return data.businessId !== 'demo-click360' && !String(data.tenantKey || '').includes('demo-click360');
	  }

	  function classifyAccountAccessError(error) {
	    const code = String(error?.code || 'unknown');
	    if (code === 'permission-denied') return 'permission_denied';
	    if (['unavailable', 'deadline-exceeded', 'network-request-failed'].includes(code)) return 'network_error';
	    return 'recoverable_error';
	  }

	  function requiresFreshEntitlementClock(data = {}) {
	    const status = String(data.status || '').toLowerCase();
	    return ['trial', 'trial_active'].includes(status) || !!serverTimestampMs(data.expiresAt);
	  }

	  async function trustedAuthServerNowMs(user) {
	    try {
	      const tokenResult = await user?.getIdTokenResult?.(true);
	      const issuedAtMs = Date.parse(String(tokenResult?.issuedAtTime || ''));
	      return Number.isFinite(issuedAtMs) ? issuedAtMs : 0;
	    } catch (error) {
	      console.warn('No se pudo confirmar la hora del servidor de acceso:', error.code || error.message);
	      return 0;
	    }
	  }

	  function cacheAccountAccess(user, data = {}) {
	    if (!accountAccessIdentityValid(user, data)) return false;
	    return safeStorageSet(accountAccessCacheKey(user.uid), JSON.stringify({
	      uid: user.uid,
	      cachedAtMs: Date.now(),
	      data
	    }));
	  }

	  function getCachedAccountAccess(user) {
	    const cached = safeJsonParse(safeStorageGet(accountAccessCacheKey(user?.uid)));
	    if (!cached || cached.uid !== user?.uid || !accountAccessIdentityValid(user, cached.data || {})) return null;
	    if (!Number.isFinite(Number(cached.cachedAtMs)) || Date.now() - Number(cached.cachedAtMs) > OFFLINE_APPROVAL_MAX_AGE_MS) return null;
	    const state = accessStateFromData(cached.data || {});
	    if (!state.allowed) return null;
	    return {
	      status: 'ready',
	      exists: true,
	      data: cached.data,
	      state: requiresFreshEntitlementClock(cached.data) ? { ...state, readOnly: true, clockVerificationRequired: true } : state,
	      source: 'offline_cache'
	    };
	  }

	  async function resolveAccountAccess(user, expectedEpoch = AUTH_EPOCH, options = {}) {
	    if (!isCurrentAuthEpoch(user, expectedEpoch)) return { status: 'stale_auth' };
	    if (!navigator.onLine) return getCachedAccountAccess(user) || { status: 'network_error', errorCode: 'offline' };
	    const ref = accountAccessRef(user.uid);
	    if (!ref) return { status: 'recoverable_error', errorCode: 'missing_ref' };
	    try {
	      let createdNow = false;
	      let snap = await ref.get({ source: 'server' });
	      if (!isCurrentAuthEpoch(user, expectedEpoch)) return { status: 'stale_auth' };
		      if (!snap.exists && options.allowCreate !== true) return { status: 'not_found', exists: false };
		      if (!snap.exists) {
	        if (options.allowCreate === true && APPROVED_LOOKUP_STATUS !== 'not_found') {
	          return { status: 'identity_reconciliation_required', exists: false, errorCode: APPROVED_LOOKUP_STATUS };
	        }
	        await db.runTransaction(async (transaction) => {
          const current = await transaction.get(ref);
          if (current.exists) return;
	          transaction.set(ref, {
	            uid: user.uid,
	            ownerId: user.uid,
	            businessId: user.uid,
	            tenantKey: tenantKeyFor(user.uid, user.uid),
            email: user.email || '',
            name: user.displayName || '',
            photoURL: window.CLICK360_P0_TENANT_GUARD.safeImageSrc(user.photoURL),
            status: 'trial',
            plan: 'normal',
            planCode: 'base',
            trialDays: TRIAL_DAYS,
            trialStartedAt: firebase.firestore.FieldValue.serverTimestamp(),
            profileUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            lastSeenAt: firebase.firestore.FieldValue.serverTimestamp(),
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
	            source: 'self_service',
            entitlementVersion: 16,
            revision: 1
          });
	          createdNow = true;
	        });
	        snap = await ref.get({ source: 'server' });
	      }
	      if (!isCurrentAuthEpoch(user, expectedEpoch)) return { status: 'stale_auth' };
	      if (!snap.exists) return { status: 'not_found', exists: false };
	      const data = snap.data() || {};
	      if (!accountAccessIdentityValid(user, data)) {
	        return { status: 'identity_invalid', exists: true, errorCode: 'account_identity_mismatch' };
	      }
	      const trustedServerNowMs = requiresFreshEntitlementClock(data)
	        ? (createdNow ? serverTimestampMs(data.lastSeenAt) : await trustedAuthServerNowMs(user))
	        : 0;
	      if (!isCurrentAuthEpoch(user, expectedEpoch)) return { status: 'stale_auth' };
	      const clockVerified = !requiresFreshEntitlementClock(data) || trustedServerNowMs > 0;
	      let state = accessStateFromData(data, trustedServerNowMs);
	      if (!state.allowed) return { status: 'invalid_entitlement', exists: true, data, state };
	      if (requiresFreshEntitlementClock(data) && !clockVerified) {
	        state = { ...state, readOnly: true, clockVerificationRequired: true };
	      }
	      cacheAccountAccess(user, data);
	      return { status: 'ready', exists: true, data, state, source: 'server' };
	    } catch (error) {
	      const status = classifyAccountAccessError(error);
	      console.warn('No se pudo resolver el acceso de cuenta:', error.code || error.message);
	      return { status, errorCode: String(error.code || 'unknown') };
	    }
	  }

	  async function touchAccountAccessActivity(user, expectedEpoch = AUTH_EPOCH) {
	    if (!isCurrentAuthEpoch(user, expectedEpoch) || window.click360AccessState?.source !== 'accountAccess') return false;
	    const ref = accountAccessRef(user.uid);
	    if (!ref || !navigator.onLine) return false;
	    try {
	      await ref.update({ lastSeenAt: firebase.firestore.FieldValue.serverTimestamp() });
	      const snap = await ref.get({ source: 'server' });
	      if (!isCurrentAuthEpoch(user, expectedEpoch) || !snap.exists) return false;
	      const data = snap.data() || {};
	      if (!accountAccessIdentityValid(user, data)) return false;
	      cacheAccountAccess(user, data);
	      const state = accessStateFromData(data);
	      if (!state.allowed) {
	        enterEntitlementReadOnly(state);
	        return false;
	      }
	      const published = publishAccessState(state);
	      if (window.click360User) window.click360User.access = published;
	      scheduleAccessExpiry(user, published, expectedEpoch);
	      if (published.readOnly) setSyncStatus('read_only', 'Tu acceso terminó. Tus datos permanecen disponibles en modo lectura.');
	      return true;
	    } catch (error) {
	      console.warn('No se pudo registrar la actividad de acceso:', error.code || error.message);
	      recordTelemetryOnce(`last-seen-failure:${expectedEpoch}:${user.uid}`, 'login', { mode: 'last_seen_failed', errorCode: error.code || 'unknown' });
	      return false;
	    }
	  }

  function applyAccountAccessIdentity(user, account, expectedEpoch = AUTH_EPOCH) {
    if (!isCurrentAuthEpoch(user, expectedEpoch) || !account?.state?.allowed) return false;
    const access = account.state;
    const data = account.data || {};
    const ownerId = user.uid;
    const limits = window.CLICK360_V16_DOMAIN?.planLimits(access.plan)
      || (access.plan === 'pro' ? { businesses: 5, workers: 10 } : { businesses: 1, workers: 2 });
    window.click360User = {
      uid: user.uid,
      email: user.email || data.email || '',
      role: 'owner',
      name: data.name || user.displayName || (user.email ? user.email.split('@')[0] : 'Usuario'),
      photoURL: data.photoURL || user.photoURL || '',
      status: access.mode,
      approved: false,
      businessLimit: limits.businesses,
      workerLimit: limits.workers,
      ownerId,
      isOwner: true,
      access: publishAccessState(access)
    };
    ACTIVE_CONTEXT = Object.freeze({
      authUid: user.uid,
      ownerUid: ownerId,
      ownerId,
      businessId: ownerId,
      tenantKey: tenantKeyFor(ownerId, ownerId),
      schemaVersion: SCHEMA_VERSION
    });
    tenantGuard.begin(ACTIVE_CONTEXT);
    BUSINESS_ID = ownerId;
    STATE_DOC = db.collection('businesses').doc(BUSINESS_ID).collection('state').doc('main');
    LAST_REMOTE_REVISION = Number(safeStorageGet(tenantStorageKey('REMOTE_REVISION')) || 0);
		    SYNC_CONFLICT_PENDING = !!readSyncConflictMarker();
    if (typeof window.click360SetTenantContext !== 'function') throw new Error('La interfaz segura todavía no está lista.');
	    window.click360SetTenantContext(ACTIVE_CONTEXT, { deferLocalLoad: true });
	    scheduleAccessExpiry(user, window.click360User.access, expectedEpoch);
	    return true;
  }

  window.click360UpdateAccessProfile = async function(profile = {}) {
    const user = auth.currentUser;
    const ref = accountAccessRef(user?.uid);
    if (!user || !ref || user.uid !== ACTIVE_CONTEXT?.authUid) return false;
    await ref.update({
      name: String(profile.name || '').slice(0, 120),
      photoURL: window.CLICK360_P0_TENANT_GUARD.safeImageSrc(profile.photoURL),
      profileUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      lastSeenAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return true;
  };

  window.click360CreateActivationRequest = async function(selection = {}) {
    const user = auth.currentUser;
    if (!user || !ACTIVE_CONTEXT || user.uid !== ACTIVE_CONTEXT.authUid || window.click360User?.role !== 'owner') {
      throw new Error('No se pudo verificar al propietario de esta solicitud.');
    }
    const plan = window.CLICK360_V16_DOMAIN?.normalizePlan(selection.plan) || 'base';
    if (!['base', 'pro'].includes(plan)) throw new Error('Plan invalido.');
    const allowedPeriods = ['month', 'quarter', 'semester', 'year', 'lifetime'];
    const period = allowedPeriods.includes(selection.period) ? selection.period : 'month';
    if (plan === 'pro' && period === 'lifetime') throw new Error('El plan Pro no ofrece periodo lifetime.');
    const price = Number(window.CLICK360_V16_DOMAIN?.PLAN_CATALOG?.[plan]?.prices?.[period]);
    if (!Number.isFinite(price)) throw new Error('Precio de plan no disponible.');
    const requestRef = db.collection('activationRequests').doc();
    const requestCode = `C360-${requestRef.id.slice(0, 8).toUpperCase()}`;
    await requestRef.set({
      requestId: requestRef.id,
      uid: user.uid,
      businessId: ACTIVE_CONTEXT.businessId,
      tenantKey: ACTIVE_CONTEXT.tenantKey,
      email: user.email || '',
      businessName: String(selection.businessName || '').slice(0, 120),
      plan,
      period,
      price,
      currency: 'USD',
      requestCode,
      status: 'pending',
      notes: String(selection.notes || '').slice(0, 500),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
	      // Must match firestore.rules' activationRequests contract (16.0.0/16.2.0), not the
	      // commercial version — see the appVersion fix in click360InviteWorkerEmail.
	      appVersion: '16.2.0'
	    });
	    recordTelemetry('plan_request', { requestId: requestRef.id, mode: plan }).catch(() => {});
	    return { requestId: requestRef.id, requestCode, plan, period, price, currency: 'USD' };
  };

  window.click360SaveLegalAcceptance = async function(acceptance = {}) {
    const user = auth.currentUser;
    if (!user || !ACTIVE_CONTEXT || user.uid !== ACTIVE_CONTEXT.authUid) throw new Error('Sesion no verificada.');
    const termsVersion = String(acceptance.termsVersion || window.CLICK360_V16_DOMAIN?.TERMS_VERSION || '2026-07-14');
    const acceptanceId = `${user.uid}_${termsVersion.replace(/[^0-9a-z_-]/gi, '_')}`;
    const ref = db.collection('legalAcceptances').doc(acceptanceId);
    await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(ref);
      if (existing.exists) return;
      transaction.set(ref, {
        acceptanceId,
        uid: user.uid,
        businessId: ACTIVE_CONTEXT.businessId,
        tenantKey: ACTIVE_CONTEXT.tenantKey,
        termsVersion,
        privacyVersion: String(acceptance.privacyVersion || termsVersion),
        locale: String(acceptance.locale || navigator.language || 'es-EC').slice(0, 20),
        source: String(acceptance.source || 'app').slice(0, 40),
        acceptedAt: firebase.firestore.FieldValue.serverTimestamp(),
        // Must match firestore.rules' legalAcceptances contract (16.0.0/16.2.0), not the
        // commercial version — see the appVersion fix in click360InviteWorkerEmail.
        appVersion: '16.2.0'
      });
    });
    return { acceptanceId, termsVersion };
  };

  // r37 (legacy consent grace): records WHEN the "Términos actualizados"
  // banner was first shown to an already-onboarded (legacy) account --
  // separate from legalAcceptances, which only records an actual
  // acceptance. termsPresentedAt is write-once (matches firestore.rules:
  // set only on the initial create via serverTimestamp(), never touched
  // by the update branch) since it is what starts the 7-day grace clock;
  // re-presenting the banner only bumps lastShownAt. CEO Admin reads this
  // collection directly to compute a customer's real legal status.
  window.click360SaveLegalGracePresented = async function(grace = {}) {
    const user = auth.currentUser;
    if (!user || !ACTIVE_CONTEXT || user.uid !== ACTIVE_CONTEXT.authUid) throw new Error('Sesion no verificada.');
    const ref = db.collection('legalGraceStatus').doc(user.uid);
    const nowServer = firebase.firestore.FieldValue.serverTimestamp();
    await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(ref);
      if (!existing.exists) {
        transaction.set(ref, {
          uid: user.uid,
          termsPresentedAt: nowServer,
          presentedTermsVersion: String(grace.presentedTermsVersion || window.CLICK360_V16_DOMAIN?.TERMS_VERSION || '2026-07-14'),
          presentedPrivacyVersion: String(grace.presentedPrivacyVersion || window.CLICK360_V16_DOMAIN?.PRIVACY_VERSION || '2026-07-14'),
          lastShownAt: nowServer,
          updatedAt: nowServer
        });
      } else {
        transaction.update(ref, { lastShownAt: nowServer, updatedAt: nowServer });
      }
    });
    return { ok: true };
  };

  function safeAuditDelta(value = {}) {
    const source = value && typeof value === 'object' ? value : {};
    const result = {};
    if (source.status != null) result.status = String(source.status).slice(0, 40);
    if (Number.isFinite(Number(source.amount))) result.amount = Number(source.amount);
    if (Number.isFinite(Number(source.stock))) result.stock = Number(source.stock);
    if (source.role != null) result.role = String(source.role).slice(0, 40);
    return result;
  }
  window.click360AppendAuditEvent = async function(event = {}) {
    const user = auth.currentUser;
    const context = ACTIVE_CONTEXT;
    if (!user || !context || context.businessId === 'demo-click360') throw new Error('Sesion de auditoria no verificada.');
    const eventId = String(event.id || db.collection('_').doc().id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
	    if (MODULAR_MODE) return { eventId, pending:true };
    const details = event.details && typeof event.details === 'object' ? event.details : {};
    const payload = {
      eventId,
      businessId: context.businessId,
      tenantKey: context.tenantKey,
      actorUid: user.uid,
      actorRole: String(event.actorRole || window.click360User?.role || 'owner').slice(0, 40),
      actorName: String(event.createdBy || user.displayName || 'Usuario').slice(0, 120),
      action: String(event.action || '').replace(/[^a-z0-9_:-]/gi, '').slice(0, 80),
      entityType: String(event.entityType || details.entityType || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40),
      entityId: String(event.entityId || details.entityId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100),
      correlationId: String(event.correlationId || details.correlationId || details.operationId || eventId).replace(/[^a-zA-Z0-9_:-]/g, '').slice(0, 100),
      amount: Number.isFinite(Number(details.amount ?? details.total)) ? Number(details.amount ?? details.total) : 0,
      status: String(details.status || '').slice(0, 40),
      before: safeAuditDelta(details.before),
      after: safeAuditDelta(details.after),
      appVersion: '16.2.0',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    await db.collection('businesses').doc(context.businessId).collection('auditEvents').doc(eventId).set(payload);
    return { eventId };
  };

  window.click360DebugAuth = function() {
    return {
      authenticated: !!auth.currentUser,
      approved: AUTH_APPROVED,
      tenantKey: ACTIVE_CONTEXT?.tenantKey || null,
      syncStatus: syncStatus.status
    };
  };
	  window.click360IsModularBoundarySession = () => MODULAR_MODE && !!MODULAR_GATEWAY;
	  window.click360CanModularAction = (moduleName, action) => MODULAR_MODE && MODULAR_GATEWAY?.may?.(moduleName, action) === true;
	  // Phase 3.2 gradual rollout: same gate as applyWorkerBoundaryIdentity,
	  // reused by every owner-initiated Workers action below. The owner is
	  // always allowed to read their own featureFlags/workers doc.
	  async function currentOwnerWorkersEnabled(ownerId) {
	    const boundary = window.CLICK360_WORKER_DATA_BOUNDARY;
	    const projectId = window.CLICK360_FIREBASE_CONFIG?.projectId || '';
	    if (boundary?.enabledForProject?.(projectId)) return true;
	    if (!ownerId) return false;
	    try {
	      const flagSnapshot = await db.collection('businesses').doc(ownerId).collection('featureFlags').doc('workers').get({ source:'server' });
	      return boundary?.workersEnabledForTenant?.(projectId, flagSnapshot.exists ? flagSnapshot.data() : null) === true;
	    } catch (_error) {
	      return false;
	    }
	  }
	  // Exposed so app.js's workersView()/bindWorkers() can dynamically
	  // re-check tenant-level (not just project-level) rollout status at
	  // render time, instead of relying solely on the static, project-only
	  // WORKER_TENANT_ACCESS_ENABLED computed once at boot (see Phase 3.3
	  // staging-only-dependency audit).
	  window.click360CurrentOwnerWorkersEnabled = currentOwnerWorkersEnabled;
	  window.click360ListBusinessUnitAuditEvents = async function(businessUnitId) {
	    if (!window.click360User?.isOwner) return [];
	    const ownerId = window.click360User.uid;
	    if (!(await currentOwnerWorkersEnabled(ownerId))) return [];
	    const safeBusinessId = String(businessUnitId || '').trim();
	    if (!safeBusinessId || safeBusinessId === 'demo-click360') return [];
	    const snapshot = await db.collection('businesses').doc(ownerId).collection('businessUnits')
	      .doc(safeBusinessId).collection('auditEvents').limit(200).get({ source:'server' });
	    return snapshot.docs.map((entry) => entry.data());
	  };
	  window.click360InviteWorkerEmail = async function(email, name, options = {}) {
	    if (!window.click360User || window.click360User.role !== 'owner' || auth.currentUser?.uid !== ACTIVE_CONTEXT?.authUid) throw new Error('No tienes permisos.');
	    const ownerId = window.click360User.uid;
	    const normalizedEmail = String(email || '').trim().toLowerCase();
	    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error('Correo de trabajador invalido.');
	    const role = ['worker', 'seller', 'cashier', 'inventory', 'supervisor', 'admin'].includes(options.role) ? options.role : 'worker';
	    const permissions = options.permissions && typeof options.permissions === 'object' ? options.permissions : defaultWorkerPermissions(role);
	    const businessUnitId = String(options.businessUnitId || '').trim();
	    if ((await currentOwnerWorkersEnabled(ownerId)) && !businessUnitId) {
	      throw new Error('Selecciona el negocio modular antes de crear la invitación.');
	    }
	    const inviteToken = window.CLICK360_V16_DOMAIN?.randomToken();
	    const inviteHash = await window.CLICK360_V16_DOMAIN?.sha256(inviteToken);
	    if (!inviteToken || !inviteHash) throw new Error('No se pudo generar una invitacion segura.');
	    const invite = invitationRef(ownerId, inviteHash);
	    const secret = invitationSecretRef(ownerId, inviteHash);
	    const batch = db.batch();
	    batch.set(invite, {
	      inviteHash,
	      email: normalizedEmail,
	      name: String(name || '').slice(0, 120),
	      role,
	      permissions,
	      ownerId,
	      businessId: ownerId,
	      ...(businessUnitId ? { businessUnitId } : {}),
	      tenantKey: tenantKeyFor(ownerId, ownerId),
	      status: 'pending',
	      expiresAfterDays: 7,
	      singleUse: true,
	      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
	      createdBy: ownerId,
	      appVersion: '16.2.0'
	    });
	    batch.set(secret, {
	      inviteHash,
	      token: inviteToken,
	      email: normalizedEmail,
	      ownerId,
	      createdAt: firebase.firestore.FieldValue.serverTimestamp()
		    });
		    try {
		      await batch.commit();
		    } catch (inviteError) {
		      recordTelemetry('worker_invite_failed', { errorCode:String(inviteError?.code || 'invite_failed').slice(0, 80) }).catch(() => {});
		      throw inviteError;
		    }
		    recordTelemetry('invitation', { requestId: inviteHash, mode: 'created' }).catch(() => {});
		    return { inviteToken, inviteHash, ownerId, businessUnitId, role, permissions, expiresAfterDays: 7 };
	  };

	  window.click360GetInviteLink = async function(inviteHash) {
	    if (!window.click360User || window.click360User.role !== 'owner') throw new Error('No tienes permisos.');
	    const ownerId = window.click360User.uid;
	    const snap = await invitationSecretRef(ownerId, inviteHash).get({ source: 'server' });
	    const data = snap.exists ? (snap.data() || {}) : null;
	    if (!data?.token || data.inviteHash !== inviteHash || data.ownerId !== ownerId) throw new Error('El enlace ya no esta disponible; regenera la invitacion.');
	    return `${location.origin}${location.pathname}?invite=true&ownerId=${encodeURIComponent(ownerId)}&inviteHash=${encodeURIComponent(inviteHash)}&inviteToken=${encodeURIComponent(data.token)}`;
	  };

	  window.click360ListWorkers = async function() {
	    if (!window.click360User || window.click360User.role !== 'owner') throw new Error('No tienes permisos.');
	    const ownerId = window.click360User.uid;
	    const [inviteSnapshot, memberSnapshot] = await Promise.all([
	      db.collection('businesses').doc(ownerId).collection('invitations').get(),
	      db.collection('businesses').doc(ownerId).collection('members').get()
	    ]);
	    const membersByHash = new Map(memberSnapshot.docs.map((doc) => {
	      const data = doc.data() || {};
	      return [data.invitationHash || '', { uid: doc.id, ...data }];
	    }));
	    return inviteSnapshot.docs.map((doc) => {
	      const invite = doc.data() || {};
	      const member = membersByHash.get(doc.id) || {};
	      return { ...invite, ...member, inviteHash: doc.id, uid: member.uid || invite.acceptedBy || '', permissions: member.permissions || invite.permissions || defaultWorkerPermissions(invite.role) };
	    });
	  };

	  window.click360CancelInviteEmail = async function(email, inviteHash = '') {
	    if (!window.click360User || window.click360User.role !== 'owner') throw new Error('No tienes permisos.');
	    const ownerId = window.click360User.uid;
	    let hash = inviteHash;
	    if (!hash) {
	      const found = await db.collection('businesses').doc(ownerId).collection('invitations').where('email', '==', String(email || '').toLowerCase()).limit(1).get();
	      hash = found.docs[0]?.id || '';
	    }
	    if (!hash) return false;
	    await invitationRef(ownerId, hash).set({ status: 'revoked', revokedAt: firebase.firestore.FieldValue.serverTimestamp(), revokedBy: ownerId }, { merge: true });
	    return true;
	  };

	  window.click360UpdateWorkerPermissions = async function(workerUid, inviteHash, role, permissions, businessUnitId = '') {
	    if (!window.click360User || window.click360User.role !== 'owner') throw new Error('No tienes permisos.');
	    const ownerId = window.click360User.uid;
	    const nextRole = ['worker', 'seller', 'cashier', 'inventory', 'supervisor', 'admin'].includes(role) ? role : 'worker';
	    const batch = db.batch();
	    batch.set(invitationRef(ownerId, inviteHash), { role: nextRole, permissions, updatedAt: firebase.firestore.FieldValue.serverTimestamp(), updatedBy: ownerId }, { merge: true });
	    if (workerUid) {
	      batch.set(memberRef(ownerId, workerUid), { role: nextRole, permissions, updatedAt: firebase.firestore.FieldValue.serverTimestamp(), updatedBy: ownerId }, { merge: true });
	      batch.set(db.collection('approvedUsers').doc(workerUid), { role: nextRole, permissions, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
	      if (businessUnitId && (await currentOwnerWorkersEnabled(ownerId))) {
	        const unitMember = db.collection('businesses').doc(ownerId).collection('businessUnits').doc(businessUnitId).collection('members').doc(workerUid);
	        const current = await unitMember.get({ source:'server' });
	        if (!current.exists) throw new Error('La membresía modular no existe.');
	        batch.update(unitMember, {
	          role:nextRole, permissions, recordVersion:Number(current.data()?.recordVersion || 1) + 1,
	          updatedAt:firebase.firestore.FieldValue.serverTimestamp(), updatedBy:ownerId
	        });
	      }
	    }
	    await batch.commit();
	    return true;
	  };

	  window.click360RemoveWorkerUid = async function(workerUid) {
	    if (!window.click360User || window.click360User.role !== 'owner') throw new Error('No tienes permisos.');
	    return window.click360RevokeWorker('', workerUid, '');
	  };

	  window.click360RevokeWorker = async function(email, workerUid = '', inviteHash = '') {
	    if (!window.click360User || window.click360User.role !== 'owner') throw new Error('No tienes permisos.');
	    const ownerId = window.click360User.uid;
	    let hash = inviteHash;
	    let inviteData = null;
	    if (!hash && email) {
	      const found = await db.collection('businesses').doc(ownerId).collection('invitations').where('email', '==', String(email).toLowerCase()).limit(1).get();
	      hash = found.docs[0]?.id || '';
	      inviteData = found.docs[0]?.data?.() || null;
	    }
	    if (hash && !inviteData) {
	      const inviteSnapshot = await invitationRef(ownerId, hash).get({ source:'server' });
	      inviteData = inviteSnapshot.exists ? inviteSnapshot.data() : null;
	    }
	    const batch = db.batch();
	    let writes = 0;
	    if (hash) {
	      batch.set(invitationRef(ownerId, hash), { status: 'revoked', revokedAt: firebase.firestore.FieldValue.serverTimestamp(), revokedBy: ownerId }, { merge: true });
	      writes += 1;
	    }
	    if (workerUid) {
	      batch.set(memberRef(ownerId, workerUid), { status: 'revoked', revokedAt: firebase.firestore.FieldValue.serverTimestamp(), revokedBy: ownerId }, { merge: true });
	      batch.set(db.collection('approvedUsers').doc(workerUid), { status: 'revoked', approved: false, revokedAt: firebase.firestore.FieldValue.serverTimestamp(), revokedBy: ownerId }, { merge: true });
	      writes += 2;
	      if (inviteData?.businessUnitId && (await currentOwnerWorkersEnabled(ownerId))) {
	        const boundary = window.CLICK360_WORKER_DATA_BOUNDARY;
	        const unitRoot = db.collection('businesses').doc(ownerId).collection('businessUnits').doc(inviteData.businessUnitId);
	        const unitMember = unitRoot.collection('members').doc(workerUid);
	        const current = await unitMember.get({ source:'server' });
	        if (current.exists && current.data()?.status !== 'revoked') {
	          batch.update(unitMember, {
	            status:'revoked', recordVersion:Number(current.data()?.recordVersion || 1) + 1,
	            updatedAt:firebase.firestore.FieldValue.serverTimestamp(), updatedBy:ownerId,
	            revokedAt:firebase.firestore.FieldValue.serverTimestamp(), revokedBy:ownerId
	          });
	          writes += 1;
	          // P0 commercial rule: revoking a worker frees its seat. This is the
	          // only client path that decrements the counter, and Firestore
	          // rules independently re-verify that this exact worker's doc
	          // transitioned active -> revoked in this same batch before
	          // accepting the decrement (see seatReleased in firestore.rules).
	          const seatRef = unitRoot.collection('entitlement').doc('seats');
	          const seatSnapshot = await seatRef.get({ source:'server' });
	          if (seatSnapshot.exists) {
	            const seatPlan = boundary.planSeatRelease(seatSnapshot.data(), boundary.identity(ownerId, inviteData.businessUnitId), workerUid);
	            batch.update(seatRef, {
	              activeMembers:seatPlan.activeMembers, lastActionUid:seatPlan.lastActionUid,
	              updatedBy:ownerId, updatedAt:firebase.firestore.FieldValue.serverTimestamp()
	            });
	            writes += 1;
	          }
	        }
	      }
	    }
	    if (!writes) throw new Error('No se encontro una invitacion ni una cuenta para revocar.');
	    await batch.commit();
	    return true;
	  };

	  // r37 (worker invite flow, Section 11-16): a worker who just accepted
	  // their invite calls this AFTER completing their profile, before ever
	  // seeing the real restricted UI. This does NOT grant any additional
	  // server-side data access (the acceptance transaction already did that,
	  // scoped to whatever permissions the owner chose) -- it is purely the
	  // human "the owner gets to review who's actually behind this account"
	  // checkpoint the client enforces before rendering anything.
	  window.click360RequestWorkerAccess = async function(profile = {}) {
	    const user = auth.currentUser;
	    if (!user || !ACTIVE_CONTEXT) throw new Error('Sesion no verificada.');
	    const ownerId = String(profile.ownerId || ACTIVE_CONTEXT.ownerUid || '').trim();
	    if (!ownerId) throw new Error('Falta el negocio de la invitación.');
	    const requestId = `${ownerId}_${user.uid}`;
	    const ref = db.collection('workerAccessRequests').doc(requestId);
	    const existing = await ref.get();
	    if (existing.exists) return { requestId, status: existing.data()?.status || 'pending' };
	    await ref.set({
	      requestId,
	      ownerId,
	      uid: user.uid,
	      email: String(user.email || '').trim().toLowerCase(),
	      name: String(profile.name || user.displayName || '').slice(0, 120),
	      phone: String(profile.phone || '').slice(0, 30),
	      businessUnitId: String(profile.businessUnitId || ''),
	      status: 'pending',
	      requestedAt: firebase.firestore.FieldValue.serverTimestamp(),
	      decidedAt: null,
	      decidedBy: ''
	    });
	    recordTelemetry('worker_access_requested', { requestId }).catch(() => {});
	    return { requestId, status: 'pending' };
	  };

	  window.click360GetWorkerAccessRequestStatus = async function() {
	    const user = auth.currentUser;
	    if (!user || !ACTIVE_CONTEXT) return null;
	    const ownerId = String(ACTIVE_CONTEXT.ownerUid || '').trim();
	    if (!ownerId || ownerId === user.uid) return null; // owners never have an access request
	    const requestId = `${ownerId}_${user.uid}`;
	    const snap = await db.collection('workerAccessRequests').doc(requestId).get({ source: 'server' }).catch(() => null);
	    return snap?.exists ? { requestId, ...snap.data() } : null;
	  };

	  window.click360ListWorkerAccessRequests = async function() {
	    if (!window.click360User || window.click360User.role !== 'owner') throw new Error('No tienes permisos.');
	    const ownerId = window.click360User.uid;
	    const snap = await db.collection('workerAccessRequests').where('ownerId', '==', ownerId).where('status', '==', 'pending').limit(30).get();
	    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
	  };

	  window.click360ApproveWorkerAccess = async function(requestId) {
	    if (!window.click360User || window.click360User.role !== 'owner') throw new Error('No tienes permisos.');
	    const ownerId = window.click360User.uid;
	    const ref = db.collection('workerAccessRequests').doc(String(requestId || ''));
	    const snap = await ref.get({ source: 'server' });
	    if (!snap.exists || snap.data()?.ownerId !== ownerId) throw new Error('Solicitud no encontrada.');
	    await ref.update({ status: 'approved', decidedAt: firebase.firestore.FieldValue.serverTimestamp(), decidedBy: ownerId });
	    recordTelemetry('worker_access_approved', { requestId }).catch(() => {});
	    return true;
	  };

	  window.click360RejectWorkerAccess = async function(requestId) {
	    if (!window.click360User || window.click360User.role !== 'owner') throw new Error('No tienes permisos.');
	    const ownerId = window.click360User.uid;
	    const ref = db.collection('workerAccessRequests').doc(String(requestId || ''));
	    const snap = await ref.get({ source: 'server' });
	    if (!snap.exists || snap.data()?.ownerId !== ownerId) throw new Error('Solicitud no encontrada.');
	    const request = snap.data();
	    await ref.update({ status: 'rejected', decidedAt: firebase.firestore.FieldValue.serverTimestamp(), decidedBy: ownerId });
	    // Rejecting an access request also revokes the underlying membership --
	    // an owner who rejects the human review must not leave a technically-
	    // active (if UI-gated) account behind.
	    await window.click360RevokeWorker(request.email, request.uid, '').catch(() => {});
	    recordTelemetry('worker_access_rejected', { requestId }).catch(() => {});
	    return true;
	  };

	  // P0 commercial rule: every business includes 2 free worker seats; this
	  // lets the owner change the purchased add-on seat quota for one modular
	  // business. No price is enforced or computed here by design -- that stays
	  // a separate business/billing decision made before calling this function;
	  // this only ever changes the quota number itself.
	  window.click360SetWorkerSeatAddOn = async function(businessUnitId, addOnSeats) {
	    if (!window.click360User || window.click360User.role !== 'owner') throw new Error('No tienes permisos.');
	    const ownerId = window.click360User.uid;
	    if (!(await currentOwnerWorkersEnabled(ownerId))) throw new Error('La frontera modular no esta habilitada para este proyecto.');
	    const safeBusinessId = String(businessUnitId || '').trim();
	    const nextAddOnSeats = Number(addOnSeats);
	    if (!safeBusinessId) throw new Error('Selecciona el negocio modular.');
	    if (!Number.isInteger(nextAddOnSeats) || nextAddOnSeats < 0) throw new Error('El numero de cupos adicionales no es valido.');
	    const seatRef = db.collection('businesses').doc(ownerId).collection('businessUnits').doc(safeBusinessId).collection('entitlement').doc('seats');
	    await seatRef.update({ addOnSeats:nextAddOnSeats, updatedBy:ownerId, updatedAt:firebase.firestore.FieldValue.serverTimestamp() });
	    return true;
	  };

	  // Read-only seat status for the owner's "Trabajadores adicionales" screen:
	  // included seats, seats in use, seats available, and whether the owner is
	  // already at capacity. Returns null if the tenant has no entitlement doc
	  // yet (Workers not migrated/enabled for this business).
	  window.click360GetWorkerSeatStatus = async function(businessUnitId) {
	    if (!window.click360User?.isOwner) return null;
	    const ownerId = window.click360User.uid;
	    const safeBusinessId = String(businessUnitId || '').trim();
	    if (!safeBusinessId) return null;
	    const seatSnapshot = await db.collection('businesses').doc(ownerId).collection('businessUnits')
	      .doc(safeBusinessId).collection('entitlement').doc('seats').get({ source:'server' }).catch(() => null);
	    if (!seatSnapshot || !seatSnapshot.exists) return null;
	    const data = seatSnapshot.data() || {};
	    const boundary = window.CLICK360_WORKER_DATA_BOUNDARY;
	    const capacity = boundary?.seatCapacity?.(data) ?? (Number(data.baseSeatCap || 0) + Number(data.addOnSeats || 0));
	    const used = Number(data.activeMembers || 0);
	    return {
	      baseSeatCap:Number(data.baseSeatCap || 0), addOnSeats:Number(data.addOnSeats || 0),
	      capacity, used, available:Math.max(0, capacity - used), atCapacity:used >= capacity
	    };
	  };

	  // Owner-initiated request for additional seats. Does NOT change the seat
	  // count itself (no billing automation exists yet) -- it only logs an
	  // immutable, owner-scoped request that AIIA (or a trusted operator)
	  // reviews and fulfills manually via:
	  //   node scripts/worker-boundary-admin.mjs --action set-addon-seats ...
	  window.click360RequestAdditionalSeats = async function(businessUnitId, note = '') {
	    if (!window.click360User || window.click360User.role !== 'owner') throw new Error('No tienes permisos.');
	    const ownerId = window.click360User.uid;
	    const safeBusinessId = String(businessUnitId || '').trim();
	    if (!safeBusinessId) throw new Error('Selecciona el negocio modular.');
	    const requestRef = db.collection('businesses').doc(ownerId).collection('seatRequests').doc();
	    await requestRef.set({
	      ownerUid:ownerId, businessId:safeBusinessId, requestedBy:ownerId,
	      note:String(note || '').slice(0, 300), status:'pending',
	      requestedAt:firebase.firestore.FieldValue.serverTimestamp()
	    });
	    recordTelemetry('seat_request', { requestId:requestRef.id, businessId:safeBusinessId }).catch(() => {});
	    return { requestId:requestRef.id };
	  };

	  // Commercial MVP: owner-initiated request for more products/storage
	  // capacity, mirroring click360RequestAdditionalSeats' pattern exactly --
	  // does not change any quota itself (no billing automation exists), just
	  // logs an immutable, owner-scoped, auditable record for AIIA to review
	  // and fulfill manually.
	  window.click360RequestCapacity = async function(kind, note = '') {
	    if (!window.click360User || window.click360User.isOwner !== true) throw new Error('No tienes permisos.');
	    const ownerId = window.click360User.uid;
	    const safeKind = String(kind || '').trim();
	    if (!['products', 'storage'].includes(safeKind)) throw new Error('Tipo de capacidad invalido.');
	    const requestRef = db.collection('businesses').doc(ownerId).collection('capacityRequests').doc();
	    await requestRef.set({
	      ownerUid: ownerId, kind: safeKind, requestedBy: ownerId,
	      plan: window.CLICK360_V16_DOMAIN?.normalizePlan?.(window.click360AccessState?.plan) || '',
	      note: String(note || '').slice(0, 300), status: 'pending',
	      requestedAt: firebase.firestore.FieldValue.serverTimestamp()
	    });
	    recordTelemetry('capacity_request', { requestId: requestRef.id, kind: safeKind }).catch(() => {});
	    return { requestId: requestRef.id };
	  };

	  // r36: CEO Admin Web. The real security boundary is firestore.rules'
	  // isPlatformAdmin() (a single hardcoded, human-verified email) -- every
	  // read/write below will simply be denied server-side for anyone else,
	  // regardless of what this client-side code does or doesn't check. This
	  // constant only gates whether the UI renders the admin nav entry.
	  const CEO_ADMIN_EMAIL = 'roddysmithceo@gmail.com';
	  window.click360IsPlatformAdmin = function() {
	    const email = String(window.click360User?.email || window.click360Auth?.currentUser?.email || '').trim().toLowerCase();
	    return email === CEO_ADMIN_EMAIL;
	  };

	  // Reads only -- no getUserByEmail()/getUser() exists in the browser
	  // Auth SDK (Admin-only capability), so this can only ever find a
	  // customer who has already signed in with Google at least once
	  // (i.e. already has an accountAccess document). A brand-new lead with
	  // no account yet is reported as such, matching the CLI's identical
	  // precondition (see scripts/onboard-new-customer.mjs).
	  window.click360CeoAdminSearchCustomer = async function(email) {
	    const safeEmail = String(email || '').trim().toLowerCase();
	    if (!safeEmail) throw new Error('Ingresa un correo.');
	    const snap = await db.collection('accountAccess').where('email', '==', safeEmail).limit(1).get();
	    if (snap.empty) return { found: false, email: safeEmail };
	    const accessDoc = snap.docs[0];
	    const uid = accessDoc.id;
	    const [stateSnap, flagSnap, businessUnitSnap, seatReqSnap, capReqSnap, auditSnap, legalGraceSnap, legalAcceptanceSnap, customerHealthSnap] = await Promise.all([
	      db.collection('businesses').doc(uid).collection('state').doc('main').get().catch(() => null),
	      db.collection('businesses').doc(uid).collection('featureFlags').doc('workers').get().catch(() => null),
	      db.collection('businesses').doc(uid).collection('businessUnits').doc('biz_main').get().catch(() => null),
	      db.collection('businesses').doc(uid).collection('seatRequests').limit(20).get().catch(() => null),
	      db.collection('businesses').doc(uid).collection('capacityRequests').limit(20).get().catch(() => null),
	      db.collection('adminAuditLogs').where('uid', '==', uid).limit(30).get().catch(() => null),
	      db.collection('legalGraceStatus').doc(uid).get().catch(() => null),
	      db.collection('legalAcceptances').where('uid', '==', uid).limit(10).get().catch(() => null),
	      db.collection('customerHealth').doc(uid).get().catch(() => null)
	    ]);
	    const stateData = stateSnap?.exists ? stateSnap.data() : null;
	    const businesses = stateData?.payload?.data?.businesses || [];
	    const products = stateData?.payload?.data?.products || [];
	    const storageBytesApprox = products.reduce((sum, product) => sum + (typeof product.imageData === 'string' ? product.imageData.length : 0), 0);
	    // r37 (#93): a cash session left open from a PRIOR day (not today) is a
	    // real operational problem the owner needs to see and close -- same
	    // "prior-day unclosed cash session" signal already surfaced client-side
	    // (see qa/r36-p0-2-reliability-e2e.mjs), now also visible remotely.
	    const cashSessions = stateData?.payload?.data?.cashSessions || [];
	    const todayKey = new Date().toISOString().slice(0, 10);
	    const pendingCashClose = cashSessions.some((session) => session?.status === 'open' && session?.date && session.date < todayKey);
	    const sortByTimestampFieldDesc = (docs, field) => docs
	      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
	      .sort((a, b) => (b[field]?.toMillis?.() || 0) - (a[field]?.toMillis?.() || 0));
	    const legalGraceData = legalGraceSnap?.exists ? legalGraceSnap.data() : null;
	    const legalAcceptanceDocs = legalAcceptanceSnap ? sortByTimestampFieldDesc(legalAcceptanceSnap.docs, 'acceptedAt') : [];
	    const currentTermsVersion = window.CLICK360_V16_DOMAIN?.TERMS_VERSION || '';
	    const currentPrivacyVersion = window.CLICK360_V16_DOMAIN?.PRIVACY_VERSION || currentTermsVersion;
	    const latestAcceptance = legalAcceptanceDocs[0] || null;
	    const hasCurrentAcceptance = !!latestAcceptance
	      && latestAcceptance.termsVersion === currentTermsVersion
	      && (latestAcceptance.privacyVersion || latestAcceptance.termsVersion) === currentPrivacyVersion;
	    const hasOnboarded = !!stateData?.payload?.data?.settings?.onboarding?.completedAt;
	    const presentedAtMs = legalGraceData?.termsPresentedAt?.toMillis?.() || 0;
	    const graceExpiresAtMs = presentedAtMs ? presentedAtMs + (7 * 24 * 60 * 60 * 1000) : 0;
	    let legalStatus = 'vigente';
	    if (!hasCurrentAcceptance) {
	      if (!hasOnboarded) legalStatus = 'pendiente'; // new owner, hard-gated by the app itself
	      else if (!presentedAtMs) legalStatus = 'pendiente'; // legacy, banner not shown yet
	      else if (Date.now() < graceExpiresAtMs) legalStatus = 'grace';
	      else legalStatus = 'requiere_aceptacion';
	    }
	    return {
	      found: true,
	      uid,
	      accountAccess: { id: uid, ...accessDoc.data() },
	      businesses: businesses.map((business) => ({ id: business.id, name: business.name, type: business.type })),
	      usage: { productsActive: products.length, storageBytesApprox },
	      featureFlags: flagSnap?.exists ? flagSnap.data() : null,
	      businessUnit: businessUnitSnap?.exists ? businessUnitSnap.data() : null,
	      seatRequests: seatReqSnap ? sortByTimestampFieldDesc(seatReqSnap.docs, 'requestedAt').slice(0, 10) : [],
	      capacityRequests: capReqSnap ? sortByTimestampFieldDesc(capReqSnap.docs, 'requestedAt').slice(0, 10) : [],
	      auditLog: auditSnap ? sortByTimestampFieldDesc(auditSnap.docs, 'createdAt').slice(0, 10) : [],
	      legal: {
	        status: legalStatus,
	        currentTermsVersion,
	        currentPrivacyVersion,
	        latestAcceptedVersion: latestAcceptance?.termsVersion || null,
	        latestAcceptedAt: latestAcceptance?.acceptedAt?.toDate?.()?.toISOString?.() || null,
	        termsPresentedAt: legalGraceData?.termsPresentedAt?.toDate?.()?.toISOString?.() || null,
	        graceExpiresAt: graceExpiresAtMs ? new Date(graceExpiresAtMs).toISOString() : null
	      },
	      health: customerHealthSnap?.exists ? {
	        ...customerHealthSnap.data(),
	        updatedAt: customerHealthSnap.data()?.updatedAt?.toDate?.()?.toISOString?.() || null
	      } : null,
	      pendingCashClose
	    };
	  };

	  // r37 (#93): a lightweight, best-effort health beacon the customer's OWN
	  // device writes about itself (never about another tenant -- enforced by
	  // firestore.rules requiring request.auth.uid == the doc id) so CEO Admin
	  // can see real device health WITHOUT ever hand-editing Firestore. This is
	  // diagnostic-only: never gates the customer's own app, and a failed
	  // write here must never surface an error to the customer (best-effort).
	  window.click360PublishCustomerHealth = function(snapshot = {}) {
	    if (!ACTIVE_CONTEXT?.authUid) return;
	    const uid = ACTIVE_CONTEXT.authUid;
	    db.collection('customerHealth').doc(uid).set({
	      ...snapshot,
	      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
	    }, { merge: true }).catch(() => {});
	  };

	  function assertCeoAdmin() {
	    if (!window.click360IsPlatformAdmin()) throw new Error('No autorizado.');
	  }

	  // Builds the exact fields activation would write, WITHOUT writing
	  // anything -- the preview the panel must show before any commit.
	  window.click360CeoAdminPreviewActivation = async function({ uid, plan, period, businessType = '', addOns = [] }) {
	    assertCeoAdmin();
	    const ref = db.collection('accountAccess').doc(uid);
	    const snap = await ref.get();
	    if (!snap.exists) throw new Error('Esta cuenta todavia no existe (el cliente debe iniciar sesion con Google al menos una vez).');
	    const existing = snap.data();
	    const targetUser = { uid, email: existing.email, name: existing.name, photoURL: existing.photoURL };
	    const proposed = window.CLICK360_V16_DOMAIN.activationFields({
	      existing, targetUser, actorEmail: window.click360User?.email || CEO_ADMIN_EMAIL, plan, period, businessType, addOnsRequested: addOns
	    });
	    return { proposed, beforeRevision: Number(existing.revision || 0), existing };
	  };

	  // Backup -> transaction (hash-equivalent guard via strict revision
	  // equality, re-checked inside the transaction against a fresh read,
	  // which Firestore's own snapshot isolation makes atomic) -> audit log
	  // -> post-write verification. Mirrors admin-access-v16.mjs's pipeline.
	  window.click360CeoAdminApplyActivation = async function({ uid, plan, period, businessType = '', addOns = [], expectedRevision }) {
	    assertCeoAdmin();
	    const actorEmail = window.click360User?.email || CEO_ADMIN_EMAIL;
	    const ref = db.collection('accountAccess').doc(uid);
	    const beforeSnap = await ref.get();
	    if (!beforeSnap.exists) throw new Error('Esta cuenta ya no existe.');
	    const beforeData = beforeSnap.data();
	    if (Number(beforeData.revision || 0) !== Number(expectedRevision)) {
	      throw new Error('La cuenta cambio desde la vista previa. Vuelve a buscar al cliente e intenta de nuevo.');
	    }
	    const backupRef = db.collection('adminBackups').doc();
	    await backupRef.set({
	      action: 'ceo_admin_web_activation', targetPath: ref.path, uid, actorEmail,
	      beforeRevision: beforeData.revision || 0, beforeAccess: beforeData,
	      createdAt: firebase.firestore.FieldValue.serverTimestamp()
	    });
	    const auditRef = db.collection('adminAuditLogs').doc();
	    const proposed = await db.runTransaction(async (tx) => {
	      const freshSnap = await tx.get(ref);
	      if (!freshSnap.exists) throw new Error('Esta cuenta ya no existe.');
	      const freshData = freshSnap.data();
	      if (Number(freshData.revision || 0) !== Number(expectedRevision)) {
	        throw new Error('La cuenta cambio justo antes de guardar. Vuelve a buscar al cliente e intenta de nuevo.');
	      }
	      const targetUser = { uid, email: freshData.email, name: freshData.name, photoURL: freshData.photoURL };
	      const fields = window.CLICK360_V16_DOMAIN.activationFields({
	        existing: freshData, targetUser, actorEmail, plan, period, businessType, addOnsRequested: addOns
	      });
	      tx.set(ref, {
	        ...fields,
	        activatedAt: firebase.firestore.FieldValue.serverTimestamp(),
	        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
	      }, { merge: true });
	      tx.set(auditRef, {
	        action: 'ceo_admin_web_activation', targetPath: ref.path, uid, actorEmail,
	        backupPath: backupRef.path, beforeRevision: freshData.revision || 0, afterRevision: fields.revision,
	        plan: fields.plan, status: fields.status,
	        createdAt: firebase.firestore.FieldValue.serverTimestamp()
	      });
	      return fields;
	    });
	    const afterSnap = await ref.get();
	    const afterData = afterSnap.data();
	    if (afterData.revision !== proposed.revision || afterData.plan !== proposed.plan) {
	      throw new Error('La activacion no se pudo verificar despues de guardar. Revisa adminAuditLogs.');
	    }
	    return { after: afterData, backupPath: backupRef.path, auditPath: auditRef.path };
	  };

	  window.click360CeoAdminSuspend = async function(uid) {
	    assertCeoAdmin();
	    const actorEmail = window.click360User?.email || CEO_ADMIN_EMAIL;
	    const ref = db.collection('accountAccess').doc(uid);
	    const beforeSnap = await ref.get();
	    if (!beforeSnap.exists) throw new Error('Esta cuenta ya no existe.');
	    const beforeData = beforeSnap.data();
	    const backupRef = db.collection('adminBackups').doc();
	    await backupRef.set({
	      action: 'ceo_admin_web_suspend', targetPath: ref.path, uid, actorEmail,
	      beforeRevision: beforeData.revision || 0, beforeAccess: beforeData,
	      createdAt: firebase.firestore.FieldValue.serverTimestamp()
	    });
	    const auditRef = db.collection('adminAuditLogs').doc();
	    const nextRevision = Number(beforeData.revision || 0) + 1;
	    await db.runTransaction(async (tx) => {
	      const freshSnap = await tx.get(ref);
	      const freshData = freshSnap.data();
	      if (Number(freshData.revision || 0) !== Number(beforeData.revision || 0)) throw new Error('La cuenta cambio; vuelve a intentar.');
	      tx.update(ref, {
	        status: 'suspended', revision: nextRevision, plan: freshData.plan, planCode: freshData.planCode,
	        uid, businessId: uid, suspendedAt: firebase.firestore.FieldValue.serverTimestamp(), suspendedBy: actorEmail
	      });
	      tx.set(auditRef, {
	        action: 'ceo_admin_web_suspend', targetPath: ref.path, uid, actorEmail,
	        backupPath: backupRef.path, beforeRevision: beforeData.revision || 0, afterRevision: nextRevision,
	        createdAt: firebase.firestore.FieldValue.serverTimestamp()
	      });
	    });
	    return { status: 'suspended', revision: nextRevision };
	  };

	  window.click360CeoAdminToggleWorkers = async function(uid, enabled) {
	    assertCeoAdmin();
	    const actorEmail = window.click360User?.email || CEO_ADMIN_EMAIL;
	    const flagRef = db.collection('businesses').doc(uid).collection('featureFlags').doc('workers');
	    await flagRef.update({
	      enabled: !!enabled,
	      enabledAt: enabled ? firebase.firestore.FieldValue.serverTimestamp() : null,
	      enabledBy: enabled ? actorEmail : null,
	      updatedBy: actorEmail,
	      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
	    });
	    const auditRef = db.collection('adminAuditLogs').doc();
	    await auditRef.set({
	      action: enabled ? 'ceo_admin_web_workers_enabled' : 'ceo_admin_web_workers_disabled',
	      targetPath: flagRef.path, uid, actorEmail, createdAt: firebase.firestore.FieldValue.serverTimestamp()
	    });
	    return { enabled: !!enabled };
	  };

	  function syncError(code, message, details = {}) {
	    const error = new Error(message);
	    error.code = code;
	    error.details = details;
	    return error;
	  }

  // A matching revision is concurrency control, not evidence that this device
  // actually hydrated the tenant. Fail closed even for an explicit keep-local.
  // Run again INSIDE the transaction after the authoritative read, because
  // hydration/context can change while a network request is in flight.
  function tenantMaterialCount(payload, commerceOnly = false) {
    const data = payload?.data || payload || {};
    const groups = ['products', 'sales', 'movements', 'dailyReports', 'invoices',
      'deletedProducts', 'layaways', 'cashSessions', 'tables', 'tableOrders',
      'restaurantPayments', 'restaurantPrintHistory', 'restaurantEvents',
      'restaurantRecipes'];
    const size = value => Array.isArray(value) ? value.length : 0;
    return groups.reduce((sum, key) => sum + size(data[key]), 0)
      + Object.values(data.logistics || {}).reduce((sum, value) => sum + size(value), 0)
      + Object.values(data.finance || {}).reduce((sum, value) => sum + size(value), 0)
      + (commerceOnly ? 0 : ['labelTemplates', 'labelProfiles', 'customers'].reduce((sum, key) => sum + size(data.settings?.[key]), 0));
  }

  function rememberTenantMaterialEvidence(context, payload) {
    if (!context?.tenantKey || tenantMaterialCount(payload, true) === 0) return;
    const key = tenantStorageKeyFor(context, 'REMOTE_MATERIAL_SEEN');
    TENANT_MATERIAL_EVIDENCE.add(key);
    safeStorageSet(key, '1');
  }

  function assertTenantReplacementSafe(payload, remote, context, reason, remoteChecked = false) {
    const identity = payload?.identity;
    const identityConfirmed = !!context?.authUid && !!context?.ownerUid && !!context?.ownerId
      && !!context?.businessId && context.tenantKey === `owner:${context.ownerId}:business:${context.businessId}`
      && activeIdentityIsValid()
      && ['ownerUid', 'ownerId', 'businessId', 'tenantKey'].every(key => identity?.[key] === context[key]);
    const explicitInitial = reason === 'initial_tenant_seed' && INITIAL_TENANT_SEED_REQUIRED === true
      && Number(LAST_REMOTE_REVISION || 0) === 0 && !remote;
    const hydrated = window.click360IsTenantDataHydrated?.() === true;
    const provenance = window.click360GetTenantStateProvenance?.() || 'unknown';
    let blockedReason = !identityConfirmed ? 'identity_unresolved' : '';
    if (!blockedReason && !explicitInitial && (!hydrated || !['remote', 'verified_cache'].includes(provenance))) {
      blockedReason = 'local_state_not_hydrated';
    }
    if (!blockedReason && remoteChecked && !remote && !explicitInitial) blockedReason = 'initial_seed_not_authorized';
    if (!blockedReason && remote) {
      const remotePayload = remote.payload || remote;
      rememberTenantMaterialEvidence(context, remotePayload);
      const remoteData = remotePayload.data || remotePayload;
      const localData = payload.data || payload;
      const coreCount = data => ['products', 'sales', 'movements'].reduce((n, key) => n + (Array.isArray(data[key]) ? data[key].length : 0), 0);
      // A leftover cash session/table is not proof that the catalog and sales
      // hydrated. A legitimate deletion records a movement and a tombstone;
      // a 0/0/0 replacement has neither evidence of that operation.
      const emptiedCoreDomain = ['products', 'sales', 'movements'].find(key =>
        Array.isArray(remoteData[key]) && remoteData[key].length > 0
        && (!Array.isArray(localData[key]) || localData[key].length === 0));
      // Check every irreducible commerce ledger independently. A surviving
      // movement (or any other single array) must not disguise that the
      // catalog or sales ledger vanished during a partial hydration failure.
      if (emptiedCoreDomain || (coreCount(remoteData) > 0 && coreCount(localData) === 0)) {
        blockedReason = 'unexpected_empty_core_replacement';
      }
      if ((tenantMaterialCount(remotePayload, true) > 0 && tenantMaterialCount(payload, true) === 0)
        || (tenantMaterialCount(remotePayload) > 0 && tenantMaterialCount(payload) === 0)) {
        blockedReason = 'unexpected_empty_replacement';
      }
    }
    const materialEvidenceKey = tenantStorageKeyFor(context, 'REMOTE_MATERIAL_SEEN');
    if (!blockedReason && tenantMaterialCount(payload, true) === 0
      && (TENANT_MATERIAL_EVIDENCE.has(materialEvidenceKey) || safeStorageGet(materialEvidenceKey) === '1')) {
      blockedReason = 'previous_material_tenant_now_empty';
    }
    if (blockedReason) {
      throw syncError('click360/unsafe-tenant-replacement',
        'Se protegieron tus datos: esta copia no está lista para reemplazar la nube. Vuelve a cargar los datos verificados; no se borró ninguna versión.',
        { reason: blockedReason });
    }
    return true;
  }

	  async function pushLocalToFirestoreOnce(reason = 'auto', forceWrite = false) {
	    const user = auth.currentUser;
	    const context = ACTIVE_CONTEXT;
	    const stateDoc = STATE_DOC;
	    const expectedEpoch = AUTH_EPOCH;
	    if (legacyMigrationRequired()) {
	      setSyncStatus('migration_required', legacyMigrationMessage());
	      return false;
	    }
		    const syncState = getSyncState({ cleanup: true, reason: `push:${reason}` });
		    if (syncState.status === 'real_conflict') {
		      setSyncStatus('error', 'Hay un conflicto pendiente. Descarga o respalda los datos antes de volver a sincronizar.');
		      return false;
		    }
		    if (!isActiveSyncScope(context, stateDoc, expectedEpoch, user) || !AUTH_APPROVED || isEffectiveReadOnly() || IS_RESTORING_REMOTE || !PULL_COMPLETE || !tenantGuard.canWrite(context)) return false;
	    if (!navigator.onLine) {
	      setSyncStatus('offline', 'Sin internet. Cambios pendientes de subir.');
	      return false;
	    }

	    const payload = buildBusinessPayload();
	    const payloadBytes = window.CLICK360_P0_TENANT_GUARD.utf8Bytes(payload || {});
	    if (!payload || !sameTenant(payload.identity)) {
	      quarantineIncident('blocked_push_identity', { reason });
	      setSyncStatus('error', 'Se bloqueó una escritura porque la identidad o el contenido del tenant no coincide.');
	      return false;
		    }
        try { assertTenantReplacementSafe(payload, null, context, reason); }
        catch (error) {
          setSyncStatus('error', error.message, { reason: error.details?.reason });
          return false;
        }
		    const payloadHash = snapshotString(payload);
		    const materialHash = materialPayloadHash(payload);
		    const lastAppliedHash = safeStorageGet(tenantStorageKeyFor(context, 'LAST_APPLIED_REMOTE_HASH'));
		    if (reason !== 'initial_tenant_seed' && payloadHash === lastAppliedHash && Number(LAST_REMOTE_REVISION || 0) > 0) {
		      LOCAL_WRITE_PENDING_UNTIL = 0;
		      safeStorageSet(tenantStorageKeyFor(context, 'LAST_APPLIED_REMOTE_MATERIAL_HASH'), materialHash);
		      window.click360MarkTenantCacheSynced?.({ revision: LAST_REMOTE_REVISION, payloadHash, materialHash }).catch?.(() => {});
		      setSyncStatus('synced', 'Datos locales y nube coinciden.', { reason: 'already_synced', revision: LAST_REMOTE_REVISION });
		      return true;
		    }
	    if (payloadBytes > MAX_CLOUD_PAYLOAD_BYTES) {
	      setSyncStatus('error', `Los datos ocupan ${Math.ceil(payloadBytes / 1024)} KB y superan el límite seguro de sincronización. Reduce imágenes antes de continuar.`);
	      return false;
	    }

		    const expectedRevision = Number(LAST_REMOTE_REVISION || 0);
		    const documentData = buildV10StateDocument(payload, reason);
		    let existingInitialRemote = null;
		    let equivalentRemoteWithoutWrite = null;
			    setSyncStatus('syncing', 'Guardando cambios en la nube.', { reason });

	    try {
	      const wrote = await window.CLICK360_P0_TENANT_GUARD.guardedWrite(tenantGuard, context, async () => {
	        await db.runTransaction(async (transaction) => {
	          if (!isActiveSyncScope(context, stateDoc, expectedEpoch, user)) throw syncError('click360/stale-auth', 'La cuenta cambió antes de sincronizar.');
	          const current = await transaction.get(stateDoc);
	          if (!isActiveSyncScope(context, stateDoc, expectedEpoch, user)) throw syncError('click360/stale-auth', 'La cuenta cambió durante la sincronización.');
	          if (!current.exists) {
	            if (expectedRevision !== 0) throw syncError('click360/revision-conflict', 'El documento remoto fue reemplazado.', { expectedRevision, remoteRevision: null });
	            assertTenantReplacementSafe(payload, null, context, reason, true);
	          } else {
	            const remote = current.data() || {};
	            const remoteRevision = Number(remote.revision || remote.updatedAtMs || 0);
	            if (!remoteMatchesContext(remote, context)) throw syncError('click360/remote-identity', 'La identidad remota no coincide.', { remoteRevision });
	            if (reason === 'initial_tenant_seed' && expectedRevision === 0) {
	              existingInitialRemote = remote;
	              return;
	            }
                assertTenantReplacementSafe(payload, remote, context, reason, true);
		            if (remoteRevision !== expectedRevision) {
		              const remoteMaterialHash = materialPayloadHash(remote.payload);
		              if (remoteMaterialHash && remoteMaterialHash === materialHash) {
		                equivalentRemoteWithoutWrite = remote;
		                return;
		              }
		              // forceWrite: user explicitly chose "Conservar mi versión local" — skip revision check
		              if (!forceWrite) {
		                throw syncError('click360/revision-conflict', 'Hay cambios remotos sin resolver.', { expectedRevision, remoteRevision });
		              }
		            }
	          }
	          transaction.set(stateDoc, documentData);
	        });
	      });
	      if (!wrote) {
	        setSyncStatus('migration_required', legacyMigrationMessage());
	        return false;
	      }
	      if (!isActiveSyncScope(context, stateDoc, expectedEpoch, user)) return false;
		      if (existingInitialRemote) {
		        const existingRevision = Number(existingInitialRemote.revision || existingInitialRemote.updatedAtMs || 0);
		        applyRemotePayload(existingInitialRemote.payload);
		        LAST_REMOTE_REVISION = existingRevision;
		        rememberAppliedRemotePayload(context, existingInitialRemote.payload, existingRevision, { reason: 'initial_tenant_existing' });
		        LOCAL_WRITE_PENDING_UNTIL = 0;
			        setSyncStatus('synced', 'El negocio ya existia y fue cargado sin sobrescribirlo.', { reason: 'initial_tenant_existing', revision: existingRevision });
			        return true;
			      }
			      if (equivalentRemoteWithoutWrite) {
			        const equivalentRevision = Number(equivalentRemoteWithoutWrite.revision || equivalentRemoteWithoutWrite.updatedAtMs || 0);
			        LAST_REMOTE_REVISION = equivalentRevision;
			        safeStorageSet(tenantStorageKeyFor(context, 'REMOTE_REVISION'), String(equivalentRevision));
			        safeStorageSet(tenantStorageKeyFor(context, 'LAST_APPLIED_REMOTE_MATERIAL_HASH'), materialHash);
			        window.click360MarkTenantCacheSynced?.({ revision: equivalentRevision, payloadHash, materialHash, operationId: 'remote_material_equivalent' }).catch?.(() => {});
			        clearSyncConflict();
			        LOCAL_WRITE_PENDING_UNTIL = 0;
			        setSyncStatus('synced', 'La nube ya contiene los mismos datos comerciales.', { reason: 'remote_material_equivalent', revision: equivalentRevision });
			        return true;
			      }
			      LAST_REMOTE_REVISION = documentData.revision;
          // Initial seed is not a hydrated tenant until its guarded cloud
          // creation commits. Mark it real only now so onboarding can proceed.
          if (reason === 'initial_tenant_seed') applyRemotePayload(payload);
		      rememberAppliedRemotePayload(context, payload, documentData.revision, { reason });
			      LOCAL_WRITE_PENDING_UNTIL = 0;
		      setSyncStatus('synced', 'Datos guardados en la nube.', { reason, revision: documentData.revision, payloadBytes });
		      if (reason === 'initial_tenant_seed' || reason === 'manual' || reason === 'online_reconnect') {
		        recordTelemetryOnce(`sync:${AUTH_EPOCH}:${context.tenantKey}:${reason}:${documentData.revision}`, 'sync', { mode: reason });
		      }
		      return true;
	    } catch (error) {
	      if (error.code === 'click360/stale-auth') return false;
	      if (error.code === 'click360/revision-conflict' || error.code === 'click360/remote-identity') {
	        markSyncConflict({ reason, ...error.details, localRevision: expectedRevision });
	        setSyncStatus('error', 'Se detectaron cambios simultáneos. Tus cambios locales siguen protegidos y no se sobrescribió la nube.');
	        return false;
	      }
	      console.warn('CLICK360 no pudo sincronizar:', error.message);
	      setSyncStatus('error', error.message || 'No se pudo sincronizar.');
	      return false;
	    }
	  }

	  async function pushLocalToFirestore(reason = 'auto', forceWrite = false) {
	    const context = ACTIVE_CONTEXT;
	    const schedulerKey = context ? `${AUTH_EPOCH}:${context.authUid}:${context.tenantKey}` : '';
	    if (!schedulerKey) return false;
	    // forceWrite bypasses the scheduler to avoid revision conflicts on keep_local
	    if (forceWrite) return pushLocalToFirestoreOnce(reason, true);
	    const existing = PUSH_SCHEDULERS.get(schedulerKey);
	    if (existing) {
	      existing.queuedReason = reason;
	      return existing.promise;
	    }
	    const scheduler = { queuedReason: null, promise: null };
	    scheduler.promise = (async () => {
	      let nextReason = reason;
	      let result = false;
	      while (nextReason) {
	        scheduler.queuedReason = null;
	        result = await pushLocalToFirestoreOnce(nextReason);
	        nextReason = result ? scheduler.queuedReason : null;
	      }
	      return result;
	    })().finally(() => {
	      // Keep cleanup in the scheduler promise itself. A caller must never
	      // observe a fulfilled promise that is still registered and mistake
	      // an older successful push for confirmation of its newer mutation.
	      if (PUSH_SCHEDULERS.get(schedulerKey) === scheduler) PUSH_SCHEDULERS.delete(schedulerKey);
	    });
	    PUSH_SCHEDULERS.set(schedulerKey, scheduler);
	    return scheduler.promise;
	  }

  async function readAuthoritativeTenantSnapshot(stateDoc) {
    let snap = await stateDoc.get({ source: 'server' });
    const stale = snapshot => snapshot.metadata?.fromCache === true || snapshot.metadata?.hasPendingWrites === true
      || (snapshot.exists && Number(snapshot.data()?.revision || snapshot.data()?.updatedAtMs || 0) < Number(LAST_REMOTE_REVISION || 0));
    // A server-source listen read can still expose an older SDK view directly
    // after a transaction in WebKit. Re-read via the transaction RPC (no writes)
    // instead of applying that view over the revision we just committed.
    if (stale(snap)) snap = await db.runTransaction(transaction => transaction.get(stateDoc));
    if (stale(snap)) throw syncError('click360/stale-server-read', 'La lectura aún no confirma la última revisión. Tus datos actuales se conservaron; vuelve a intentar la sincronización.');
    return snap;
  }
		  async function pullRemoteOnce({ force = false, reload = false } = {}) {
	    const user = auth.currentUser;
	    const context = ACTIVE_CONTEXT;
	    const stateDoc = STATE_DOC;
	    const expectedEpoch = AUTH_EPOCH;
	  try {
	    if (!isActiveSyncScope(context, stateDoc, expectedEpoch, user)) return false;
		    const initiallyDeferred = window.click360IsTenantStateDeferred?.() === true;
		    let localCacheStatus = window.click360GetTenantCacheStatus?.(context) || { valid: false, reason: 'cache_status_unavailable' };
		    const localStorageUnavailable = window.click360GetStorageState?.().localReady === false;
		    if (navigator.onLine && ((!localCacheStatus.valid
          && ['cache_missing', 'localstorage_unavailable'].includes(localCacheStatus.reason)) || localStorageUnavailable)
          && typeof window.click360LoadIndexedTenantCache === 'function') {
          await window.click360LoadIndexedTenantCache(context);
          localCacheStatus = window.click360GetTenantCacheStatus?.(context) || localCacheStatus;
        }
        if (navigator.onLine && initiallyDeferred && localCacheStatus.valid
          && localCacheStatus.pendingRemoteSync === true && localCacheStatus.source === 'localstorage') {
          window.click360LoadDeferredTenantCache?.();
          localCacheStatus = window.click360GetTenantCacheStatus?.(context) || localCacheStatus;
        }
		    if (!navigator.onLine && !force) {
		        if (!verifiedOfflineTenantCache() && typeof window.click360LoadIndexedTenantCache === 'function') {
		          await window.click360LoadIndexedTenantCache(context);
		          localCacheStatus = window.click360GetTenantCacheStatus?.(context) || localCacheStatus;
		        }
	        if (!verifiedOfflineTenantCache()) {
	          tenantGuard.block();
	          PULL_COMPLETE = false;
	          setSyncStatus('blocked_identity', 'Sin internet y no existe una caché propia, válida y aprobada para esta cuenta.');
	          return false;
	        }
	        window.click360LoadDeferredTenantCache?.();
	        tenantGuard.allow(context);
	        PULL_COMPLETE = true;
	        setSyncStatus('offline', 'Sin internet. Usando la última caché verificada de esta cuenta.');
	        return false;
	      }
	      setSyncStatus('syncing', 'Comprobando los datos guardados.');
	      const snap = await readAuthoritativeTenantSnapshot(stateDoc);
	      if (!isActiveSyncScope(context, stateDoc, expectedEpoch, user)) return false;
		    if (!snap.exists) {
		      // A new entitled tenant can start without localStorage. Before doing so,
		      // check IndexedDB as well: any real or suspicious cache must be reviewed
		      // instead of being hidden behind an empty cloud seed.
		      if (!localCacheStatus.valid && typeof window.click360LoadIndexedTenantCache === 'function') {
		        await window.click360LoadIndexedTenantCache(context);
		        localCacheStatus = window.click360GetTenantCacheStatus?.(context) || localCacheStatus;
		      }
		      const onlineOnlyEmptyDevice = navigator.onLine
		        && ONLINE_ONLY_SAFE
		        && ['cache_missing', 'localstorage_unavailable'].includes(localCacheStatus.reason);
		      const cleanEmptyDevice = localCacheStatus.reason === 'cache_missing';
		      if (!cleanEmptyDevice && !onlineOnlyEmptyDevice) {
		        INITIAL_TENANT_SEED_REQUIRED = false;
		        tenantGuard.block();
		        PULL_COMPLETE = false;
	        quarantineIncident('remote_missing_with_existing_cache', { path: stateDoc.path, cacheReason: localCacheStatus.reason });
		        setSyncStatus('error', 'El documento remoto no existe, pero este dispositivo conserva datos o una caché dañada. Se bloqueó la creación automática para evitar pérdida de información.');
		        return false;
		      }
	      LAST_REMOTE_REVISION = 0;
	        safeStorageSet(tenantStorageKey('REMOTE_REVISION'), '0');
	        tenantGuard.allow(context);
	        PULL_COMPLETE = true;
	        INITIAL_TENANT_SEED_REQUIRED = true;
		        setSyncStatus(onlineOnlyEmptyDevice ? 'online_only_safe' : 'pending', onlineOnlyEmptyDevice
		          ? 'Tenant nuevo verificado. Se creará directamente en la nube porque este dispositivo no admite almacenamiento local.'
		          : 'Tenant nuevo listo. La primera sincronización se hará al desbloquear la cuenta.');
		        return false;
		      }

	      const remoteData = snap.data() || {};
	      if (remoteData.schemaVersion !== SCHEMA_VERSION) {
	        INITIAL_TENANT_SEED_REQUIRED = false;
	        tenantGuard.requireLegacy(context, { document: remoteData, path: stateDoc.path });
	        safeStorageSet(legacyMigrationMarkerKey(), '1');
	        quarantineLegacyLocalState();
	        quarantineIncident('legacy_remote_state', {
	          path: stateDoc.path,
	          remoteMetadata: { businessId: remoteData.businessId || null, updatedBy: remoteData.updatedBy || null, updatedByEmail: remoteData.updatedByEmail || null, revision: remoteData.revision || null }
	        });
	        PULL_COMPLETE = false;
	        setSyncStatus('migration_required', legacyMigrationMessage());
	        return false;
	      }
	      if (!remoteMatchesContext(remoteData, context)) {
	        INITIAL_TENANT_SEED_REQUIRED = false;
	        tenantGuard.block();
	        safeStorageSet(tenantCorruptMarkerKey(), '1');
	        quarantineIncident('blocked_pull_identity', { path: stateDoc.path, remoteIdentity: { ownerUid: remoteData.ownerUid, ownerId: remoteData.ownerId, businessId: remoteData.businessId, tenantKey: remoteData.tenantKey } });
	        PULL_COMPLETE = false;
	        setSyncStatus('error', 'Se bloqueó una descarga con identidad o contenido inválido. Tus datos locales siguen intactos.');
	        return false;
	      }
	      const reconciliation = reconcileLocalStateWithRemoteV10(remoteData, context);
          rememberTenantMaterialEvidence(context, remoteData.payload);
	      if (!reconciliation.reconciled) {
	        tenantGuard.block();
	        PULL_COMPLETE = false;
	        setSyncStatus('error', 'No se pudo reconciliar de forma segura el tenant V10.');
	        return false;
	      }
	      localCacheStatus = window.click360GetTenantCacheStatus?.(context) || localCacheStatus;

		      const remotePayload = remoteData.payload;
		      const remoteRevision = Number(remoteData.revision || remoteData.updatedAtMs || 0);
		      const remoteHash = snapshotString(remotePayload);
		      const remoteMaterialHash = materialPayloadHash(remotePayload);
		    const localPayload = buildBusinessPayload();
		    const localHash = snapshotString(localPayload);
		    const localMaterialHash = materialPayloadHash(localPayload);
		    const alreadyApplied = safeStorageGet(tenantStorageKey('LAST_APPLIED_REMOTE_HASH'));
		    const alreadyAppliedMaterial = safeStorageGet(tenantStorageKey('LAST_APPLIED_REMOTE_MATERIAL_HASH'));
	      const indexedMeta = window.click360GetIndexedTenantCacheMeta?.() || {};
	      const recoveryMeta = localCacheStatus.pendingRemoteSync === true ? localCacheStatus : indexedMeta;
	      const pendingLocalRecovery = localCacheStatus.valid === true && recoveryMeta.pendingRemoteSync === true;
	    const remoteMustHydrate = initiallyDeferred && !pendingLocalRecovery;
    // A deferred context has not loaded any tenant cache yet. The verified V10
    // remote snapshot is authoritative in that first hydration, even if an old
    // device cache has stale pending metadata. Otherwise a seed could render
    // while the actual remote data remained protected but unapplied.
	    const localChanged = !remoteMustHydrate && localCacheStatus.valid === true && (
		      (Date.now() < LOCAL_WRITE_PENDING_UNTIL && localMaterialHash !== remoteMaterialHash)
		      || (!alreadyApplied && !alreadyAppliedMaterial)
		      || (localHash !== alreadyApplied && localMaterialHash !== alreadyAppliedMaterial && localMaterialHash !== remoteMaterialHash)
		    );

	      INITIAL_TENANT_SEED_REQUIRED = false;
	      LAST_REMOTE_REVISION = remoteRevision;
	      safeStorageSet(tenantStorageKey('REMOTE_REVISION'), String(remoteRevision));
      tenantGuard.allow(context);
	      PULL_COMPLETE = true;
	      // r37.2.2 (P0, real SHARY incident): pendingLocalRecovery used to be
	      // resolved unconditionally, before `force` was ever consulted below --
	      // an explicit "Reintentar desde nube" (force:true) re-armed the exact
	      // conflict marker it had just cleared and returned false, forever. A
	      // background/automatic pull must still respect the conflict guard
	      // (never silently discard a real pending local change), but an
	      // explicit, user-initiated force refresh IS the customer resolving
	      // that conflict in favor of the cloud -- let it fall through to the
	      // real hydrate branch below instead of being swallowed here.
	      if (pendingLocalRecovery && !force) {
	        const baseRevision = Number(recoveryMeta.baseRevision || 0);
	        const recoverySource = String(recoveryMeta.source || '').toLowerCase();
	        if (shouldTreatAsNonMaterial(recoverySource) || localMaterialHash === remoteMaterialHash) {
	          clearSyncConflict();
	          LOCAL_WRITE_PENDING_UNTIL = 0;
	          rememberAppliedRemotePayload(context, remotePayload, remoteRevision, { reason: 'non_material_recovery_already_synced' });
	          setSyncStatus('synced', 'El cambio local era solo de vista y ya coincide con la nube.', { revision: remoteRevision });
	          return false;
	        }
	        const recoveryDecision = window.CLICK360_V16_DOMAIN?.offlineRecoveryDecision?.({
	          pendingRemoteSync: true,
	          baseRevision,
	          remoteRevision,
	          localHash: localMaterialHash,
	          remoteHash: remoteMaterialHash
	        }) || { action: baseRevision === remoteRevision ? 'push_local' : 'conflict' };
	        if (recoveryDecision.action === 'already_synced') {
	          clearSyncConflict();
	          rememberAppliedRemotePayload(context, remotePayload, remoteRevision, { reason: 'indexeddb_recovery_already_synced' });
	          setSyncStatus('synced', 'La copia pendiente ya coincide con la nube.', { revision: remoteRevision });
	          return false;
	        }
        if (recoveryDecision.action === 'conflict') {
          markSyncConflict({ path: stateDoc.path, remoteRevision, baseRevision, localUpdatedAtMs: localPayloadUpdatedAtMs(), source: 'indexeddb_recovery' });
          setSyncStatus('error', 'Hay una copia offline pendiente y la nube cambió. Ninguna versión fue sobrescrita.');
          return false;
        }
        setSyncStatus('pending', 'Copia offline verificada. Se sincronizará antes de permitir nuevos cambios.', { revision: remoteRevision });
        return false;
      }
	      if (pendingLocalRecovery && force) {
	        // Explicit force resolved the conflict in favor of the cloud --
	        // never fall through to hydrate with the stale marker still armed.
	        quarantineIncident('forced_remote_refresh_over_pending_local', { path: stateDoc.path, remoteRevision, baseRevision: Number(recoveryMeta.baseRevision || 0) });
	        clearSyncConflict();
	      }
		    if (force || remoteMustHydrate || (remoteMaterialHash && remoteMaterialHash !== localMaterialHash && remoteMaterialHash !== alreadyAppliedMaterial)) {
	      if (localChanged && !force) {
	          markSyncConflict({ path: stateDoc.path, remoteRevision, localUpdatedAtMs: localPayloadUpdatedAtMs(), source: 'pull' });
	          setSyncStatus('error', 'Hay cambios locales y remotos simultáneos. No se sobrescribió ninguna versión.');
	          return false;
	        }
			        applyRemotePayload(remotePayload);
		        rememberAppliedRemotePayload(context, remotePayload, remoteRevision, { reason: force ? 'forced_remote_refresh' : 'remote_hydrate' });
		        if (force) clearSyncConflict();
		        const storageMode = window.click360GetStorageState?.().mode;
		        setSyncStatus(storageMode === 'online_only_safe' ? 'online_only_safe' : 'synced', storageMode === 'online_only_safe'
		          ? 'Tus datos estan seguros en la nube. Este dispositivo no pudo activar el modo sin conexion.'
		          : 'Datos actualizados desde la nube.', { revision: remoteRevision });
        // r37.2.2 (P0, real SHARY incident): see the identical note on the
        // listener path below -- click360ReloadState() here could silently wipe
        // the just-hydrated in-memory state on a local-persist failure. Removed.
        // r37.2.5 (P0, real SHARY incident): a forced refresh mid-edit (this
        // exact device's own conflict-recovery calling click360RefreshNow()
        // while its product-edit modal is still open) used to route/re-render
        // unconditionally here, unlike the realtime listener path below which
        // already guards against clobbering an open modal or a focused input.
        // That inconsistency could destroy the very form the user (or an
        // in-flight save handler) was still using. Apply the same guard.
        const hasOpenModalOnRefresh = !!document.querySelector('#modalRoot .modalOverlay.show');
        const hasActiveInputOnRefresh = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
	        if (reload && window.click360Route && !hasOpenModalOnRefresh && !hasActiveInputOnRefresh) window.click360Route(window.location.hash.replace('#','') || 'home');
	      return true;
	    }
			    if (force || remoteHash === localHash || remoteMaterialHash === localMaterialHash) {
			      if (remoteHash === localHash) rememberAppliedRemotePayload(context, remotePayload, remoteRevision, { reason: 'remote_matches_local' });
			      else {
			        safeStorageSet(tenantStorageKey('LAST_APPLIED_REMOTE_MATERIAL_HASH'), remoteMaterialHash);
			        safeStorageSet(tenantStorageKey('REMOTE_REVISION'), String(remoteRevision));
			        window.click360MarkTenantCacheSynced?.({ revision: remoteRevision, payloadHash: localHash, materialHash: localMaterialHash, operationId: 'remote_material_matches_local' }).catch?.(() => {});
			      }
			      clearSyncConflict();
			    }
		      setSyncStatus('synced', 'Datos locales y nube coinciden.', { revision: remoteRevision });
	      return false;
	  } catch (error) {
	    if (!isActiveSyncScope(context, stateDoc, expectedEpoch, user)) return false;
	    const transientOffline = ['unavailable', 'deadline-exceeded', 'failed-precondition'].includes(error.code);
	    if (!force && transientOffline && verifiedOfflineTenantCache()) {
	      tenantGuard.allow(context);
	      PULL_COMPLETE = true;
	      setSyncStatus('offline', 'La red no respondió. Usando la última caché verificada de esta cuenta.');
	      return false;
	    }
	    PULL_COMPLETE = false;
	      console.warn('CLICK360 no pudo traer nube:', error.message);
	      setSyncStatus(navigator.onLine ? 'error' : 'offline', error.message || 'No se pudo leer la nube.');
	      return false;
	    }
	  }

  function listenRemoteChanges() {
    if (REMOTE_UNSUBSCRIBE) return;

	    const context = ACTIVE_CONTEXT;
	    const stateDoc = STATE_DOC;
	    const expectedEpoch = AUTH_EPOCH;
	    const user = auth.currentUser;
	    REMOTE_UNSUBSCRIBE = stateDoc.onSnapshot((snap) => {
	      if (!AUTH_APPROVED || !PULL_COMPLETE || !snap.exists || !isActiveSyncScope(context, stateDoc, expectedEpoch, user)) return;

          if (snap.metadata?.fromCache === true || snap.metadata?.hasPendingWrites === true) return;

	      const remoteData = snap.data() || {};
          if (Number(remoteData.revision || remoteData.updatedAtMs || 0) < Number(LAST_REMOTE_REVISION || 0)) return;
	      if (remoteData.schemaVersion !== SCHEMA_VERSION) {
	        tenantGuard.requireLegacy(context, { document: remoteData, path: stateDoc.path });
	        safeStorageSet(legacyMigrationMarkerKey(), '1');
	        AUTH_APPROVED = false;
	        PULL_COMPLETE = false;
	        setSyncStatus('migration_required', legacyMigrationMessage());
	        showLegacyMigrationGate();
	        return;
	      }
	      if (!remoteMatchesContext(remoteData, context)) {
	        tenantGuard.block();
	        safeStorageSet(tenantCorruptMarkerKey(), '1');
	        AUTH_APPROVED = false;
	        PULL_COMPLETE = false;
	        quarantineIncident("blocked_listener_identity", { path: stateDoc.path });
	        setSyncStatus("error", "Cambio remoto de otro tenant bloqueado.");
		        showGate('Se detectó un cambio remoto de otra cuenta. La operación fue bloqueada para proteger los datos.', ACCESS_UI_STATES.BLOCKED, { reason: 'remote_identity_mismatch' });
	        return;
	      }
	      // r37.2.5 (P0, real SHARY incident): a same-product two-device race
	      // where the loser's own CAS check (pushLocalToFirestoreOnce's
	      // expectedRevision vs. a fresh transaction read) is the ONLY thing
	      // standing between "safely detected conflict" and "silently
	      // overwrote the winner's already-confirmed write". That check only
	      // works if expectedRevision (LAST_REMOTE_REVISION) still reflects
	      // what this device knew before ITS OWN retry-safety comparison ran
	      // -- if this listener silently fast-forwards it first, the loser's
	      // very next push sees no conflict at all and commits cleanly,
	      // reporting its own true "confirmed" after the winner already
	      // reported theirs. Deferring here doesn't lose data: the guarded
	      // caller's own explicit, authoritative refresh (targetSnapshot /
	      // click360RefreshNow) still runs the moment the guard clears.
	      if (CRITICAL_WRITE_GUARD_ACTIVE) return;
	      const remotePayload = remoteData.payload;
	      rememberTenantMaterialEvidence(context, remotePayload);
	      LAST_REMOTE_REVISION = Number(remoteData.revision || remoteData.updatedAtMs || LAST_REMOTE_REVISION || 0);
		      safeStorageSet(tenantStorageKey("REMOTE_REVISION"), String(LAST_REMOTE_REVISION || 0));
		      const remoteHash = snapshotString(remotePayload);
	      const remoteMaterialHash = materialPayloadHash(remotePayload);
	      const localPayload = buildBusinessPayload();
	      const localHash = snapshotString(localPayload);
	      const localMaterialHash = materialPayloadHash(localPayload);
	      const lastApplied = safeStorageGet(tenantStorageKey("LAST_APPLIED_REMOTE_HASH"));
	      const lastAppliedMaterial = safeStorageGet(tenantStorageKey("LAST_APPLIED_REMOTE_MATERIAL_HASH"));

		      if (remoteMaterialHash && remoteMaterialHash !== "{}" && remoteMaterialHash !== localMaterialHash && remoteMaterialHash !== lastAppliedMaterial && remoteHash !== lastApplied && !IS_RESTORING_REMOTE) {
		        if (Date.now() < LOCAL_WRITE_PENDING_UNTIL) {
		          markSyncConflict({ path: stateDoc.path, remoteRevision: LAST_REMOTE_REVISION, localUpdatedAtMs: localPayloadUpdatedAtMs(), source: 'listener' });
		          setSyncStatus('error', 'Se detectaron cambios simultáneos. No se sobrescribió ninguna versión.');
	          return;
		        }
		        applyRemotePayload(remotePayload);
		        rememberAppliedRemotePayload(context, remotePayload, LAST_REMOTE_REVISION, { reason: 'listener_remote_applied' });
		        setSyncStatus("synced", "Cambios remotos aplicados.", { revision: LAST_REMOTE_REVISION });
	        console.log("CLICK360 recibió cambios remotos.");

        // r37.2.2 (P0, real SHARY incident): click360ReloadState() used to run
        // right after applyRemotePayload() -- it re-reads state from localStorage
        // ONLY (loadState()), so if the local persist inside applyRemotePayload had
        // silently failed (quota, etc.) this call would overwrite the correctly-
        // hydrated in-memory state with an empty seed, discarding a successful
        // remote fetch. applyRemotePayload -> click360ApplyTenantState already sets
        // `state` in memory (with an IndexedDB fallback queued) regardless of the
        // localStorage outcome, so nothing here needs to re-read it.

        const hasOpenModal = !!document.querySelector('#modalRoot .modalOverlay.show');
        const hasActiveInput = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);

        if (!hasOpenModal && !hasActiveInput) {
          if (window.click360Route) {
            const currentRoute = window.location.hash.replace('#','') || 'home';
            window.click360Route(currentRoute);
          } else {
             location.reload();
          }
	        }
	      }
	      if (remoteMaterialHash && remoteMaterialHash === localMaterialHash && !IS_RESTORING_REMOTE) {
	        clearSyncConflict();
	        LOCAL_WRITE_PENDING_UNTIL = 0;
	        safeStorageSet(tenantStorageKey('LAST_APPLIED_REMOTE_MATERIAL_HASH'), remoteMaterialHash);
	        window.click360MarkTenantCacheSynced?.({ revision: LAST_REMOTE_REVISION, payloadHash: localHash, materialHash: localMaterialHash, operationId: 'listener_material_match' }).catch?.(() => {});
	      }
		    }, (err) => {
	      if (!isActiveSyncScope(context, stateDoc, expectedEpoch, user)) return;
	      console.warn("No se pudo escuchar cambios remotos:", err.message);
	      setSyncStatus(navigator.onLine ? "error" : "offline", err.message || "No se pudo escuchar la nube.");
	    });
	  }

		  function showGate(message = "Inicia sesión con Google para continuar.", state = ACCESS_UI_STATES.RECOVERABLE_ERROR, details = {}) {
	    setAppBlocked(true);
	    publishAccessUiState(state, details);

    let gate = document.getElementById("click360-auth-gate");
    if (!gate) {
      gate = document.createElement("div");
      gate.id = "click360-auth-gate";
      gate.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:#050505;color:white;display:flex;align-items:center;justify-content:center;font-family:Arial,sans-serif;padding:clamp(14px,3vw,32px);box-sizing:border-box;overflow:auto;";
	      gate.innerHTML = `
	        <div class="c360-gate-shell">
	          <section class="c360-gate-hero" aria-label="CLICK 360">
		            <div class="c360-gate-brand"><span>CLICK</span> 360 <small>1.0.5</small></div>
	            <h1>Todo tu negocio en una sola aplicación</h1>
	            <p>Controla inventario, ventas, caja, clientes y productos desde tu celular, de forma sencilla.</p>
	            <p class="c360-gate-promise">Menos papeles. Menos confusión. Más control.</p>
	            <div class="c360-gate-actions" aria-label="Opciones de acceso">
	              <button id="c360-google-login" class="c360-gate-primary">Iniciar sesión</button>
	              <button id="c360-trial-login" class="c360-gate-secondary">Probar gratis</button>
	              <button id="c360-register-login" class="c360-gate-secondary">Registrarse</button>
	              <button id="c360-invite-login" class="c360-gate-secondary">Tengo una invitación</button>
	              <button id="c360-show-plans" class="c360-gate-link">Ver planes</button>
	              <a class="c360-gate-link" href="https://wa.me/593969399562?text=Hola%2C%20quiero%20conocer%20CLICK%20360" target="_blank" rel="noopener noreferrer">Hablar con CLICK 360</a>
	            </div>
		            <div id="c360-public-plans" class="c360-public-plans" hidden>
	              <article><b>Prueba gratis</b><strong>7 días</strong><span>Todas las funciones Base, sin borrar tus datos al terminar.</span><button type="button" data-public-flow="trial">Empezar prueba</button></article>
	              <article><b>Base</b><strong>$${(window.CLICK360_V16_DOMAIN?.PLAN_CATALOG?.base?.prices?.month ?? 39.99).toFixed(2)} / mes</strong><span>Inventario, ventas, caja, clientes, reportes y etiquetas QR.</span><a href="https://wa.me/593969399562?text=Hola%2C%20quiero%20activar%20CLICK%20360%20Base" target="_blank" rel="noopener noreferrer">Elegir Base</a></article>
		              <article><b>Pro</b><strong>$${(window.CLICK360_V16_DOMAIN?.PLAN_CATALOG?.pro?.prices?.month ?? 59.99).toFixed(2)} / mes</strong><span>Todo Base, más CRM, recordatorios, proveedores y herramientas avanzadas.</span><a href="https://wa.me/593969399562?text=Hola%2C%20quiero%20activar%20CLICK%20360%20Pro" target="_blank" rel="noopener noreferrer">Elegir Pro</a></article>
		              <article><b>Business</b><strong>$${(window.CLICK360_V16_DOMAIN?.PLAN_CATALOG?.business?.prices?.month ?? 99.99).toFixed(2)} / mes</strong><span>Todo Pro, más restaurante, logística de rutas y capacidad ampliada.</span><a href="https://wa.me/593969399562?text=Hola%2C%20quiero%20activar%20CLICK%20360%20Business" target="_blank" rel="noopener noreferrer">Elegir Business</a></article>
		            </div>
		            <button id="c360-retry-access" class="c360-change-button" style="display:none;">Reintentar</button>
		          </section>
	          <section class="c360-auth-card" aria-label="Información y acceso seguro">
	            <div class="c360-auth-logo" aria-hidden="true"></div>
	            <h2>Tu negocio, siempre a mano</h2>
	            <p>Usa la misma cuenta de Google en celular y computadora.</p>
	            <form id="c360-invite-form" class="c360-invite-form" hidden>
	              <strong>Entrar con invitación</strong>
	              <label>Enlace o token<input id="c360-invite-value" autocomplete="off" placeholder="Pega aquí la invitación"></label>
	              <label>Identificador del negocio<input id="c360-invite-owner" autocomplete="off" placeholder="Solo si pegaste un token"></label>
	              <div><button type="button" id="c360-invite-cancel">Cancelar</button><button type="submit">Continuar con Google</button></div>
	            </form>
	            <p id="c360-auth-msg" role="status" aria-live="polite"></p>
	            <div class="c360-public-faq" aria-label="Preguntas frecuentes">
	              <h3>Preguntas frecuentes</h3>
	              <details><summary>¿Qué es CLICK 360?</summary><p>Una aplicación para controlar productos, ventas, caja, clientes y reportes.</p></details>
	              <details><summary>¿Para qué negocios sirve?</summary><p>Tiendas, restaurantes, servicios, ferreterías y otros negocios que necesitan orden y control.</p></details>
	              <details><summary>¿Puedo usarlo desde el celular?</summary><p>Sí. Funciona en celular, tableta y computadora, y puede instalarse como aplicación.</p></details>
	              <details><summary>¿Necesito computadora?</summary><p>No. Puedes trabajar directamente desde tu celular.</p></details>
	              <details><summary>¿Puedo controlar inventario y caja?</summary><p>Sí. Registra productos, ventas, movimientos y cierres diarios.</p></details>
	              <details><summary>¿Tiene prueba gratis?</summary><p>Sí. Cada cuenta nueva puede activar una prueba única de siete días.</p></details>
	              <details><summary>¿Cómo inicio sesión?</summary><p>Selecciona Iniciar sesión y continúa con tu cuenta de Google.</p></details>
	              <details><summary>¿Cómo agrego trabajadores?</summary><p>El acceso operativo para trabajadores está temporalmente pausado mientras se completa su protección independiente por módulos.</p></details>
	              <details><summary>¿Puedo imprimir etiquetas QR?</summary><p>Sí. Puedes diseñar, guardar e imprimir etiquetas para tus productos.</p></details>
	            </div>
	            <button id="c360-change-google" class="c360-change-button" style="display:none;">Cambiar cuenta / Cerrar sesión</button>
	            <button id="c360-clear-cache" class="c360-cache-button" style="display:none;">Actualizar archivos de la app</button>
	            <p class="c360-auth-legal">Al continuar aceptas los <a id="c360-public-terms" href="/terms.html" target="_blank" rel="noopener noreferrer">Términos</a> y la <a id="c360-public-privacy" href="/privacy.html" target="_blank" rel="noopener noreferrer">Política de privacidad</a>.</p>
	          </section>
	        </div>
	      `;
	      document.body.appendChild(gate);

	      document.getElementById("c360-google-login").onclick = () => beginPublicAuth('login');
	      document.getElementById("c360-trial-login").onclick = () => beginPublicAuth('trial');
	      document.getElementById("c360-register-login").onclick = () => beginPublicAuth('register');
	      document.querySelectorAll('[data-public-flow="trial"]').forEach((button) => { button.onclick = () => beginPublicAuth('trial'); });
		      document.getElementById("c360-invite-login").onclick = () => {
		        const form = document.getElementById('c360-invite-form');
		        form.hidden = false;
		        const current = currentInvitationParams();
		        if (current.inviteToken) document.getElementById('c360-invite-value').value = current.inviteToken;
		        if (current.ownerId) document.getElementById('c360-invite-owner').value = current.ownerId;
		        document.getElementById('c360-invite-value').focus();
		      };
		      document.getElementById('c360-invite-cancel').onclick = () => {
		        document.getElementById('c360-invite-form').hidden = true;
		        clearInvitationIntent({ cleanUrl: true });
		        setPublicAuthIntent('login');
		      };
	      document.getElementById('c360-invite-form').onsubmit = (event) => {
	        event.preventDefault();
	        const raw = document.getElementById('c360-invite-value').value.trim();
	        let ownerId = document.getElementById('c360-invite-owner').value.trim();
	        let inviteToken = raw;
	        try {
	          const parsed = new URL(raw);
	          const params = parsed.searchParams;
	          inviteToken = params.get('inviteToken') || params.get('token') || '';
	          ownerId = params.get('ownerId') || ownerId;
	        } catch {}
	        const msg = document.getElementById('c360-auth-msg');
	        if (!inviteToken || !ownerId) {
	          if (msg) msg.textContent = 'Pega el enlace completo o escribe el token y el identificador del negocio.';
	          return;
	        }
		        const params = new URLSearchParams(location.search);
		        const inviteSession = markExplicitInvitationIntent(ownerId, inviteToken);
		        if (!inviteSession) {
		          if (msg) msg.textContent = 'Este navegador no pudo iniciar la invitación de forma segura. Actualiza la página e inténtalo otra vez.';
		          return;
		        }
		        params.set('flow', 'invite');
			        params.set('ownerId', ownerId);
			        params.set('inviteToken', inviteToken);
			        params.set('inviteSession', inviteSession);
			        history.replaceState({}, '', `${location.pathname}?${params.toString()}${location.hash}`);
			        beginPublicAuth('invite');
		      };
	      document.getElementById("c360-show-plans").onclick = () => {
        const plans = document.getElementById('c360-public-plans');
	        plans.hidden = !plans.hidden;
	      };
	      document.getElementById('c360-retry-access').onclick = () => window.location.reload();
      document.getElementById("c360-change-google").onclick = async () => {
        if(window.click360Logout) await window.click360Logout();
        else {
           await auth.signOut();
           location.reload();
        }
      };

      // r37.2.1 (LIVE CLIENT RECOVERY -- safe update, the exact button a
      // real customer -- SHARY -- was told to press): this used to
      // unregister the service worker and delete every click360- cache
      // BEFORE ever confirming a new version could actually be downloaded.
      // If the network was unstable at that exact moment (this button only
      // shows up on a BLOCKED/RECOVERABLE_ERROR screen -- i.e. exactly
      // when the network/auth state is already suspect), the device was
      // left with no worker and no cache, and the forced reload hit "No se
      // puede acceder a este sitio" with nothing to fall back to -- then a
      // blank screen. Now this goes through the SAME shared, real
      // PREPARE->COMMIT->ROLLBACK engine (safe-update.js) repair.html
      // already used safely -- nothing is ever deleted until a new,
      // confirmed-active version genuinely exists.
      document.getElementById("c360-clear-cache").onclick = () => {
        const btn = document.getElementById("c360-clear-cache");
        const statusMsg = document.getElementById("c360-auth-msg");
        btn.textContent = "Verificando conexión...";
        btn.disabled = true;
        if (typeof window.click360SafeUpdate !== 'function') {
          if (statusMsg) statusMsg.textContent = 'Abre click360.app/repair.html para actualizar de forma segura.';
          btn.textContent = "Actualizar archivos de la app";
          btn.disabled = false;
          return;
        }
        window.click360SafeUpdate({
          onLog: (message) => {
            if (message.indexOf('Registrando') === 0 || message.indexOf('Actualizando el service worker') === 0) {
              btn.textContent = "Descargando actualización...";
            }
          }
        }).then((result) => {
          if (result.ok) { window.location.href = '/?repaired=' + Date.now(); return; }
          if (statusMsg) statusMsg.textContent = result.message + ' Tu versión actual sigue funcionando; no se eliminó nada.';
          btn.textContent = "Reintentar actualización";
          btn.disabled = false;
        });
      };
    }

    const msg = document.getElementById("c360-auth-msg");
    if (msg) msg.innerHTML = message;

	    // Access controls are driven only by the explicit state machine. User-facing
	    // wording can change without accidentally hiding the login or registration paths.
	    const loginBtn = document.getElementById("c360-google-login");
	    const changeBtn = document.getElementById("c360-change-google");
	    const clearBtn = document.getElementById("c360-clear-cache");
	    const retryBtn = document.getElementById('c360-retry-access');
	    const publicActions = ['c360-google-login', 'c360-trial-login', 'c360-register-login', 'c360-invite-login', 'c360-show-plans']
	      .map((id) => document.getElementById(id)).filter(Boolean);

	    const hasAuthenticatedUser = !!auth.currentUser;
	    const policy = window.CLICK360_ACCESS_FLOW?.gatePolicy?.(ACCESS_UI_STATE, hasAuthenticatedUser) || {
	      showPublicActions: [ACCESS_UI_STATES.UNAUTHENTICATED, ACCESS_UI_STATES.INVALID_INVITATION, ACCESS_UI_STATES.RECOVERABLE_ERROR, ACCESS_UI_STATES.AUTHENTICATED_NO_ACCESS].includes(ACCESS_UI_STATE),
		      showLogin: true,
		      showRetry: [ACCESS_UI_STATES.INVALID_INVITATION, ACCESS_UI_STATES.RECOVERABLE_ERROR].includes(ACCESS_UI_STATE),
		      showChangeAccount: hasAuthenticatedUser,
	      showRefreshAssets: false
	    };
	    publicActions.forEach((button) => { button.style.display = policy.showPublicActions ? '' : 'none'; });
		    if (loginBtn) {
	      loginBtn.style.display = policy.showLogin ? 'inline-flex' : 'none';
		      loginBtn.textContent = hasAuthenticatedUser ? 'Cambiar cuenta de Google' : 'Iniciar sesión';
		    }
		    if (retryBtn) {
		      retryBtn.style.display = policy.showRetry ? 'flex' : 'none';
		      retryBtn.textContent = ACCESS_UI_STATE === ACCESS_UI_STATES.INVALID_INVITATION
		        ? 'Continuar con mi cuenta'
		        : 'Reintentar';
		    }
	    if (changeBtn) changeBtn.style.display = policy.showChangeAccount ? 'block' : 'none';
	    if (clearBtn) clearBtn.style.display = policy.showRefreshAssets ? 'block' : 'none';
	  }

  function embeddedBrowser() {
    const ua = navigator.userAgent || '';
    const embedded = /FBAN|FBAV|Instagram|WhatsApp|Line\/|; wv\)|\bwv\b|ChatGPT/i.test(ua) || window.top !== window.self;
    return { embedded, isAndroid: /Android/i.test(ua), isIOS: /iPhone|iPad|iPod/i.test(ua) };
  }

		  function showPending(user) {
		    loginGateMessage(`Tu cuenta (${user.email || "sin email"}) está pendiente de aprobación. Tu solicitud está protegida. Contacta a CLICK 360 para revisar o activar el acceso de esta cuenta.`, 'AUTH_APPROVED_USERS_REJECTED', ACCESS_UI_STATES.PENDING);

    const loginBtn = document.getElementById("c360-google-login");
	    if(loginBtn) {
	      loginBtn.style.display = 'inline-flex';
      loginBtn.textContent = "Ya me aprobaron (Actualizar)";
      loginBtn.onclick = async () => {
         const epoch = AUTH_EPOCH;
         const ok = await isApprovedUser(user, epoch);
         if(ok) await enterApprovedApp(user, epoch);
         else showPending(user);
      };
    }
  }

	  function unlockApp() {
    if (!tenantGuard.canUnlock(ACTIVE_CONTEXT) || legacyMigrationRequired()) {
      showLegacyMigrationGate();
      return false;
    }
	    AUTH_APPROVED = true;
	    setAppBlocked(false);
		    const resolvedUiState = window.CLICK360_ACCESS_FLOW?.stateForAccess?.(window.click360AccessState, ONLINE_ONLY_SAFE)
		      || (ONLINE_ONLY_SAFE ? ACCESS_UI_STATES.ONLINE_ONLY_SAFE : ACCESS_UI_STATES.READY);
		    publishAccessUiState(resolvedUiState, {
	      uid: auth.currentUser?.uid || null,
	      tenantKey: ACTIVE_CONTEXT?.tenantKey || null
	    });

    const gate = document.getElementById("click360-auth-gate");

    try {
      if(window.click360Route) {
         const currentRoute = window.location.hash.replace('#','') || 'home';
         window.click360Route(currentRoute);
	      }
	      if (gate) gate.remove();
	      return true;
	    } catch(e) {
      console.error("Error durante unlockApp:", e);
	      const msg = document.getElementById("c360-auth-msg");
	      if (msg) {
	        msg.textContent = 'No pudimos terminar de abrir CLICK 360. Actualiza la aplicación e inténtalo de nuevo.';
	      } else {
	        alert('No pudimos terminar de abrir CLICK 360. Actualiza la aplicación e inténtalo de nuevo.');
	      }
	      return false;
	    }
  }

  function providerGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    return provider;
  }

  function beginPublicAuth(intent) {
    if (AUTH_REQUEST_IN_FLIGHT) return;
    setPublicAuthIntent(intent);
    AUTH_REQUEST_IN_FLIGHT = true;
    document.querySelectorAll('.c360-gate-actions button, .c360-public-plans button').forEach((button) => { button.disabled = true; });
    const selectGoogleAccount = async () => {
      return signInGoogle();
    };
    Promise.resolve(selectGoogleAccount()).finally(() => {
      AUTH_REQUEST_IN_FLIGHT = false;
      document.querySelectorAll('.c360-gate-actions button, .c360-public-plans button').forEach((button) => { button.disabled = false; });
    });
  }

	  function signInGoogle() {
	    const msg = document.getElementById("c360-auth-msg");
	    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const browser = embeddedBrowser();

    if (browser.embedded) {
      const directUrl = `${location.origin}${location.pathname}${location.search}${location.hash}`;
      const androidIntent = `intent://${location.host}${location.pathname}${location.search}${location.hash}#Intent;scheme=https;package=com.android.chrome;end`;
      if (msg) msg.innerHTML = `<b>Abre CLICK 360 en tu navegador.</b><br>Este navegador interno no permite un inicio de sesión Google seguro.<br><br><a class="c360-open-browser" href="${escapeHtml(browser.isAndroid ? androidIntent : directUrl)}" target="_blank" rel="noopener noreferrer">${browser.isAndroid ? 'Abrir en Chrome' : 'Abrir en Safari'}</a>`;
      return Promise.resolve(false);
    }

	    if (msg) msg.textContent = "Abriendo Google...";
	    if (isIOS) {
	      setAuthRedirectPending(readPublicAuthIntent());
	      return auth.signInWithRedirect(providerGoogle()).catch(() => {
	        clearAuthRedirectPending();
	        if (msg) msg.innerHTML = `No pudimos abrir Google desde esta ventana.<br><small>Código: AUTH_REDIRECT_NO_RESULT</small><br><a class="c360-open-browser" href="https://click-360.web.app/" target="_blank" rel="noopener noreferrer">Abrir CLICK 360 en Safari</a>`;
	        return false;
	      });
	    }

		    return auth.signInWithPopup(providerGoogle()).catch(err => {
	      console.warn("Popup falló:", err.message);
		      console.warn('[CLICK360_TELEMETRY]', { eventType: 'login_failure', errorCode: String(err.code || 'unknown').slice(0, 80), appVersion: '16.2' });
      if (err.code === 'auth/popup-blocked') {
        if (msg) msg.innerHTML = "Tu navegador bloqueó la ventana de Google.<br>Por favor, <b>permite las ventanas emergentes</b> o intenta desde Chrome/Safari normal.";
      } else if (err.code === 'auth/operation-not-supported-in-this-environment') {
        if (msg) msg.textContent = "Redireccionando a Google...";
        setAuthRedirectPending(readPublicAuthIntent());
        auth.signInWithRedirect(providerGoogle());
      } else if (err.code !== 'auth/popup-closed-by-user') {
	        if (msg) msg.innerHTML = "No pudimos iniciar sesión con Google. Revisa la conexión e inténtalo otra vez desde Safari o Chrome.<br><small>Código: AUTH_REDIRECT_NO_RESULT</small>";
      }
    });
  }

  function debounce(fn, wait = 1000) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

	  async function pullModularState() {
	    if (!MODULAR_MODE || !MODULAR_GATEWAY || !ACTIVE_CONTEXT || !navigator.onLine) return false;
	    const next = await MODULAR_GATEWAY.pull();
	    next.identity = activeIdentity();
        rememberTenantMaterialEvidence(ACTIVE_CONTEXT, next);
	    window.click360ApplyTenantState(next, ACTIVE_CONTEXT);
	    MODULAR_BASELINE = JSON.parse(JSON.stringify(next));
	    LOCAL_WRITE_PENDING_UNTIL = 0;
	    setSyncStatus('synced', 'Datos modulares verificados por negocio.', { reason:'modular_pull' });
	    return true;
	  }

	  async function pushModularState(reason = 'local_change') {
	    if (!MODULAR_MODE || !MODULAR_GATEWAY || !ACTIVE_CONTEXT || !AUTH_APPROVED || !PULL_COMPLETE) return false;
	    if (!navigator.onLine) {
	      setSyncStatus('offline', 'Cambio modular pendiente de conexión.', { reason });
	      return false;
	    }
	    const next = window.click360GetTenantState?.();
	    if (!next || !MODULAR_BASELINE) return false;
	    try {
          assertTenantReplacementSafe({ identity: next.identity, data: next }, MODULAR_BASELINE, ACTIVE_CONTEXT, reason, true);
	      setSyncStatus('syncing', 'Confirmando cambio modular...', { reason });
	      await MODULAR_GATEWAY.commit(MODULAR_BASELINE, next);
	      await pullModularState();
	      return true;
		    } catch (error) {
		      console.warn('Cambio modular rechazado:', error.code || error.message);
		      const stockChanged = (MODULAR_BASELINE?.products || []).some((before) => {
		        const after = (next.products || []).find((candidate) => candidate.id === before.id);
		        return after && Number(after.stock) !== Number(before.stock);
		      });
		      recordTelemetry(stockChanged ? 'worker_stock_error' : 'worker_permission_denied', {
		        errorCode:String(error.code || 'permission_denied').slice(0, 80)
		      }).catch(() => {});
		      setSyncStatus('error', 'El cambio no fue autorizado para este rol. La nube no fue modificada.', {
		        reason:'modular_write_rejected', errorCode:String(error.code || 'permission_denied')
		      });
		      await pullModularState().catch(() => false);
		      return false;
		    }
	  }

	  const debouncedSync = debounce((tenantKey, authUid, expectedEpoch, reason = 'local_change') => {
	    if (expectedEpoch !== AUTH_EPOCH || ACTIVE_CONTEXT?.tenantKey !== tenantKey || ACTIVE_CONTEXT?.authUid !== authUid) return;
	    const sync = MODULAR_MODE ? pushModularState : pushLocalToFirestore;
	    sync(String(reason || 'local_change')).catch(() => {});
	  }, 1200);

			  window.addEventListener('click360-local-state-saved', (event) => {
			    if (!IS_RESTORING_REMOTE && AUTH_APPROVED && PULL_COMPLETE
			      && event.detail?.tenantKey === ACTIVE_CONTEXT?.tenantKey) {
				      const pendingRemoteSync = event.detail?.pendingRemoteSync !== false;
				      LOCAL_WRITE_PENDING_UNTIL = pendingRemoteSync ? Date.now() + PENDING_REMOTE_SYNC_GRACE_MS : 0;
				      if (!pendingRemoteSync) {
				        maybeClearStaleSyncGuard({ reason: event.detail?.syncSource || 'non_blocking_local_change' });
				      }
				      setSyncStatus(
				        navigator.onLine ? (pendingRemoteSync ? "pending" : "syncing") : "offline",
			        navigator.onLine
			          ? (pendingRemoteSync ? "Cambio local pendiente de nube." : "Sincronizando cambios...")
			          : "Cambio local guardado sin internet."
			      );
			      if (ONLINE_ONLY_SAFE || event.detail?.storageMode === 'online_only_safe') {
			        ONLINE_ONLY_SAFE = true;
		        const detail = {
              authUid: ACTIVE_CONTEXT.authUid,
              tenantKey: ACTIVE_CONTEXT.tenantKey,
              operationId: String(event.detail?.operationId || ''),
              updatedAtMs: Number(event.detail?.updatedAtMs || 0)
            };
		        const onlineCommit = MODULAR_MODE ? pushModularState : pushLocalToFirestore;
		        onlineCommit('online_only_change').then((success) => {
		          window.dispatchEvent(new CustomEvent('click360-online-only-commit', { detail: { ...detail, success } }));
		        }).catch(() => {
		          window.dispatchEvent(new CustomEvent('click360-online-only-commit', { detail: { ...detail, success: false } }));
		        });
		      } else {
		        debouncedSync(ACTIVE_CONTEXT.tenantKey, ACTIVE_CONTEXT.authUid, AUTH_EPOCH, event.detail?.syncSource || 'local_change');
		      }
		    }
		  });

  // Sync when user returns to the app (tab/app switch)
  document.addEventListener("visibilitychange", () => {
	    if (document.visibilityState === "visible" && AUTH_APPROVED && PULL_COMPLETE && (STATE_DOC || MODULAR_MODE)) {
	      (MODULAR_MODE ? pullModularState() : pullRemoteOnce({ force: false, reload: true })).catch(() => {});
    } else if (document.visibilityState === "hidden" && AUTH_APPROVED && PULL_COMPLETE) {
	      (MODULAR_MODE ? pushModularState("visibility_hidden") : pushLocalToFirestore("visibility_hidden")).catch(() => {});
    }
  });

	  window.click360SyncNow = () => MODULAR_MODE ? pushModularState("manual") : pushLocalToFirestore("manual");
	  window.click360RefreshNow = () => MODULAR_MODE ? pullModularState() : pullRemoteOnce({ force: true, reload: true });
	  // r37.2.5 (P0, real SHARY incident): a caller with an active
	  // conflict-retry CAS window (see listenRemoteChanges below) sets this
	  // so a same-tick background snapshot can't silently fast-forward
	  // LAST_REMOTE_REVISION out from under it.
	  window.click360SetCriticalWriteGuard = (active) => { CRITICAL_WRITE_GUARD_ACTIVE = !!active; };
	  window.click360ClearLocalRecoveryState = async function() {
	    const before = getSyncState({ cleanup: false, reason: 'manual_local_recovery_before' });
	    maybeClearStaleSyncGuard({ reason: 'manual_local_recovery', force: true });
	    LOCAL_WRITE_PENDING_UNTIL = 0;
	    clearSyncConflict();
	    setSyncStatus('syncing', 'Actualizando desde nube...', { reason: 'manual_local_recovery' });
	    const refreshed = await pullRemoteOnce({ force: true, reload: true }).catch((error) => {
	      setSyncStatus(navigator.onLine ? 'error' : 'offline', error?.message || 'No se pudo actualizar desde nube.');
	      return false;
	    });
	    const after = getSyncState({ cleanup: true, reason: 'manual_local_recovery_after' });
	    return { ok: refreshed === true || after.blocking === false, refreshed: refreshed === true, before, after };
	  };
	  window.click360ResolveSyncConflict = async function(action = 'cancel') {
	    if (action === 'refresh_cloud') return window.click360ClearLocalRecoveryState();
	    if (action === 'keep_local') {
	      const localStats = window.click360GetLocalBusinessSyncStats?.();
	      if (localStats?.meaningful === false) {
	        console.warn('CLICK360 sync: blocked empty-local force write; refreshing from cloud instead.');
	        const result = await window.click360ClearLocalRecoveryState();
	        return { ...result, action: 'refresh_cloud_empty_local', preventedEmptyOverwrite: true };
	      }
	      clearSyncConflict();
	      LOCAL_WRITE_PENDING_UNTIL = Date.now() + PENDING_REMOTE_SYNC_GRACE_MS;
	      const saved = await pushLocalToFirestore('manual_keep_local', true);
	      if (saved !== true) {
	        return { ok: false, action, syncState: getSyncState({ cleanup: false, reason: 'manual_keep_local_failed' }) };
	      }
	      const readback = await pullRemoteOnce({ force: true, reload: false }).catch(() => false);
	      return { ok: readback === true, action, readback: readback === true, syncState: getSyncState({ cleanup: true, reason: 'manual_keep_local_after_readback' }) };
	    }
	    return { ok: false, action: 'cancelled', syncState: getSyncState({ cleanup: false, reason: 'manual_conflict_cancel' }) };
	  };
	  window.click360DebugSyncIdentity = () => ({
	    uid: auth.currentUser?.uid || null,
	    email: auth.currentUser?.email || null,
	    role: window.click360User?.role || null,
	    ownerId: window.click360User?.ownerId || null,
	    businessId: BUSINESS_ID,
	    tenantKey: ACTIVE_CONTEXT?.tenantKey || null,
	    stateDocPath: STATE_DOC?.path || null,
	    deviceId: getDeviceId(),
	    revision: LAST_REMOTE_REVISION,
	    status: { ...syncStatus },
	    localUpdatedAtMs: localPayloadUpdatedAtMs()
	  });
	  function deactivateActiveAccount() {
	    AUTH_EPOCH += 1;
	    AUTH_APPROVED = false;
	    PULL_COMPLETE = false;
	    IS_RESTORING_REMOTE = false;
	    INITIAL_TENANT_SEED_REQUIRED = false;
	    LOCAL_WRITE_PENDING_UNTIL = 0;
	    if (REMOTE_UNSUBSCRIBE) { REMOTE_UNSUBSCRIBE(); REMOTE_UNSUBSCRIBE = null; }
	    if (USER_STATUS_UNSUBSCRIBE) { USER_STATUS_UNSUBSCRIBE(); USER_STATUS_UNSUBSCRIBE = null; }
	    if (ACCESS_UNSUBSCRIBE) { ACCESS_UNSUBSCRIBE(); ACCESS_UNSUBSCRIBE = null; }
	    clearAccessExpiryTimer();
		    ACCESS_READ_ONLY = false;
		    ONLINE_ONLY_SAFE = false;
	    window.click360AccessState = null;
	    BUSINESS_ID = null;
	    STATE_DOC = null;
	    MODULAR_GATEWAY = null;
	    MODULAR_BASELINE = null;
	    MODULAR_MODE = false;
	    ACTIVE_CONTEXT = null;
	    LAST_REMOTE_REVISION = 0;
	    SYNC_CONFLICT_PENDING = false;
	    tenantGuard.reset();
	    window.click360User = null;
	    if (typeof window.click360ClearTenantContext === "function") window.click360ClearTenantContext();
	  }
	  window.click360Logout = async () => {
    deactivateActiveAccount();
    try { await auth.signOut(); } catch(e) { console.warn("No se pudo cerrar sesión:", e.message); }
	    clearInvitationIntent({ cleanUrl: true });
	    clearPublicAuthIntent();
	    showGate("Inicia sesión con Google para continuar.", ACCESS_UI_STATES.UNAUTHENTICATED);
  };

  function listenUserApproval(user, expectedEpoch = AUTH_EPOCH) {
    if (USER_STATUS_UNSUBSCRIBE) return;
    const context = ACTIVE_CONTEXT;
	  USER_STATUS_UNSUBSCRIBE = db.collection("approvedUsers").doc(user.uid).onSnapshot((snap) => {
	    if (!AUTH_APPROVED || !isCurrentAuthEpoch(user, expectedEpoch) || ACTIVE_CONTEXT !== context) return;
	    const data = snap.exists ? snap.data() : null;
	    const stillApproved = isExplicitlyActive(data);
	    const ownerId = data?.ownerId || user.uid;
	    const identityChanged = ownerId !== context.ownerId
	      || (data?.businessId && data.businessId !== ownerId)
	      || (data?.role || 'owner') !== window.click360User?.role;
	    if (!stillApproved || identityChanged) {
	      AUTH_APPROVED = false;
	      PULL_COMPLETE = false;
        if (REMOTE_UNSUBSCRIBE) {
          REMOTE_UNSUBSCRIBE();
          REMOTE_UNSUBSCRIBE = null;
        }
		        showGate(identityChanged
		          ? 'La configuración de tu acceso cambió y debe verificarse de nuevo. Tu información sigue protegida.'
		          : 'Tu acceso a CLICK 360 fue revocado o bloqueado. Contacta al administrador o a soporte.',
		        ACCESS_UI_STATES.BLOCKED, { reason: identityChanged ? 'identity_changed' : 'access_revoked' });
	      return;
	    }
	    const previousProfile = `${window.click360User.name || ''}\n${window.click360User.photoURL || ''}`;
	    window.click360User.name = data.name || user.displayName || window.click360User.name;
	    window.click360User.photoURL = data.photoURL || user.photoURL || '';
	    protectCurrentProfile(user, data);
	    cacheApprovedIdentity(user, window.click360User);
	    const nextProfile = `${window.click360User.name || ''}\n${window.click360User.photoURL || ''}`;
	    const editing = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
	    if (previousProfile !== nextProfile && !editing && !document.querySelector('#modalRoot .modalOverlay.show')) {
	      window.click360Route?.(window.location.hash.replace('#', '') || 'home');
	    }
	  }, (err) => console.warn("No se pudo escuchar estado de usuario:", err.message));
  }

	  function listenAccountAccess(user, expectedEpoch = AUTH_EPOCH) {
    if (ACCESS_UNSUBSCRIBE) return;
    const context = ACTIVE_CONTEXT;
    const ref = accountAccessRef(user.uid);
    if (!ref) return;
	    ACCESS_UNSUBSCRIBE = ref.onSnapshot((snap) => {
	      if (!AUTH_APPROVED || !isCurrentAuthEpoch(user, expectedEpoch) || ACTIVE_CONTEXT !== context) return;
	      // A fresh browser (notably WebKit) can emit an empty cache snapshot
	      // before the authoritative accountAccess document arrives. Absence
	      // from cache is not evidence that access was revoked: keep the
	      // already-verified session read-only at the write gate until the
	      // server snapshot follows, instead of falsely invalidating AUTH_APPROVED.
	      if (snap.metadata?.fromCache === true && !snap.exists) {
	        setSyncStatus('syncing', 'Verificando acceso con el servidor.');
	        return;
	      }
	      const data = snap.exists ? (snap.data() || {}) : null;
	      if (data && !accountAccessIdentityValid(user, data)) {
	        AUTH_APPROVED = false;
	        PULL_COMPLETE = false;
	        showGate('La identidad remota del acceso cambió. La aplicación quedó bloqueada sin modificar datos.', ACCESS_UI_STATES.BLOCKED, { reason: 'account_identity_changed' });
	        return;
	      }
	      if (data) {
	        cacheAccountAccess(user, data);
	        if (window.click360User) {
	          window.click360User.name = data.name || user.displayName || window.click360User.name;
	          window.click360User.photoURL = window.CLICK360_P0_TENANT_GUARD.safeImageSrc(data.photoURL || user.photoURL || window.click360User.photoURL);
	          protectCurrentProfile(user, data);
	        }
	      }
	      const previousAccess = window.click360AccessState || {};
        const trustedCurrentClock = Number(window.CLICK360_V16_DOMAIN?.accessClockNow?.(previousAccess, Date.now()) || previousAccess.serverNowMs || 0);
        const freshSnapshotClock = snap.metadata?.fromCache ? 0 : serverTimestampMs(data?.lastSeenAt);
        const monotonicClock = Math.max(trustedCurrentClock, freshSnapshotClock);
	      let next = data ? accessStateFromData(data, monotonicClock) : { allowed: false, mode: 'pending', readOnly: true };
        next.validatedAtClientMs = Date.now();
	      if (data && snap.metadata?.fromCache && requiresFreshEntitlementClock(data)) {
	        next = { ...next, readOnly: true, clockVerificationRequired: true };
	      }
      if (!next.allowed) {
        // r37.2.5 (P0, real SHARY incident): same principle as the
        // cache-miss guard above, extended to a cache snapshot that DOES
        // exist but computes not-allowed -- under heavy concurrent write
        // activity (e.g. a same-product conflict-retry race) a fresh
        // browser (notably WebKit) can deliver a transient/stale cached
        // read here before the authoritative server snapshot follows. Do
        // not revoke a real, already-approved session on a cache-only
        // read; wait for the server-confirmed delivery to actually decide.
        if (snap.metadata?.fromCache === true) {
          setSyncStatus('syncing', 'Verificando acceso con el servidor.');
          return;
        }
        AUTH_APPROVED = false;
        PULL_COMPLETE = false;
        if (REMOTE_UNSUBSCRIBE) { REMOTE_UNSUBSCRIBE(); REMOTE_UNSUBSCRIBE = null; }
	        showGate('Tu acceso de prueba o plan ya no está activo. Contacta a CLICK 360 para continuar.', ACCESS_UI_STATES.BLOCKED, { reason: 'entitlement_inactive' });
        return;
      }
	      window.click360User.access = publishAccessState(next);
	      scheduleAccessExpiry(user, window.click360User.access, expectedEpoch);
      if (next.readOnly) setSyncStatus('read_only', 'La prueba terminó. Tus datos permanecen disponibles en modo lectura.');
      // r37.2.5 (P0, real SHARY incident): this listener's cache-then-server
      // double delivery is normal Firestore behavior even when accountAccess
      // never changes -- the server snapshot can arrive well after hydration,
      // while the user (or an in-flight save handler) is mid-edit. Unlike its
      // sibling listeners (listenUserApproval, listenRemoteChanges), this call
      // had no open-modal/active-input guard and could destroy the form out
      // from under a real edit. Match the existing guard pattern.
      const accessEditing = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
      if (!accessEditing && !document.querySelector('#modalRoot .modalOverlay.show')) {
        window.click360Route?.(window.location.hash.replace('#', '') || 'home');
      }
    }, (error) => console.warn('No se pudo escuchar el acceso de cuenta:', error.message));
  }

	  async function enterApprovedApp(user, expectedEpoch = AUTH_EPOCH) {
		    if (!isCurrentAuthEpoch(user, expectedEpoch) || !activeIdentityIsValid(user)) return false;
	    if (MODULAR_MODE && MODULAR_GATEWAY) {
	      await window.click360PrepareTenantStorage?.(ACTIVE_CONTEXT);
	      if (!isCurrentAuthEpoch(user, expectedEpoch) || !activeIdentityIsValid(user)) return false;
	      AUTH_APPROVED = true;
	      PULL_COMPLETE = true;
	      tenantGuard.allow(ACTIVE_CONTEXT);
	      const userRole = window.click360User?.role || 'worker';
	      const userName = window.click360User?.name || window.click360User?.email || 'Trabajador';
	      window.click360SetSession?.({ username:userName, role:userRole });
	      if (!unlockApp()) return false;
	      clearPublicAuthIntent();
	      setSyncStatus('synced', 'Datos modulares verificados por negocio.', { reason:'worker_boundary_ready' });
	      recordTelemetryOnce(`bootstrap:${expectedEpoch}:${ACTIVE_CONTEXT.tenantKey}`, 'bootstrap', { mode:'worker_boundary_ready' });
	      listenUserApproval(user, expectedEpoch);
	      return true;
	    }
	    await window.click360PrepareTenantStorage?.(ACTIVE_CONTEXT);
	    await pullRemoteOnce({ force: false, reload: false });
	    if (!isCurrentAuthEpoch(user, expectedEpoch) || !activeIdentityIsValid(user)) return false;
	    if (legacyMigrationRequired()) {
	      showLegacyMigrationGate();
	      return false;
	    }
	    if (!tenantGuard.canUnlock(ACTIVE_CONTEXT)) {
	      showGate('No se pudo verificar de forma segura la identidad y los datos de esta cuenta. La operación permanece bloqueada para proteger la información.', ACCESS_UI_STATES.BLOCKED, { reason: 'tenant_identity_unverified' });
	      return false;
	    }
	    if (INITIAL_TENANT_SEED_REQUIRED) {
	      const preparedSnapshot = await window.click360PrepareInitialTenantState?.(ACTIVE_CONTEXT)
	        || { prepared: false, localPersisted: false, indexedPersisted: false, reason: 'snapshot_preparer_unavailable' };
	      if (!isCurrentAuthEpoch(user, expectedEpoch) || !activeIdentityIsValid(user)) return false;
	      const storageMode = window.click360GetStorageState?.()?.mode || '';
	      ONLINE_ONLY_SAFE = ONLINE_ONLY_SAFE || ['online_only_safe', 'unavailable'].includes(storageMode);
	      const bootstrapDecision = window.CLICK360_V16_DOMAIN?.initialTenantBootstrapDecision({
	        snapshotPrepared: preparedSnapshot.prepared === true,
	        localPersisted: preparedSnapshot.localPersisted === true,
	        indexedPersisted: preparedSnapshot.indexedPersisted === true,
	        onlineOnlySafe: ONLINE_ONLY_SAFE,
	        online: navigator.onLine,
		        readOnly: isEffectiveReadOnly()
		      }) || { allowed: preparedSnapshot.prepared === true && !isEffectiveReadOnly() && navigator.onLine };
	      if (!bootstrapDecision.allowed) {
	        tenantGuard.block();
	        PULL_COMPLETE = false;
	        const bootstrapErrorCode = bootstrapDecision.reason || preparedSnapshot.reason || 'bootstrap_blocked';
	        recordTelemetryOnce(`bootstrap:${AUTH_EPOCH}:${ACTIVE_CONTEXT.tenantKey}:${bootstrapErrorCode}`, 'bootstrap', {
	          mode: 'blocked', errorCode: bootstrapErrorCode
	        });
	        const bootstrapMessage = bootstrapDecision.reason === 'read_only'
	          ? 'Tu plan terminó antes de crear el negocio. Contacta a CLICK 360 para activarlo.'
	          : bootstrapDecision.reason === 'connection_required'
	            ? 'Conéctate a internet para preparar esta cuenta por primera vez.'
	            : 'No pudimos preparar esta cuenta de forma segura. Reintenta con internet o contacta a soporte con el código BOOTSTRAP-V10.';
		        loginGateMessage(bootstrapMessage, 'BOOTSTRAP_PREPARE_FAILED', ACCESS_UI_STATES.RECOVERABLE_ERROR, { accountStatus: bootstrapErrorCode });
	        return false;
	      }
	      if (!preparedSnapshot.localPersisted && !preparedSnapshot.indexedPersisted) {
	        setSyncStatus('online_only_safe', 'Este dispositivo trabajará directamente con la nube mientras tenga internet.');
	      }
	      AUTH_APPROVED = true;
	      const seeded = await pushLocalToFirestore('initial_tenant_seed');
	      if (!seeded) {
	        AUTH_APPROVED = false;
	        PULL_COMPLETE = false;
	        tenantGuard.block();
	        recordTelemetryOnce(`bootstrap:${AUTH_EPOCH}:${ACTIVE_CONTEXT.tenantKey}:cloud_seed_failed`, 'bootstrap', {
	          mode: 'failed', errorCode: 'cloud_seed_failed'
	        });
		        loginGateMessage('No pudimos preparar el negocio de forma segura. No se modificó información existente.', 'BOOTSTRAP_CREATE_FAILED', ACCESS_UI_STATES.RECOVERABLE_ERROR, { accountStatus: 'bootstrap_failed' });
	        return false;
	      }
	      INITIAL_TENANT_SEED_REQUIRED = false;
	    }
	  const userRole = (window.click360User && window.click360User.role) || 'owner';
	  const userName = (window.click360User && (window.click360User.name || window.click360User.email)) || 'Usuario';
		  const newSession = { username: userName, role: userRole };
			  if(window.click360SetSession) window.click360SetSession(newSession);
			  if (!unlockApp()) return false;
			  clearPublicAuthIntent();
          const pendingOfflineCache = window.click360GetTenantCacheStatus?.(ACTIVE_CONTEXT)?.pendingRemoteSync === true
            || window.click360GetIndexedTenantCacheMeta?.()?.pendingRemoteSync === true;
          if (pendingOfflineCache && navigator.onLine && !SYNC_CONFLICT_PENDING) {
            setSyncStatus('syncing', 'Recuperando el cambio guardado sin conexión antes de habilitar nuevas ediciones.');
            const recovered = await pushLocalToFirestore('online_reconnect');
            if (!isCurrentAuthEpoch(user, expectedEpoch) || !activeIdentityIsValid(user)) return false;
            if (!recovered) {
              setSyncStatus('error', 'La copia offline permanece protegida. No se habilitarán nuevas ediciones hasta resolver la sincronización.');
            }
          }
		  recordTelemetryOnce(`login:${expectedEpoch}:${user.uid}`, 'login', { mode: window.click360AccessState?.mode || userRole });
		  recordTelemetryOnce(`bootstrap:${expectedEpoch}:${ACTIVE_CONTEXT.tenantKey}`, 'bootstrap', { mode: ONLINE_ONLY_SAFE ? 'online_only_safe' : 'ready' });
		  if (ONLINE_ONLY_SAFE) setSyncStatus('online_only_safe', 'Tus datos estan seguros en la nube. Este dispositivo no pudo activar el modo sin conexion, pero puedes continuar trabajando con internet.');
	    window.click360FlushPendingProfile?.().catch(() => {});
		    listenRemoteChanges();
	    if (window.click360User?.access?.source === 'accountAccess') listenAccountAccess(user, expectedEpoch);
	    else listenUserApproval(user, expectedEpoch);
	    if (window.click360User?.access?.source === 'accountAccess') {
	      touchAccountAccessActivity(user, expectedEpoch).catch(() => {});
	    }
	    return true;
  }

  let HAS_BOOTED = false;

  async function boot() {
    if(HAS_BOOTED) return;
    HAS_BOOTED = true;

    try {
      await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    } catch (e) {
      AUTH_PERSISTENCE_READY = false;
      console.warn("Persistencia local no disponible:", e.message);
    }

	    showGate("Verificando acceso Google...", ACCESS_UI_STATES.LOADING);

	    // r37.2.1: a real invite link opened on a brand-new device (zero
	    // prior storage) must be recognized BEFORE the auth listener below
	    // reads readPublicAuthIntent() -- otherwise a genuinely valid
	    // external invite silently falls through to the generic public
	    // gate. See bootstrapInvitationFromExternalUrl() for the full story.
	    bootstrapInvitationFromExternalUrl();

	    const pendingRedirectAtBoot = readAuthRedirectPending();
	    if (pendingRedirectAtBoot) {
	      try {
	        const result = await auth.getRedirectResult();
	        AUTH_REDIRECT_RESULT_STATUS = result?.user ? 'user' : 'empty';
	        AUTH_REDIRECT_RESULT_ERROR = '';
	        if (result?.user) clearAuthRedirectPending();
	      } catch (error) {
	        AUTH_REDIRECT_RESULT_STATUS = 'error';
	        AUTH_REDIRECT_RESULT_ERROR = String(error.code || error.message || 'unknown').slice(0, 100);
	        loginGateConsole('AUTH_REDIRECT_NO_RESULT', { firestoreCode: AUTH_REDIRECT_RESULT_ERROR });
	      }
	    }


	    auth.onAuthStateChanged(async user => {
	      const epoch = AUTH_EPOCH + 1;
	      deactivateActiveAccount();
	      if (!user) {
	        const pendingRedirect = readAuthRedirectPending();
	        if (pendingRedirect) {
	          const code = AUTH_PERSISTENCE_READY === false
	            ? 'AUTH_PERSISTENCE_FAILED'
	            : AUTH_REDIRECT_RESULT_STATUS === 'empty'
	              ? 'AUTH_REDIRECT_NO_RESULT'
	              : 'AUTH_USER_NULL_AFTER_REDIRECT';
	          loginGateMessage('No pudimos completar tu acceso después de volver de Google.', code, ACCESS_UI_STATES.RECOVERABLE_ERROR, {
	            firestoreCode: AUTH_REDIRECT_RESULT_ERROR
	          });
	          return;
	        }
	        showGate("Inicia sesión con Google para continuar.", ACCESS_UI_STATES.UNAUTHENTICATED);
	        return;
	      }
	      clearAuthRedirectPending();

	      const publicIntent = readPublicAuthIntent();
	      showGate("Verificando acceso en CLICK 360...", ACCESS_UI_STATES.AUTHENTICATED_RESOLVING);
	      setSyncStatus(navigator.onLine ? "checking" : "offline", navigator.onLine ? "Verificando acceso." : "Sin internet. Buscando una aprobación propia y guardada.");

	      // Primary path: an entitlement is resolved by immutable Firebase UID.
	      const account = await resolveAccountAccess(user, epoch, { allowCreate: false, intent: publicIntent });
	      if (!isCurrentAuthEpoch(user, epoch)) return;
	      if (account.status === 'ready' && account.state?.allowed) {
	        clearInvitationIntent({ cleanUrl: true });
	        if (!applyAccountAccessIdentity(user, account, epoch)) {
	          loginGateMessage('La identidad de esta cuenta no coincide con su negocio. No se cargó ni modificó información.', 'AUTH_ACCESS_REJECTED', ACCESS_UI_STATES.BLOCKED, { accountStatus: account.status });
	          return;
	        }
	        await enterApprovedApp(user, epoch);
	        return;
	      }
	      if (account.status === 'identity_invalid') {
	        clearInvitationIntent({ cleanUrl: true });
	        loginGateMessage('La identidad de esta cuenta no coincide con su negocio. No se cargó ni modificó información.', 'AUTH_ACCESS_REJECTED', ACCESS_UI_STATES.BLOCKED, { accountStatus: account.status });
	        return;
	      }
	      if (account.status === 'invalid_entitlement') {
	        clearInvitationIntent({ cleanUrl: true });
	        loginGateMessage('Tu acceso todavía no está activo. Tus datos permanecen protegidos; contacta a CLICK 360 para revisar el plan.', 'AUTH_ACCOUNT_ACCESS_REJECTED', ACCESS_UI_STATES.PENDING, { accountStatus: account.status });
	        return;
	      }

	      // Compatibility path for founders and existing workers.
	      let approved = await isApprovedUser(user, epoch);
	      if (!isCurrentAuthEpoch(user, epoch)) return;
	      if (approved) {
	        clearInvitationIntent({ cleanUrl: true });
	        await enterApprovedApp(user, epoch);
	        return;
	      }
	      if (window.click360User && ['blocked', 'revoked'].includes(window.click360User.status)) {
	        clearInvitationIntent({ cleanUrl: true });
	        loginGateMessage(`Tu cuenta (${user.email || 'sin email'}) está bloqueada o revocada. Contacta al administrador o a soporte.`, 'AUTH_ACCESS_REJECTED', ACCESS_UI_STATES.BLOCKED, { accountStatus: window.click360User.status });
	        return;
	      }
	      if (window.click360User?.status === 'tenant_configuration_invalid') {
	        clearInvitationIntent({ cleanUrl: true });
	        loginGateMessage('La configuración de esta cuenta no coincide con el tenant seguro. No se cargó ni modificó información.', 'AUTH_ACCESS_REJECTED', ACCESS_UI_STATES.BLOCKED, { accountStatus: window.click360User.status });
	        return;
	      }
	      if (window.click360User?.status === 'worker_module_upgrade') {
	        clearInvitationIntent({ cleanUrl: true });
	        loginGateMessage('El acceso de trabajadores está temporalmente pausado mientras terminamos la protección independiente de cada módulo. El negocio del propietario permanece intacto.', 'AUTH_APPROVED_USERS_REJECTED', ACCESS_UI_STATES.PENDING, { accountStatus: window.click360User.status });
	        return;
	      }
	      if (['worker_boundary_not_assigned', 'worker_boundary_not_ready'].includes(window.click360User?.status)) {
	        clearInvitationIntent({ cleanUrl: true });
	        loginGateMessage(
	          window.click360User.status === 'worker_boundary_not_assigned'
	            ? 'La invitación todavía no está asociada a un negocio modular verificado.'
	            : 'El negocio todavía no completó el corte modular seguro. El snapshot legacy permanece intacto.',
	          'AUTH_APPROVED_USERS_REJECTED', ACCESS_UI_STATES.PENDING,
	          { accountStatus:window.click360User.status }
	        );
	        return;
	      }

	      // An invitation is considered only when its form was explicitly submitted
	      // in this browser session. Stale URL parameters can never pre-empt login.
	      let invitationWarning = '';
	      if (publicIntent === 'invite' && readExplicitInvitationIntent()) {
	        try {
	          const invitation = await acceptInvitationFromUrl(user, epoch);
	          if (!isCurrentAuthEpoch(user, epoch)) return;
	          if (invitation.accepted) {
	            approved = await isApprovedUser(user, epoch);
	            if (approved && isCurrentAuthEpoch(user, epoch)) {
	              await enterApprovedApp(user, epoch);
	              return;
	            }
	            if (window.click360User?.status === 'worker_module_upgrade') {
	              showGate('La invitación quedó registrada, pero el acceso operativo de trabajadores está temporalmente pausado hasta completar la protección independiente de cada módulo.', ACCESS_UI_STATES.PENDING, { reason: 'worker_module_upgrade' });
	              return;
	            }
	            invitationWarning = 'La invitación se aceptó, pero no pudimos terminar de abrir el negocio. Intenta iniciar sesión nuevamente.';
	          }
	        } catch (error) {
	          console.warn('Invitación rechazada:', error.code || error.message);
	          invitationWarning = 'La invitación no es válida o ya no está disponible. Puedes iniciar sesión normalmente, registrarte o solicitar una nueva.';
	          clearInvitationIntent({ cleanUrl: true });
	          setPublicAuthIntent('login');
	        }
	      } else if (currentInvitationParams().flow === 'invite') {
	        clearInvitationIntent({ cleanUrl: true });
	        setPublicAuthIntent('login');
	      }

	      const trialRequested = window.CLICK360_V16_DOMAIN?.publicIntentAllowsTrialCreation(publicIntent) === true;
	      if (trialRequested && account.status === 'not_found' && APPROVED_LOOKUP_STATUS === 'not_found') {
	        const createdAccount = await resolveAccountAccess(user, epoch, { allowCreate: true, intent: publicIntent });
	        if (!isCurrentAuthEpoch(user, epoch)) return;
	        if (createdAccount.status === 'ready' && createdAccount.state?.allowed && applyAccountAccessIdentity(user, createdAccount, epoch)) {
	          await enterApprovedApp(user, epoch);
	          return;
	        }
	        showGate('No pudimos preparar la prueba en este momento. No se creó ni modificó ningún negocio; revisa tu conexión e inténtalo otra vez.', ACCESS_UI_STATES.RECOVERABLE_ERROR, { reason: createdAccount.status || 'trial_bootstrap_failed' });
	        return;
	      }
	      if (trialRequested && (window.click360User?.hasApprovedRecord || APPROVED_LOOKUP_STATUS === 'record_found')) {
	        showPending(user);
	        return;
	      }
	      if (trialRequested && (account.status !== 'not_found' || APPROVED_LOOKUP_STATUS !== 'not_found')) {
	        showGate('No pudimos confirmar todavía si esta cuenta ya tuvo acceso. Para proteger tus datos, no se creó una prueba nueva. Revisa la conexión e inténtalo otra vez.', ACCESS_UI_STATES.IDENTITY_RECONCILIATION_REQUIRED, { reason: 'trial_identity_unconfirmed' });
	        return;
	      }

	      if (invitationWarning) {
	        showGate(invitationWarning, ACCESS_UI_STATES.INVALID_INVITATION, { reason: 'invalid_invitation' });
	      } else if (window.click360User?.hasApprovedRecord) {
	        showPending(user);
	      } else if (['network_error', 'permission_denied', 'recoverable_error'].includes(account.status)) {
	        const message = account.status === 'permission_denied'
	          ? 'No pudimos verificar el permiso de esta cuenta. No se cargaron datos; vuelve a intentarlo o cambia de cuenta.'
	          : 'No pudimos verificar la cuenta por un problema temporal de conexión. Vuelve a intentarlo sin crear datos nuevos.';
	        const code = account.status === 'permission_denied'
	          ? 'FIRESTORE_PERMISSION_DENIED'
	          : account.status === 'network_error'
	            ? 'AUTH_ACCOUNT_ACCESS_REJECTED'
	            : 'UNKNOWN_LOGIN_GATE_FAILURE';
	        loginGateMessage(message, code, ACCESS_UI_STATES.RECOVERABLE_ERROR, { accountStatus: account.status, firestoreCode: account.errorCode || '' });
	      } else {
	        loginGateMessage('No encontramos una cuenta activa con este Google. Puedes probar gratis, registrarte o cambiar de cuenta.', 'AUTH_ACCOUNT_NOT_FOUND', ACCESS_UI_STATES.AUTHENTICATED_NO_ACCESS, { accountStatus: account.status });
	      }
	    });
  }

  boot();
})();
