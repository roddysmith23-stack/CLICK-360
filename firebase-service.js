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

  // Programmatically clear old caches if needed
  const APP_ASSET_VERSION = 'mvp-launch-v16-1-1-r1';
  const CURRENT_CACHE_KEY = `click360-${APP_ASSET_VERSION}`;
  const CLICK360_CACHE_PREFIX = 'click360-';
  try {
    if ('caches' in window) {
      caches.keys().then(keys => {
        keys.forEach(key => {
          if (key.startsWith(CLICK360_CACHE_PREFIX) && key !== CURRENT_CACHE_KEY) {
            caches.delete(key).catch(() => {});
          }
        });
      }).catch(err => console.warn("Error al obtener llaves de caché:", err));
    }
  } catch(cacheErr) {
    console.warn("Cachés no accesibles en este entorno:", cacheErr);
  }

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
  let AUTH_EPOCH = 0;
	  const tenantGuard = window.CLICK360_P0_TENANT_GUARD.createSyncGate();

  let AUTH_APPROVED = false;
  let PULL_COMPLETE = false;
  let IS_RESTORING_REMOTE = false;
  let INITIAL_TENANT_SEED_REQUIRED = false;
  let REMOTE_UNSUBSCRIBE = null;
  let USER_STATUS_UNSUBSCRIBE = null;
	  let ACCESS_UNSUBSCRIBE = null;
	  let ACCESS_READ_ONLY = false;
	  let ACCESS_EXPIRY_TIMER = null;
	  let LOCAL_WRITE_PENDING_UNTIL = 0;
	  let LAST_REMOTE_REVISION = 0;
	  const PUSH_SCHEDULERS = new Map();
		  let SYNC_CONFLICT_PENDING = false;
		  let ONLINE_ONLY_SAFE = false;

	  const rawSetItem = localStorage.setItem.bind(localStorage);
	  const PROFILE_CACHE_PREFIX = "CLICK360:V16:PROFILE:";
	  const PROFILE_PENDING_PREFIX = 'CLICK360:V16:PROFILE_PENDING:';
	  const LEGACY_PROFILE_CACHE_PREFIX = "CLICK360_USER_PROFILE_";
	  const LEGACY_PROFILE_PENDING_PREFIX = 'CLICK360_PROFILE_PENDING:';
	  const LEGACY_STATE_LS_KEY = 'click360_mvp_qa_final_state_v1';
	  const DEVICE_ID_PREFIX = "CLICK360:V16:DEVICE:";
	  const APPROVED_IDENTITY_PREFIX = "CLICK360:V16:APPROVED:";
	  const LEGACY_APPROVED_IDENTITY_PREFIX = "CLICK360_APPROVED_IDENTITY:";
	  const ACCOUNT_ACCESS_COLLECTION = 'accountAccess';
		  const TRIAL_DAYS = 7;
		  const PUBLIC_INTENT_KEY = 'CLICK360:V16_1:PUBLIC_INTENT';
		  const PUBLIC_INTENTS = new Set(['login', 'trial', 'register', 'invite']);
		  let PUBLIC_AUTH_INTENT = null;
		  let AUTH_REQUEST_IN_FLIGHT = false;
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
	    return {
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
	  }
	  function publishAccessState(next = {}) {
	    const state = Object.freeze({
	      mode: next.mode || 'founder',
	      plan: next.plan || 'founder',
	      readOnly: next.readOnly === true,
	      trialEndsAtMs: Number(next.trialEndsAtMs || 0),
	      expiresAtMs: Number(next.expiresAtMs || 0),
	      serverNowMs: Number(next.serverNowMs || 0),
	      source: next.source || 'approvedUsers'
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
	      enterEntitlementReadOnly();
	      return false;
	    }
	    try {
	      const ref = accountAccessRef(user.uid);
	      await ref.update({ lastSeenAt: firebase.firestore.FieldValue.serverTimestamp() });
	      const snap = await ref.get({ source: 'server' });
	      if (!isCurrentAuthEpoch(user, expectedEpoch) || !snap.exists) return false;
	      const next = accessStateFromData(snap.data() || {});
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
		  window.click360CanMutate = () => AUTH_APPROVED && !ACCESS_READ_ONLY && !legacyMigrationRequired()
		    && tenantGuard.canWrite(ACTIVE_CONTEXT) && (!ONLINE_ONLY_SAFE || navigator.onLine);
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
	  function markSyncConflict(details = {}) {
	    SYNC_CONFLICT_PENDING = true;
	    safeStorageSet(syncConflictMarkerKey(), '1');
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
	      && !!STATE_DOC;
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
		  function readPublicAuthIntent() {
		    const fromUrl = new URLSearchParams(location.search).get('flow');
		    if (PUBLIC_INTENTS.has(fromUrl)) return fromUrl;
		    if (PUBLIC_INTENTS.has(PUBLIC_AUTH_INTENT)) return PUBLIC_AUTH_INTENT;
		    try {
		      const stored = sessionStorage.getItem(PUBLIC_INTENT_KEY);
		      return PUBLIC_INTENTS.has(stored) ? stored : 'login';
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
		  const TELEMETRY_EVENTS = new Set([
		    'login', 'bootstrap', 'cache_failure', 'online_only', 'sync', 'plan_request',
		    'invitation', 'cash_open', 'cash_close', 'template_save_failure'
		  ]);
		  const TELEMETRY_ONCE = new Set();
		  async function recordTelemetry(eventType, details = {}) {
		    const user = auth.currentUser;
		    const context = ACTIVE_CONTEXT;
		    if (!user || !TELEMETRY_EVENTS.has(eventType)) return false;
		    const businessId = context?.businessId || user.uid;
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
		      businessId,
		      tenantKey,
		      appVersion: '16.0.0',
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
	    if (AUTH_APPROVED && PULL_COMPLETE && STATE_DOC) pushLocalToFirestore("online_reconnect").catch(() => {});
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
	    if (!cached || !window.click360User) return;
	    const pending = safeJsonParse(safeStorageGet(`${PROFILE_PENDING_PREFIX}${user.uid}`))
	      || safeJsonParse(safeStorageGet(`${LEGACY_PROFILE_PENDING_PREFIX}${user.uid}`));
	    const localWins = pending?.uid === user.uid
	      || profileUpdatedAtMs(cached.updatedAt) >= profileUpdatedAtMs(remoteData.updatedAt);
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
	      updatedAt: remoteData.updatedAt?.toDate?.().toISOString?.() || remoteData.updatedAt || new Date().toISOString()
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
	  function applyApprovedIdentity(user, data, source = "remote", expectedEpoch = AUTH_EPOCH) {
	    if (!isCurrentAuthEpoch(user, expectedEpoch)) return false;
	    const ownerId = data.ownerId || user.uid;
	    const allowedRoles = ['owner', 'worker', 'cashier', 'inventory'];
	    const role = allowedRoles.includes(data.role)
	      ? data.role
	      : ((data.isOwner === true || ownerId === user.uid) ? 'owner' : null);
	    if (!role || (role === 'owner' && ownerId !== user.uid) || (role !== 'owner' && ownerId === user.uid)) return false;
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
	    SYNC_CONFLICT_PENDING = safeStorageGet(syncConflictMarkerKey()) === '1';
	    if (typeof window.click360SetTenantContext !== "function") {
	      throw new Error("La interfaz segura todavía no está lista.");
	    }
	    // The remote V10 document is authoritative. Do not hydrate a local cache
	    // before it has been read and its identity validated.
	    window.click360SetTenantContext(ACTIVE_CONTEXT, { deferLocalLoad: true });
	    window.click360User.access = publishAccessState({ mode: 'founder', plan: 'founder', source: source === 'offline_cache' ? 'approved_offline' : 'approvedUsers' });
	    cacheApprovedIdentity(user, window.click360User);
	    return true;
	  }

	  function snapshotString(obj) {
	    try { return JSON.stringify(obj || {}); } catch (e) { return "{}"; }
	  }

	  function buildBusinessPayload() {
	    if (!activeIdentityIsValid() || typeof window.click360GetTenantState !== "function") return null;
	    const state = window.click360GetTenantState();
	    if (!state || !sameTenant(state.identity)) return null;
	    const settings = state.settings || {};
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
	        notifications: Array.isArray(state.notifications) ? state.notifications : [],
	        legalAcceptances: Array.isArray(state.legalAcceptances) ? state.legalAcceptances : [],
	        settings: {
	          labelTemplates: Array.isArray(settings.labelTemplates) ? settings.labelTemplates : [],
	          workers: Array.isArray(settings.workers) ? settings.workers : [],
	          customers: Array.isArray(settings.customers) ? settings.customers : [],
	          reminders: Array.isArray(settings.reminders) ? settings.reminders : [],
	          onboarding: settings.onboarding && typeof settings.onboarding === 'object' ? settings.onboarding : {},
	          activationRequests: Array.isArray(settings.activationRequests) ? settings.activationRequests : [],
	          policies: settings.policies && typeof settings.policies === 'object' ? settings.policies : {},
	          legal: settings.legal && typeof settings.legal === 'object' ? settings.legal : {},
	          appVersion: '16.0.0'
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
	    const nextState = {
	      ...incoming,
	      identity: activeIdentity(),
	      // Per-user profile photos and names remain local to the authenticated uid.
	      settings: { ...(incoming.settings || {}), userProfiles: current.settings?.userProfiles || {} }
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
	    showGate(legacyMigrationMessage());
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
	    if (!inviteToken || !ownerId || !isCurrentAuthEpoch(user, expectedEpoch)) return false;
	    const computedHash = await window.CLICK360_V16_DOMAIN?.sha256(inviteToken);
		    const suppliedHash = currentParams.get('inviteHash') || computedHash;
	    if (!computedHash || suppliedHash !== computedHash) throw new Error('La invitacion no es valida.');
	    const invite = invitationRef(ownerId, computedHash);
	    const member = memberRef(ownerId, user.uid);
	    const approved = db.collection('approvedUsers').doc(user.uid);
	    const normalizedEmail = String(user.email || '').trim().toLowerCase();
	    await db.runTransaction(async (transaction) => {
	      const snapshot = await transaction.get(invite);
	      if (!snapshot.exists) throw new Error('La invitacion no existe o fue eliminada.');
	      const data = snapshot.data() || {};
	      if (data.ownerId !== ownerId || data.businessId !== ownerId || data.tenantKey !== tenantKeyFor(ownerId, ownerId) || data.inviteHash !== computedHash) throw new Error('La invitacion pertenece a otro negocio.');
	      if (String(data.email || '').toLowerCase() !== normalizedEmail) throw new Error('La invitacion fue emitida para otra cuenta de Google.');
	      if (data.status === 'accepted' && data.acceptedBy === user.uid) return;
	      if (data.status !== 'pending') throw new Error('La invitacion ya fue utilizada, revocada o expiro.');
	      const createdAtMs = data.createdAt?.toMillis?.() || 0;
	      if (!createdAtMs || Date.now() >= createdAtMs + Number(data.expiresAfterDays || 7) * 24 * 60 * 60 * 1000) throw new Error('La invitacion expiro. Solicita una nueva.');
	      const role = ['worker', 'cashier', 'inventory'].includes(data.role) ? data.role : 'worker';
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
	        acceptedAt: firebase.firestore.FieldValue.serverTimestamp(),
	        lastAccessAt: firebase.firestore.FieldValue.serverTimestamp()
	      };
	      transaction.set(member, memberData);
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
	    const cleanUrl = new URL(location.href);
		    ['invite', 'ownerId', 'inviteHash', 'inviteToken', 'token'].forEach((key) => cleanUrl.searchParams.delete(key));
		    history.replaceState({}, '', `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
		    recordTelemetryOnce(`invite-accept:${ownerId}:${computedHash}:${user.uid}`, 'invitation', { mode: 'accepted' });
		    return true;
	  }

  async function isApprovedUser(user, expectedEpoch = AUTH_EPOCH) {
    if (!isCurrentAuthEpoch(user, expectedEpoch)) return false;
    try {
      const doc = await db.collection('approvedUsers').doc(user.uid).get();
      if (!isCurrentAuthEpoch(user, expectedEpoch)) return false;
      let data = doc.exists ? (doc.data() || {}) : null;

      if (data?.status === 'blocked' || data?.status === 'revoked') {
        setPendingUser(user, data, data.status);
        return false;
      }

      if (!data && user.email) {
        const emailDoc = await db.collection('approvedUsersByEmail').doc(user.email.toLowerCase()).get().catch(() => null);
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
        }
      }

      if (isExplicitlyActive(data)) {
        if (data.businessId && data.businessId !== (data.ownerId || user.uid)) {
          setPendingUser(user, data, 'tenant_configuration_invalid');
          return false;
        }
        return applyApprovedIdentity(user, data, 'approvedUsers', expectedEpoch);
      }

      setPendingUser(user, data || {}, data?.status || 'pending');
      return false;
    } catch (error) {
      if (!isCurrentAuthEpoch(user, expectedEpoch)) return false;
      const cached = getCachedApprovedIdentity(user);
      if (cached && (!navigator.onLine || error.code === 'unavailable')) {
        const applied = applyApprovedIdentity(user, cached, 'offline_cache', expectedEpoch);
        if (applied) setSyncStatus('offline', 'Trabajando sin internet con la última aprobación guardada.');
        return applied;
      }
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

  function accessStateFromData(data = {}) {
    const serverNowMs = serverTimestampMs(data.lastSeenAt);
    const evaluator = window.CLICK360_V16_DOMAIN?.evaluateEntitlement;
    const evaluated = evaluator
      ? evaluator(data, serverNowMs)
      : window.CLICK360_P0_TENANT_GUARD.evaluateAccountAccess({
          status: data.status,
          plan: data.plan,
          planCode: data.planCode,
          trialStartedAtMs: serverTimestampMs(data.trialStartedAt)
        }, serverNowMs, TRIAL_DAYS);
    return { ...evaluated, serverNowMs, source: 'accountAccess', revision: Number(data.revision || 0) };
  }

	  async function resolveAccountAccess(user, expectedEpoch = AUTH_EPOCH, options = {}) {
    if (!isCurrentAuthEpoch(user, expectedEpoch) || !navigator.onLine) return null;
    const ref = accountAccessRef(user.uid);
    if (!ref) return null;
    try {
      let snap = await ref.get({ source: 'server' });
      if (!isCurrentAuthEpoch(user, expectedEpoch)) return null;
	      if (!snap.exists && options.allowCreate !== true) return null;
	      if (!snap.exists) {
        await db.runTransaction(async (transaction) => {
          const current = await transaction.get(ref);
          if (current.exists) return;
          transaction.set(ref, {
            uid: user.uid,
            businessId: user.uid,
            email: user.email || '',
            name: user.displayName || '',
            photoURL: window.CLICK360_P0_TENANT_GUARD.safeImageSrc(user.photoURL),
            status: 'trial',
            plan: 'normal',
            planCode: 'base',
            trialDays: TRIAL_DAYS,
            trialStartedAt: firebase.firestore.FieldValue.serverTimestamp(),
            lastSeenAt: firebase.firestore.FieldValue.serverTimestamp(),
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
	            source: 'self_service',
            entitlementVersion: 16,
            revision: 1
          });
        });
        snap = await ref.get({ source: 'server' });
	      } else {
	        await ref.update({ lastSeenAt: firebase.firestore.FieldValue.serverTimestamp() });
	        snap = await ref.get({ source: 'server' });
      }
      if (!isCurrentAuthEpoch(user, expectedEpoch) || !snap.exists) return null;
      return { data: snap.data() || {}, state: accessStateFromData(snap.data() || {}) };
    } catch (error) {
      console.warn('No se pudo resolver el acceso de cuenta:', error.message);
      return null;
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
	    SYNC_CONFLICT_PENDING = safeStorageGet(syncConflictMarkerKey()) === '1';
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
	      appVersion: '16.0.0'
	    });
	    recordTelemetry('plan_request', { requestId: requestRef.id, mode: plan }).catch(() => {});
	    return { requestId: requestRef.id, requestCode, plan, period, price, currency: 'USD' };
  };

  window.click360SaveLegalAcceptance = async function(acceptance = {}) {
    const user = auth.currentUser;
    if (!user || !ACTIVE_CONTEXT || user.uid !== ACTIVE_CONTEXT.authUid) throw new Error('Sesion no verificada.');
    const termsVersion = String(acceptance.termsVersion || window.CLICK360_V16_DOMAIN?.TERMS_VERSION || '2026-07-13');
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
        appVersion: '16.0.0'
      });
    });
    return { acceptanceId, termsVersion };
  };

  window.click360DebugAuth = function() {
    return {
      authenticated: !!auth.currentUser,
      approved: AUTH_APPROVED,
      tenantKey: ACTIVE_CONTEXT?.tenantKey || null,
      syncStatus: syncStatus.status
    };
  };
	  window.click360InviteWorkerEmail = async function(email, name, options = {}) {
	    if (!window.click360User || window.click360User.role !== 'owner' || auth.currentUser?.uid !== ACTIVE_CONTEXT?.authUid) throw new Error('No tienes permisos.');
	    const ownerId = window.click360User.uid;
	    const normalizedEmail = String(email || '').trim().toLowerCase();
	    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error('Correo de trabajador invalido.');
	    const role = ['worker', 'cashier', 'inventory'].includes(options.role) ? options.role : 'worker';
	    const permissions = options.permissions && typeof options.permissions === 'object' ? options.permissions : defaultWorkerPermissions(role);
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
	      tenantKey: tenantKeyFor(ownerId, ownerId),
	      status: 'pending',
	      expiresAfterDays: 7,
	      singleUse: true,
	      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
	      createdBy: ownerId,
	      appVersion: '16.0.0'
	    });
	    batch.set(secret, {
	      inviteHash,
	      token: inviteToken,
	      email: normalizedEmail,
	      ownerId,
	      createdAt: firebase.firestore.FieldValue.serverTimestamp()
		    });
		    await batch.commit();
		    recordTelemetry('invitation', { requestId: inviteHash, mode: 'created' }).catch(() => {});
		    return { inviteToken, inviteHash, ownerId, role, permissions, expiresAfterDays: 7 };
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

	  window.click360UpdateWorkerPermissions = async function(workerUid, inviteHash, role, permissions) {
	    if (!window.click360User || window.click360User.role !== 'owner') throw new Error('No tienes permisos.');
	    const ownerId = window.click360User.uid;
	    const nextRole = ['worker', 'cashier', 'inventory'].includes(role) ? role : 'worker';
	    const batch = db.batch();
	    batch.set(invitationRef(ownerId, inviteHash), { role: nextRole, permissions, updatedAt: firebase.firestore.FieldValue.serverTimestamp(), updatedBy: ownerId }, { merge: true });
	    if (workerUid) {
	      batch.set(memberRef(ownerId, workerUid), { role: nextRole, permissions, updatedAt: firebase.firestore.FieldValue.serverTimestamp(), updatedBy: ownerId }, { merge: true });
	      batch.set(db.collection('approvedUsers').doc(workerUid), { role: nextRole, permissions, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
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
	    if (!hash && email) {
	      const found = await db.collection('businesses').doc(ownerId).collection('invitations').where('email', '==', String(email).toLowerCase()).limit(1).get();
	      hash = found.docs[0]?.id || '';
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
	    }
	    if (!writes) throw new Error('No se encontro una invitacion ni una cuenta para revocar.');
	    await batch.commit();
	    return true;
	  };

	  function syncError(code, message, details = {}) {
	    const error = new Error(message);
	    error.code = code;
	    error.details = details;
	    return error;
	  }

	  async function pushLocalToFirestoreOnce(reason = 'auto') {
	    const user = auth.currentUser;
	    const context = ACTIVE_CONTEXT;
	    const stateDoc = STATE_DOC;
	    const expectedEpoch = AUTH_EPOCH;
	    if (legacyMigrationRequired()) {
	      setSyncStatus('migration_required', legacyMigrationMessage());
	      return false;
	    }
	    if (SYNC_CONFLICT_PENDING) {
	      setSyncStatus('error', 'Hay un conflicto pendiente. Descarga o respalda los datos antes de volver a sincronizar.');
	      return false;
	    }
	    if (!isActiveSyncScope(context, stateDoc, expectedEpoch, user) || !AUTH_APPROVED || ACCESS_READ_ONLY || IS_RESTORING_REMOTE || !PULL_COMPLETE || !tenantGuard.canWrite(context)) return false;
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
	    if (payloadBytes > MAX_CLOUD_PAYLOAD_BYTES) {
	      setSyncStatus('error', `Los datos ocupan ${Math.ceil(payloadBytes / 1024)} KB y superan el límite seguro de sincronización. Reduce imágenes antes de continuar.`);
	      return false;
	    }

	    const expectedRevision = Number(LAST_REMOTE_REVISION || 0);
	    const documentData = buildV10StateDocument(payload, reason);
	    let existingInitialRemote = null;
	    setSyncStatus('syncing', 'Guardando cambios en Firestore.', { reason });

	    try {
	      const wrote = await window.CLICK360_P0_TENANT_GUARD.guardedWrite(tenantGuard, context, async () => {
	        await db.runTransaction(async (transaction) => {
	          if (!isActiveSyncScope(context, stateDoc, expectedEpoch, user)) throw syncError('click360/stale-auth', 'La cuenta cambió antes de sincronizar.');
	          const current = await transaction.get(stateDoc);
	          if (!isActiveSyncScope(context, stateDoc, expectedEpoch, user)) throw syncError('click360/stale-auth', 'La cuenta cambió durante la sincronización.');
	          if (!current.exists) {
	            if (expectedRevision !== 0) throw syncError('click360/revision-conflict', 'El documento remoto fue reemplazado.', { expectedRevision, remoteRevision: null });
	          } else {
	            const remote = current.data() || {};
	            const remoteRevision = Number(remote.revision || remote.updatedAtMs || 0);
	            if (!remoteMatchesContext(remote, context)) throw syncError('click360/remote-identity', 'La identidad remota no coincide.', { remoteRevision });
	            if (reason === 'initial_tenant_seed' && expectedRevision === 0) {
	              existingInitialRemote = remote;
	              return;
	            }
	            if (remoteRevision !== expectedRevision) throw syncError('click360/revision-conflict', 'Hay cambios remotos sin resolver.', { expectedRevision, remoteRevision });
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
	        safeStorageSet(tenantStorageKeyFor(context, 'LAST_APPLIED_REMOTE_HASH'), snapshotString(existingInitialRemote.payload));
	        safeStorageSet(tenantStorageKeyFor(context, 'REMOTE_REVISION'), String(existingRevision));
	        LAST_REMOTE_REVISION = existingRevision;
	        LOCAL_WRITE_PENDING_UNTIL = 0;
	        setSyncStatus('synced', 'El negocio ya existia y fue cargado sin sobrescribirlo.', { reason: 'initial_tenant_existing', revision: existingRevision });
	        return true;
	      }
	      const hash = snapshotString(payload);
	      safeStorageSet(tenantStorageKeyFor(context, 'LAST_APPLIED_REMOTE_HASH'), hash);
	      safeStorageSet(tenantStorageKeyFor(context, 'REMOTE_REVISION'), String(documentData.revision));
	      LAST_REMOTE_REVISION = documentData.revision;
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

	  async function pushLocalToFirestore(reason = 'auto') {
	    const context = ACTIVE_CONTEXT;
	    const schedulerKey = context ? `${AUTH_EPOCH}:${context.authUid}:${context.tenantKey}` : '';
	    if (!schedulerKey) return false;
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
	    })();
	    PUSH_SCHEDULERS.set(schedulerKey, scheduler);
	    try { return await scheduler.promise; }
	    finally { PUSH_SCHEDULERS.delete(schedulerKey); }
	  }

		  async function pullRemoteOnce({ force = false, reload = false } = {}) {
	    const user = auth.currentUser;
	    const context = ACTIVE_CONTEXT;
	    const stateDoc = STATE_DOC;
	    const expectedEpoch = AUTH_EPOCH;
	  try {
	    if (!isActiveSyncScope(context, stateDoc, expectedEpoch, user)) return false;
		    let localCacheStatus = window.click360GetTenantCacheStatus?.(context) || { valid: false, reason: 'cache_status_unavailable' };
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
	      setSyncStatus('syncing', 'Leyendo datos de Firestore.');
	      const snap = await stateDoc.get({ source: 'server' });
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
	    const localPayload = buildBusinessPayload();
	    const localHash = snapshotString(localPayload);
	    const alreadyApplied = safeStorageGet(tenantStorageKey('LAST_APPLIED_REMOTE_HASH'));
	    const remoteMustHydrate = window.click360IsTenantStateDeferred?.() === true;
    // A deferred context has not loaded any tenant cache yet. The verified V10
    // remote snapshot is authoritative in that first hydration, even if an old
    // device cache has stale pending metadata. Otherwise a seed could render
    // while the actual remote data remained protected but unapplied.
    const localChanged = !remoteMustHydrate && localCacheStatus.valid === true && (
	      Date.now() < LOCAL_WRITE_PENDING_UNTIL
	      || !alreadyApplied
	      || localHash !== alreadyApplied
	    );

	      INITIAL_TENANT_SEED_REQUIRED = false;
	      LAST_REMOTE_REVISION = remoteRevision;
	      safeStorageSet(tenantStorageKey('REMOTE_REVISION'), String(remoteRevision));
	      tenantGuard.allow(context);
	      PULL_COMPLETE = true;
	    if (force || remoteMustHydrate || (remoteHash && remoteHash !== localHash && remoteHash !== alreadyApplied)) {
	      if (localChanged && !force) {
	          markSyncConflict({ path: stateDoc.path, remoteRevision, localUpdatedAtMs: localPayloadUpdatedAtMs(), source: 'pull' });
	          setSyncStatus('error', 'Hay cambios locales y remotos simultáneos. No se sobrescribió ninguna versión.');
	          return false;
	        }
		        applyRemotePayload(remotePayload);
	        safeStorageSet(tenantStorageKey('LAST_APPLIED_REMOTE_HASH'), remoteHash);
	        if (force) clearSyncConflict();
		        const storageMode = window.click360GetStorageState?.().mode;
		        setSyncStatus(storageMode === 'online_only_safe' ? 'online_only_safe' : 'synced', storageMode === 'online_only_safe'
		          ? 'Tus datos estan seguros en la nube. Este dispositivo no pudo activar el modo sin conexion.'
		          : 'Datos actualizados desde la nube.', { revision: remoteRevision });
	        if (window.click360ReloadState) window.click360ReloadState();
	        if (reload && window.click360Route) window.click360Route(window.location.hash.replace('#','') || 'home');
	      return true;
	    }
	    if (force || remoteHash === localHash) clearSyncConflict();
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

	      const remoteData = snap.data() || {};
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
	        showGate('Se detectó un cambio remoto de otra cuenta. La operación fue bloqueada para proteger los datos.');
	        return;
	      }
	      const remotePayload = remoteData.payload;
	      LAST_REMOTE_REVISION = Number(remoteData.revision || remoteData.updatedAtMs || LAST_REMOTE_REVISION || 0);
	      safeStorageSet(tenantStorageKey("REMOTE_REVISION"), String(LAST_REMOTE_REVISION || 0));
	      const remoteHash = snapshotString(remotePayload);
      const localHash = snapshotString(buildBusinessPayload());
      const lastApplied = safeStorageGet(tenantStorageKey("LAST_APPLIED_REMOTE_HASH"));

	      if (remoteHash && remoteHash !== "{}" && remoteHash !== localHash && remoteHash !== lastApplied && !IS_RESTORING_REMOTE) {
	        if (Date.now() < LOCAL_WRITE_PENDING_UNTIL) {
	          markSyncConflict({ path: stateDoc.path, remoteRevision: LAST_REMOTE_REVISION, localUpdatedAtMs: localPayloadUpdatedAtMs(), source: 'listener' });
	          setSyncStatus('error', 'Se detectaron cambios simultáneos. No se sobrescribió ninguna versión.');
	          return;
	        }
	        applyRemotePayload(remotePayload);
	        safeStorageSet(tenantStorageKey("LAST_APPLIED_REMOTE_HASH"), remoteHash);
	        setSyncStatus("synced", "Cambios remotos aplicados.", { revision: LAST_REMOTE_REVISION });
	        console.log("CLICK360 recibió cambios remotos.");

        if (window.click360ReloadState) window.click360ReloadState();

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
	    }, (err) => {
	      if (!isActiveSyncScope(context, stateDoc, expectedEpoch, user)) return;
	      console.warn("No se pudo escuchar cambios remotos:", err.message);
	      setSyncStatus(navigator.onLine ? "error" : "offline", err.message || "No se pudo escuchar la nube.");
	    });
	  }

	  function showGate(message = "Inicia sesión con Google para continuar.") {
    setAppBlocked(true);

    let gate = document.getElementById("click360-auth-gate");
    if (!gate) {
      gate = document.createElement("div");
      gate.id = "click360-auth-gate";
      gate.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:#050505;color:white;display:flex;align-items:center;justify-content:center;font-family:Arial,sans-serif;padding:clamp(14px,3vw,32px);box-sizing:border-box;overflow:auto;";
	      gate.innerHTML = `
	        <div class="c360-gate-shell">
	          <section class="c360-gate-hero" aria-label="CLICK 360">
	            <div class="c360-gate-brand"><span>CLICK</span> 360 <small>V16.1.1</small></div>
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
	              <article><b>Base</b><strong>$40 / mes</strong><span>Inventario, ventas, caja, clientes, reportes y etiquetas QR.</span><a href="https://wa.me/593969399562?text=Hola%2C%20quiero%20activar%20CLICK%20360%20Base" target="_blank" rel="noopener noreferrer">Elegir Base</a></article>
	              <article><b>Pro</b><strong>$59,99 / mes</strong><span>Todo Base, más trabajadores, recordatorios y herramientas avanzadas.</span><a href="https://wa.me/593969399562?text=Hola%2C%20quiero%20activar%20CLICK%20360%20Pro" target="_blank" rel="noopener noreferrer">Elegir Pro</a></article>
	            </div>
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
	              <details><summary>¿Cómo agrego trabajadores?</summary><p>El propietario crea una invitación desde la sección Trabajadores.</p></details>
	              <details><summary>¿Puedo imprimir etiquetas QR?</summary><p>Sí. Puedes diseñar, guardar e imprimir etiquetas para tus productos.</p></details>
	            </div>
	            <button id="c360-change-google" class="c360-change-button" style="display:none;">Cambiar cuenta / Cerrar sesión</button>
	            <button id="c360-clear-cache" class="c360-cache-button" style="display:none;">Actualizar archivos de la app</button>
	            <p class="c360-auth-legal">Al continuar aceptas los <button id="c360-public-terms">Términos</button> y la <button id="c360-public-privacy">Política de privacidad</button>.</p>
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
	        document.getElementById('c360-invite-value').focus();
	      };
	      document.getElementById('c360-invite-cancel').onclick = () => { document.getElementById('c360-invite-form').hidden = true; };
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
	        params.set('flow', 'invite');
	        params.set('ownerId', ownerId);
	        params.set('inviteToken', inviteToken);
	        history.replaceState({}, '', `${location.pathname}?${params.toString()}${location.hash}`);
	        beginPublicAuth('invite');
	      };
      document.getElementById("c360-show-plans").onclick = () => {
        const plans = document.getElementById('c360-public-plans');
        plans.hidden = !plans.hidden;
      };
      document.getElementById('c360-public-terms').onclick = () => showPublicLegal('terms');
      document.getElementById('c360-public-privacy').onclick = () => showPublicLegal('privacy');
      document.getElementById("c360-change-google").onclick = async () => {
        if(window.click360Logout) await window.click360Logout();
        else {
           await auth.signOut();
           location.reload();
        }
      };

      document.getElementById("c360-clear-cache").onclick = async () => {
        const btn = document.getElementById("c360-clear-cache");
        btn.textContent = "Actualizando...";
        btn.disabled = true;
        try {
	          if ('serviceWorker' in navigator) {
	            const registration = await navigator.serviceWorker.getRegistration();
	            if (registration) await registration.unregister();
	          }
	          if ('caches' in window) {
	            const keys = await caches.keys();
	            for (let key of keys) {
	              if (key.startsWith(CLICK360_CACHE_PREFIX)) await caches.delete(key);
	            }
          }
          // Asset caches are disposable; tenant data and sign-in state are not.
          window.location.reload(true);
        } catch (e) {
          alert("Error al limpiar caché: " + e.message);
          btn.textContent = "Actualizar archivos de la app";
          btn.disabled = false;
        }
      };
    }

    const msg = document.getElementById("c360-auth-msg");
    if (msg) msg.innerHTML = message;

    // Show/hide buttons dynamically based on verification vs waiting state
    const loginBtn = document.getElementById("c360-google-login");
    const changeBtn = document.getElementById("c360-change-google");
    const clearBtn = document.getElementById("c360-clear-cache");
	    const publicActions = ['c360-google-login', 'c360-trial-login', 'c360-register-login', 'c360-invite-login', 'c360-show-plans']
	      .map((id) => document.getElementById(id)).filter(Boolean);

	    if (message.includes("Inicia sesión") || message.includes("pendiente") || message.includes("bloqueada") || message.includes("aprobaron") || message.includes("No encontramos una cuenta")) {
	      const hasAuthenticatedUser = !!auth.currentUser;
	      const initialLogin = message.includes("Inicia sesión") || message.includes("No encontramos una cuenta");
	      if (loginBtn) loginBtn.style.display = initialLogin ? "inline-flex" : "none";
      if (changeBtn) changeBtn.style.display = hasAuthenticatedUser ? "block" : "none";
      if (clearBtn) clearBtn.style.display = !initialLogin && hasAuthenticatedUser ? "block" : "none";
      if (message.includes("bloqueada")) {
        if (loginBtn) loginBtn.style.display = "none";
      }
	      publicActions.forEach((button) => { button.style.display = initialLogin ? '' : 'none'; });
    } else {
      if (loginBtn) loginBtn.style.display = "none";
      if (changeBtn) changeBtn.style.display = "none";
      if (clearBtn) clearBtn.style.display = "none";
      publicActions.forEach((button) => { button.style.display = 'none'; });
    }
  }

	  function showPublicLegal(kind) {
    const title = kind === 'privacy' ? 'Política de privacidad' : 'Términos y condiciones';
    const body = kind === 'privacy'
	      ? 'CLICK 360 usa los datos necesarios para autenticar, sincronizar y operar el negocio. Cada cuenta conserva su información separada. No vendemos información personal.'
      : 'CLICK 360 es una herramienta de gestión. El comercio es responsable de revisar sus políticas y obligaciones legales. Los datos pueden exportarse y se conservan al terminar una prueba.';
    const message = document.getElementById('c360-auth-msg');
    if (message) message.innerHTML = `<b>${title}</b><br>${body}<br><small>Versión 2026-07-13</small>`;
  }

  function embeddedBrowser() {
    const ua = navigator.userAgent || '';
    const embedded = /FBAN|FBAV|Instagram|WhatsApp|Line\/|; wv\)|\bwv\b|ChatGPT/i.test(ua) || window.top !== window.self;
    return { embedded, isAndroid: /Android/i.test(ua), isIOS: /iPhone|iPad|iPod/i.test(ua) };
  }

  function showPending(user) {
    showGate(`
      Tu cuenta (<b>${escapeHtml(user.email || "sin email")}</b>) está pendiente de aprobación.<br><br>
      UID de usuario: <code style="background: #222; padding: 4px 8px; border-radius: 4px; color: #ff9f43; font-family: monospace; font-size: 13px; display: inline-block; margin: 4px 0; user-select: all;">${escapeHtml(user.uid)}</code><br><br>
      Por favor, dile a tu administrador que apruebe tu acceso usando este UID en Firestore.
    `);

    const loginBtn = document.getElementById("c360-google-login");
    if(loginBtn) {
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

    const gate = document.getElementById("click360-auth-gate");

    try {
      if(window.click360Route) {
         const currentRoute = window.location.hash.replace('#','') || 'home';
         window.click360Route(currentRoute);
      }
      if (gate) gate.remove();
    } catch(e) {
      console.error("Error durante unlockApp:", e);
      const msg = document.getElementById("c360-auth-msg");
      const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      if (msg) {
        msg.innerHTML = `<span style="color:#ff4444; font-weight:bold;">Error de Inicio: ${esc(e.message)}</span><br><br><pre style="text-align:left; background:#111; padding:8px; border-radius:8px; font-size:11px; overflow-x:auto; max-height:200px; color:#ff8888; font-family:monospace; margin:0;">${esc(e.stack || '')}</pre>`;
      } else {
        alert("Error de Inicio: " + e.message);
      }
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
      if (auth.currentUser) await auth.signOut();
      return signInGoogle();
    };
    Promise.resolve(selectGoogleAccount()).finally(() => {
      AUTH_REQUEST_IN_FLIGHT = false;
      document.querySelectorAll('.c360-gate-actions button, .c360-public-plans button').forEach((button) => { button.disabled = false; });
    });
  }

  function signInGoogle() {
    const msg = document.getElementById("c360-auth-msg");
    const isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const browser = embeddedBrowser();

    if (browser.embedded) {
      const directUrl = `${location.origin}${location.pathname}${location.search}${location.hash}`;
      const androidIntent = `intent://${location.host}${location.pathname}${location.search}${location.hash}#Intent;scheme=https;package=com.android.chrome;end`;
      if (msg) msg.innerHTML = `<b>Abre CLICK 360 en tu navegador.</b><br>Este navegador interno no permite un inicio de sesión Google seguro.<br><br><a class="c360-open-browser" href="${escapeHtml(browser.isAndroid ? androidIntent : directUrl)}" target="_blank" rel="noopener noreferrer">${browser.isAndroid ? 'Abrir en Chrome' : 'Abrir en Safari'}</a>`;
      return Promise.resolve(false);
    }

    if (isIOS && isStandalone) {
      if (msg) {
        msg.innerHTML = `<div style="text-align:left; padding:12px; background:rgba(214,170,44,0.1); border:1px solid var(--gold); border-radius:16px; font-size:13px; line-height:1.4; color:var(--text);">
          <b>Nota para iPhone (PWA):</b><br>
          Debido a restricciones de seguridad de iOS en apps de pantalla de inicio, por favor:<br><br>
          1. Abre el navegador <b>Safari</b> normal.<br>
          2. Ve a <b>roddysmith23-stack.github.io/CLICK-360</b> e inicia sesión con tu cuenta.<br>
          3. Una vez iniciada sesión en Safari, vuelve a abrir esta app desde tu pantalla de inicio.
        </div>`;
      }
      return Promise.resolve(false);
    }

    if (msg) msg.textContent = "Abriendo Google...";

	    return auth.signInWithPopup(providerGoogle()).catch(err => {
	      console.warn("Popup falló:", err.message);
	      console.warn('[CLICK360_TELEMETRY]', { eventType: 'login_failure', errorCode: String(err.code || 'unknown').slice(0, 80), appVersion: '16.1.1' });
      if (err.code === 'auth/popup-blocked') {
        if (msg) msg.innerHTML = "Tu navegador bloqueó la ventana de Google.<br>Por favor, <b>permite las ventanas emergentes</b> o intenta desde Chrome/Safari normal.";
      } else if (err.code === 'auth/operation-not-supported-in-this-environment') {
        if (msg) msg.textContent = "Redireccionando a Google...";
        auth.signInWithRedirect(providerGoogle());
      } else if (err.code !== 'auth/popup-closed-by-user') {
        if (msg) msg.innerHTML = "Error al iniciar sesión con Google. Intenta abrir la app directamente desde Safari o Chrome.<br><br>Error: " + escapeHtml(err.message);
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

  const debouncedSync = debounce(() => pushLocalToFirestore("local_change"), 1200);

	  window.addEventListener('click360-local-state-saved', (event) => {
	    if (!IS_RESTORING_REMOTE && AUTH_APPROVED && PULL_COMPLETE
	      && event.detail?.tenantKey === ACTIVE_CONTEXT?.tenantKey) {
	      LOCAL_WRITE_PENDING_UNTIL = Date.now() + 6000;
	      setSyncStatus(navigator.onLine ? "pending" : "offline", navigator.onLine ? "Cambio local pendiente de nube." : "Cambio local guardado sin internet.");
	      debouncedSync();
	    }
	  });

  // Sync when user returns to the app (tab/app switch)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && AUTH_APPROVED && PULL_COMPLETE && STATE_DOC) {
      pullRemoteOnce({ force: false, reload: true }).catch(() => {});
    } else if (document.visibilityState === "hidden" && AUTH_APPROVED && PULL_COMPLETE) {
      pushLocalToFirestore("visibility_hidden").catch(() => {});
    }
  });

	  window.click360SyncNow = () => pushLocalToFirestore("manual");
	  window.click360RefreshNow = () => pullRemoteOnce({ force: true, reload: true });
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
	    window.click360AccessState = null;
	    BUSINESS_ID = null;
	    STATE_DOC = null;
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
    showGate("Inicia sesión con Google para continuar.");
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
	        showGate(`
	          ${identityChanged ? 'La configuración de tu acceso cambió y debe verificarse de nuevo.' : 'Tu acceso a CLICK 360 fue revocado o bloqueado.'}<br><br>
	          UID de usuario: <code style="background:#222;padding:4px 8px;border-radius:4px;color:#ff9f43;font-family:monospace;font-size:13px;display:inline-block;margin:4px 0;user-select:all;">${escapeHtml(user.uid)}</code>
	        `);
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
      const next = snap.exists ? accessStateFromData(snap.data() || {}) : { allowed: false, mode: 'pending', readOnly: true };
      if (!next.allowed) {
        AUTH_APPROVED = false;
        PULL_COMPLETE = false;
        if (REMOTE_UNSUBSCRIBE) { REMOTE_UNSUBSCRIBE(); REMOTE_UNSUBSCRIBE = null; }
        showGate('Tu acceso de prueba o plan ya no está activo. Contacta a CLICK 360 para continuar.');
        return;
      }
	      window.click360User.access = publishAccessState(next);
	      scheduleAccessExpiry(user, window.click360User.access, expectedEpoch);
      if (next.readOnly) setSyncStatus('read_only', 'La prueba terminó. Tus datos permanecen disponibles en modo lectura.');
      window.click360Route?.(window.location.hash.replace('#', '') || 'home');
    }, (error) => console.warn('No se pudo escuchar el acceso de cuenta:', error.message));
  }

	  async function enterApprovedApp(user, expectedEpoch = AUTH_EPOCH) {
		    if (!isCurrentAuthEpoch(user, expectedEpoch) || !activeIdentityIsValid(user)) return false;
	    await window.click360PrepareTenantStorage?.(ACTIVE_CONTEXT);
	    await pullRemoteOnce({ force: false, reload: false });
	    if (!isCurrentAuthEpoch(user, expectedEpoch) || !activeIdentityIsValid(user)) return false;
	    if (legacyMigrationRequired()) {
	      showLegacyMigrationGate();
	      return false;
	    }
	    if (!tenantGuard.canUnlock(ACTIVE_CONTEXT)) {
	      showGate('No se pudo verificar de forma segura la identidad y los datos de esta cuenta. La operación permanece bloqueada para proteger la información.');
	      return false;
	    }
	    if (INITIAL_TENANT_SEED_REQUIRED) {
	      const localPersisted = window.click360PersistTenantState?.() === true;
	      const storageMode = window.click360GetStorageState?.()?.mode || '';
	      ONLINE_ONLY_SAFE = ONLINE_ONLY_SAFE || ['online_only_safe', 'unavailable'].includes(storageMode);
	      const bootstrapDecision = window.CLICK360_V16_DOMAIN?.initialTenantBootstrapDecision({
	        localPersisted,
	        onlineOnlySafe: ONLINE_ONLY_SAFE,
	        online: navigator.onLine,
	        readOnly: ACCESS_READ_ONLY
	      }) || { allowed: localPersisted && !ACCESS_READ_ONLY };
	      if (!bootstrapDecision.allowed) {
	        tenantGuard.block();
	        PULL_COMPLETE = false;
	        const bootstrapMessage = bootstrapDecision.reason === 'read_only'
	          ? 'Tu plan terminó antes de crear el negocio. Contacta a CLICK 360 para activarlo.'
	          : bootstrapDecision.reason === 'connection_required'
	            ? 'Conéctate a internet para preparar esta cuenta por primera vez.'
	            : 'No pudimos preparar la aplicación en este dispositivo. Tus datos no fueron modificados.';
	        showGate(bootstrapMessage);
	        return false;
	      }
	      if (!localPersisted) setSyncStatus('online_only_safe', 'Este dispositivo trabajará directamente con la nube mientras tenga internet.');
	      AUTH_APPROVED = true;
	      const seeded = await pushLocalToFirestore('initial_tenant_seed');
	      if (!seeded) {
	        AUTH_APPROVED = false;
	        PULL_COMPLETE = false;
	        tenantGuard.block();
	        showGate('No pudimos preparar el negocio de forma segura. No se modificó información existente.');
	        return false;
	      }
	      INITIAL_TENANT_SEED_REQUIRED = false;
	    }
	  const userRole = (window.click360User && window.click360User.role) || 'owner';
	  const userName = (window.click360User && (window.click360User.name || window.click360User.email)) || 'Usuario';
		  const newSession = { username: userName, role: userRole };
			  if(window.click360SetSession) window.click360SetSession(newSession);
			  unlockApp();
			  clearPublicAuthIntent();
		  recordTelemetryOnce(`login:${expectedEpoch}:${user.uid}`, 'login', { mode: window.click360AccessState?.mode || userRole });
		  recordTelemetryOnce(`bootstrap:${expectedEpoch}:${ACTIVE_CONTEXT.tenantKey}`, 'bootstrap', { mode: ONLINE_ONLY_SAFE ? 'online_only_safe' : 'ready' });
		  if (ONLINE_ONLY_SAFE) setSyncStatus('online_only_safe', 'Tus datos estan seguros en la nube. Este dispositivo no pudo activar el modo sin conexion, pero puedes continuar trabajando con internet.');
	    window.click360FlushPendingProfile?.().catch(() => {});
	    listenRemoteChanges();
    if (window.click360User?.access?.source === 'accountAccess') listenAccountAccess(user, expectedEpoch);
    else listenUserApproval(user, expectedEpoch);
    return true;
  }

  let HAS_BOOTED = false;

  async function boot() {
    if(HAS_BOOTED) return;
    HAS_BOOTED = true;

    try {
      await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    } catch (e) {
      console.warn("Persistencia local no disponible:", e.message);
    }

    showGate("Verificando acceso Google...");


    auth.onAuthStateChanged(async user => {
	      const epoch = AUTH_EPOCH + 1;
	      deactivateActiveAccount();
      if (!user) {
        showGate("Inicia sesión con Google para continuar.");
        return;
      }

	      const publicIntent = readPublicAuthIntent();
	      showGate("Verificando acceso en CLICK 360...");
	      setSyncStatus(navigator.onLine ? "checking" : "offline", navigator.onLine ? "Verificando aprobación." : "Sin internet. Buscando aprobación guardada.");
	      try { await acceptInvitationFromUrl(user, epoch); }
	      catch (error) {
	        if (!isCurrentAuthEpoch(user, epoch)) return;
	        showGate(`No se pudo aceptar la invitacion: ${escapeHtml(error.message)}`);
	        return;
	      }
	      const approved = await isApprovedUser(user, epoch);
	      if (epoch !== AUTH_EPOCH || auth.currentUser?.uid !== user.uid) return;

	      if (!approved) {
	        if (window.click360User && ["blocked", "revoked"].includes(window.click360User.status)) {
	          showGate(`
	            Tu cuenta (<b>${escapeHtml(user.email || "sin email")}</b>) ha sido bloqueada o revocada.<br><br>
	            Por favor, ponte en contacto con el administrador o soporte.
	          `);
	          const loginBtn = document.getElementById("c360-google-login");
	          if (loginBtn) loginBtn.style.display = "none";
	        } else if (window.click360User && window.click360User.status === "tenant_configuration_invalid") {
	          showGate("La configuración de esta cuenta no coincide con el tenant seguro. La operación fue bloqueada para proteger los datos; requiere corrección administrativa.");
	          const loginBtn = document.getElementById("c360-google-login");
	          if (loginBtn) loginBtn.style.display = "none";
        } else if (window.click360User?.hasApprovedRecord) {
          showGate(`
	            Tu solicitud de acceso (<b>${escapeHtml(user.email || "sin email")}</b>) está <b>pendiente de aprobación</b>.<br><br>
	            UID de usuario: <code style="background: #222; padding: 4px 8px; border-radius: 4px; color: #ff9f43; font-family: monospace; font-size: 13px; display: inline-block; margin: 4px 0; user-select: all;">${escapeHtml(user.uid)}</code><br><br>
            Por favor, pídele al administrador que apruebe tu acceso desde la sección "Trabajadores" en su sistema usando tu UID.
          `);
          const loginBtn = document.getElementById("c360-google-login");
          if (loginBtn) {
            loginBtn.textContent = "Ya me aprobaron (Actualizar)";
            loginBtn.onclick = async () => {
              showGate("Verificando aprobación en CLICK 360...");
	              const activeEpoch = AUTH_EPOCH;
	              const ok = await isApprovedUser(user, activeEpoch);
	              if (ok) await enterApprovedApp(user, activeEpoch);
              else showPending(user);
            };
	          }
        } else {
	          const account = await resolveAccountAccess(user, epoch, {
		            allowCreate: window.CLICK360_V16_DOMAIN?.publicIntentAllowsTrialCreation(publicIntent) === true,
	            intent: publicIntent
	          });
	          if (!isCurrentAuthEpoch(user, epoch)) return;
	          if (account?.state?.allowed && applyAccountAccessIdentity(user, account, epoch)) {
	            await enterApprovedApp(user, epoch);
	            return;
	          }
	          if (publicIntent === 'login') {
	            showGate('No encontramos una cuenta activa con este Google. Usa Probar gratis, Registrarse o cambia de cuenta.');
	          } else if (publicIntent === 'invite') {
	            showGate('No pudimos validar la invitación. Revisa el enlace o solicita uno nuevo al propietario del negocio.');
	          } else {
	            showPending(user, account?.state?.mode || 'pending');
	          }
        }
        return;
      }

      await enterApprovedApp(user, epoch);
    });
  }

  boot();
})();
